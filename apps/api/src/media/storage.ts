import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OutputInfo } from 'sharp';

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_PIXELS = 40_000_000;
const MAX_DISPLAY_DIMENSION = 2_400;
const THUMBNAIL_WIDTH = 240;
// Share an in-flight derivative across store instances in this API process.
// Otherwise concurrent cache misses can replace a file another reader opened.
const thumbnailPreparations = new Map<string, Promise<void>>();
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const formats: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type MediaStorageErrorCode =
  | 'INVALID_MEDIA_ID'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MEDIA_TOO_LARGE'
  | 'INVALID_MEDIA'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_ALREADY_EXISTS'
  | 'MEDIA_STORAGE_ERROR';

export class MediaStorageError extends Error {
  constructor(public readonly code: MediaStorageErrorCode, message: string) {
    super(message);
    this.name = 'MediaStorageError';
  }
}

export interface StoredMedia {
  width: number;
  height: number;
  mimeType: 'image/webp';
  byteSize: number;
}

/** Only the fixed basename crosses into HTTP delivery; never the storage root. */
export interface MediaDeliveryFile {
  filename: string;
  byteSize: number;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function canonicalId(id: string): string {
  if (typeof id !== 'string' || !idPattern.test(id)) {
    throw new MediaStorageError('INVALID_MEDIA_ID', 'The media identifier is invalid.');
  }
  return id.toLowerCase();
}

// Some PNG loaders decode only the first APNG frame. Check its animation control
// chunk as well as the decoder metadata so an animation cannot pass as a still.
function isAnimatedPng(bytes: Buffer): boolean {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(signature)) return false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IEND') return false;
    if (length > bytes.length - offset - 12) return false;
    offset += length + 12;
  }
  return false;
}

/**
 * Stores only processed display images in a service-owned, private directory.
 * HTTP authorization and live publication references belong to the caller.
 * The directory's parent must not be writable by untrusted local users.
 */
export class LocalMediaStore {
  private readonly directory: string;
  private resolvedDirectory: string | undefined;

  constructor(rootDirectory: string) {
    if (typeof rootDirectory !== 'string' || rootDirectory.trim().length === 0) {
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'A private media directory is required.');
    }
    this.directory = path.resolve(rootDirectory);
    if (this.directory === path.parse(this.directory).root) {
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The filesystem root cannot store media.');
    }
  }

  private async root(create: boolean): Promise<string> {
    try {
      if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
        throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media directory must be private and must not be a symbolic link.');
      }
      const resolved = await realpath(this.directory);
      if (this.resolvedDirectory && this.resolvedDirectory !== resolved) {
        throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media directory changed unexpectedly.');
      }
      this.resolvedDirectory = resolved;
      return resolved;
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      if (!create && hasCode(error, 'ENOENT')) {
        throw new MediaStorageError('MEDIA_NOT_FOUND', 'The media file does not exist.');
      }
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media directory is unavailable.');
    }
  }

  private async withPrivateFile<T>(filename: string, action: (file: FileHandle, byteSize: number) => Promise<T>): Promise<T> {
    try {
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (stat.nlink === 0) {
          throw new MediaStorageError('MEDIA_NOT_FOUND', 'The media file no longer exists.');
        }
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_MEDIA_BYTES || (stat.mode & 0o077) !== 0) {
          throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media file is not a valid private file.');
        }
        return await action(file, stat.size);
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      if (hasCode(error, 'ENOENT')) {
        throw new MediaStorageError('MEDIA_NOT_FOUND', 'The media file does not exist.');
      }
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media file cannot be read safely.');
    }
  }

  private inspectFile(filename: string): Promise<number> {
    return this.withPrivateFile(filename, async (_file, byteSize) => byteSize);
  }

  private readFile(filename: string): Promise<Buffer> {
    return this.withPrivateFile(filename, (file) => file.readFile());
  }

  async put(id: string, bytes: Buffer, declaredType: string): Promise<StoredMedia> {
    const safeId = canonicalId(id);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new MediaStorageError('INVALID_MEDIA', 'An image file is required.');
    }
    if (bytes.length > MAX_MEDIA_BYTES) {
      throw new MediaStorageError('MEDIA_TOO_LARGE', 'Images must not exceed 10 MB.');
    }
    const mimeType = typeof declaredType === 'string' ? declaredType.trim().toLowerCase() : '';
    const expectedFormat = Object.hasOwn(formats, mimeType) ? formats[mimeType] : undefined;
    if (!expectedFormat) {
      throw new MediaStorageError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG and WebP images are supported.');
    }

    let processed: { data: Buffer; info: OutputInfo };
    try {
      const input = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_MEDIA_PIXELS, animated: true });
      const metadata = await input.metadata();
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height ||
          metadata.width * metadata.height > MAX_MEDIA_PIXELS ||
          (metadata.pages ?? 1) > 1 || (metadata.delay?.length ?? 0) > 0 || isAnimatedPng(bytes)) {
        throw new MediaStorageError('INVALID_MEDIA', 'The image type or dimensions are invalid, or the image is animated.');
      }
      processed = await input.rotate().resize({
        width: MAX_DISPLAY_DIMENSION,
        height: MAX_DISPLAY_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('INVALID_MEDIA', 'The file could not be decoded as a supported still image.');
    }
    if (processed.data.length > MAX_MEDIA_BYTES) {
      throw new MediaStorageError('MEDIA_TOO_LARGE', 'The processed image exceeds the storage limit.');
    }

    const root = await this.root(true);
    const target = path.join(root, `${safeId}.webp`);
    const temporary = path.join(root, `.${safeId}.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await file.writeFile(processed.data);
        await file.sync();
      } finally {
        await file.close();
      }
      // link is an atomic create-if-absent, unlike rename which can overwrite an
      // already published file. The temporary name is removed before returning.
      try {
        await link(temporary, target);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        const existing = await this.readFile(target);
        if (!existing.equals(processed.data)) {
          throw new MediaStorageError('MEDIA_ALREADY_EXISTS', 'This media identifier already contains a different image.');
        }
      }
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The image could not be stored safely.');
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!hasCode(error, 'ENOENT')) {
          throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The temporary image could not be removed.');
        }
      });
    }
    return {
      width: processed.info.width,
      height: processed.info.height,
      mimeType: 'image/webp',
      byteSize: processed.data.length,
    };
  }

  async read(id: string): Promise<Buffer> {
    const safeId = canonicalId(id);
    const root = await this.root(false);
    return this.readFile(path.join(root, `${safeId}.webp`));
  }

  async readThumbnail(id: string): Promise<Buffer> {
    const delivery = await this.prepareDelivery(id, 'thumb');
    const root = await this.root(false);
    return this.readFile(path.join(root, delivery.filename));
  }

  /** Authorize at the service on every request before preparing this filename. */
  async prepareDelivery(id: string, variant?: 'thumb'): Promise<MediaDeliveryFile> {
    const safeId = canonicalId(id);
    if (variant !== undefined && variant !== 'thumb') {
      throw new MediaStorageError('INVALID_MEDIA_ID', 'The media variant is invalid.');
    }
    const root = await this.root(false);
    const originalPath = path.join(root, `${safeId}.webp`);
    const originalSize = await this.inspectFile(originalPath);
    if (!variant) return { filename: `${safeId}.webp`, byteSize: originalSize };

    const filename = `${safeId}.thumb.webp`;
    const target = path.join(root, filename);
    try { await this.inspectFile(target); }
    catch (error) {
      if (!(error instanceof MediaStorageError) || error.code !== 'MEDIA_NOT_FOUND') throw error;
      await this.ensureThumbnail(root, safeId);
    }
    // A removed original must not be replaced by an orphaned cached derivative.
    // The final checks also cover a removal while the derivative was generated.
    await this.inspectFile(originalPath);
    const byteSize = await this.inspectFile(target);
    return { filename, byteSize };
  }

  private async ensureThumbnail(root: string, safeId: string): Promise<void> {
    const target = path.join(root, `${safeId}.thumb.webp`);
    const existing = thumbnailPreparations.get(target);
    if (existing) return existing;
    const preparation = (async () => {
      // A previously awaited metadata check may have missed a cache that was
      // completed before this task started. Do not replace that valid file.
      try { await this.inspectFile(target); return; }
      catch (error) {
        if (!(error instanceof MediaStorageError) || error.code !== 'MEDIA_NOT_FOUND') throw error;
      }
      await this.createThumbnail(root, safeId);
    })();
    thumbnailPreparations.set(target, preparation);
    try { await preparation; }
    finally {
      if (thumbnailPreparations.get(target) === preparation) thumbnailPreparations.delete(target);
    }
  }

  private async createThumbnail(root: string, safeId: string): Promise<void> {
    const original = await this.readFile(path.join(root, `${safeId}.webp`));
    let thumbnail: Buffer;
    try {
      thumbnail = await sharp(original, { failOn: 'warning', limitInputPixels: MAX_MEDIA_PIXELS })
        .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    } catch {
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The display image cannot be resized.');
    }
    const temporary = path.join(root, `.${safeId}.${randomUUID()}.thumb.tmp`);
    try {
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(thumbnail); await file.sync(); }
      finally { await file.close(); }
      // Atomically expose a complete fixed derivative of immutable input,
      // without a transient hard-link count that private-file checks reject.
      await rename(temporary, path.join(root, `${safeId}.thumb.webp`));
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The thumbnail could not be stored safely.');
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!hasCode(error, 'ENOENT')) throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The temporary thumbnail could not be removed.');
      });
    }
  }

  async remove(id: string): Promise<void> {
    const safeId = canonicalId(id);
    try {
      const root = await this.root(false);
      for (const filename of [`${safeId}.thumb.webp`, `${safeId}.webp`]) {
        const target = path.join(root, filename);
        try {
          const stat = await lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media file cannot be removed safely.');
          }
          await unlink(target);
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        }
      }
    } catch (error) {
      if (hasCode(error, 'ENOENT') || error instanceof MediaStorageError && error.code === 'MEDIA_NOT_FOUND') return;
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media file could not be removed.');
    }
  }
}
