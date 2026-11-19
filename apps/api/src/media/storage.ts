import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import type { PublicMediaQuery } from '@hd/contracts/public';
import { matchesIfNoneMatch } from './conditional.js';

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_PIXELS = 40_000_000;
const MAX_DISPLAY_DIMENSION = 2_400;
const THUMBNAIL_WIDTH = 240;
const CARD_DIMENSION = 800;
const MAX_CARD_PREPARATIONS = 2;
type MediaVariant = NonNullable<PublicMediaQuery['variant']>;
// Share an in-flight derivative across store instances in this API process.
const derivativePreparations: Record<MediaVariant, Map<string, Promise<void>>> = {
  thumb: new Map(),
  card: new Map(),
};
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
  | 'MEDIA_DERIVATIVE_BUSY'
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

export interface PublicMediaDeliveryOptions {
  ifNoneMatch?: string;
  readBody: boolean;
}

export interface PublicMediaDelivery extends MediaDeliveryFile {
  etag: string;
  notModified: boolean;
  body?: Buffer;
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

  private async withPrivateFile<T>(filename: string, action: (file: FileHandle, stat: BigIntStats) => Promise<T>): Promise<T> {
    try {
      const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat({ bigint: true });
        if (stat.nlink === 0n) {
          throw new MediaStorageError('MEDIA_NOT_FOUND', 'The media file no longer exists.');
        }
        if (!stat.isFile() || stat.nlink !== 1n || stat.size === 0n || stat.size > BigInt(MAX_MEDIA_BYTES) || (stat.mode & 0o077n) !== 0n) {
          throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media file is not a valid private file.');
        }
        return await action(file, stat);
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
    return this.withPrivateFile(filename, async (_file, stat) => Number(stat.size));
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
    const delivery = await this.deliveryLocation(id, 'thumb');
    return this.readFile(delivery.target);
  }

  /** Authorize at the service on every request before preparing this filename. */
  async prepareDelivery(id: string, variant?: MediaVariant): Promise<MediaDeliveryFile> {
    const { filename, target } = await this.deliveryLocation(id, variant);
    return { filename, byteSize: await this.inspectFile(target) };
  }

  async preparePublicDelivery(id: string, variant: MediaVariant | undefined,
    { ifNoneMatch, readBody }: PublicMediaDeliveryOptions): Promise<PublicMediaDelivery> {
    const { filename, target } = await this.deliveryLocation(id, variant);
    return this.withPrivateFile(target, async (file, stat) => {
      // The store publishes immutable files. A replacement or in-place change
      // changes this fingerprint, which avoids reading bytes on a warm hit.
      const fingerprint = [filename, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
      const etag = `W/"${createHash('sha256').update(fingerprint).digest('base64url')}"`;
      const notModified = matchesIfNoneMatch(ifNoneMatch, etag);
      let body:Buffer|undefined;
      if (readBody && !notModified) {
        body = await file.readFile();
        const after = await file.stat({ bigint: true });
        if (BigInt(body.length) !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) {
          throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The image file changed during delivery.');
        }
      }
      return { filename, byteSize: Number(stat.size), etag, notModified, body };
    });
  }

  private async deliveryLocation(id: string, variant?: MediaVariant) {
    const safeId = canonicalId(id);
    if (variant !== undefined && variant !== 'thumb' && variant !== 'card') {
      throw new MediaStorageError('INVALID_MEDIA_ID', 'The media variant is invalid.');
    }
    const root = await this.root(false);
    const originalPath = path.join(root, `${safeId}.webp`);
    if (!variant) return { filename: `${safeId}.webp`, target: originalPath };
    await this.inspectFile(originalPath);

    const filename = `${safeId}.${variant}.webp`;
    const target = path.join(root, filename);
    try { await this.inspectFile(target); }
    catch (error) {
      if (!(error instanceof MediaStorageError) || error.code !== 'MEDIA_NOT_FOUND') throw error;
      await this.ensureDerivative(root, safeId, variant, target);
    }
    // A removed original must not be replaced by an orphaned cached derivative.
    // The final checks also cover a removal while the derivative was generated.
    await this.inspectFile(originalPath);
    return { filename, target };
  }

  private async ensureDerivative(root: string, safeId: string, variant: MediaVariant, target: string): Promise<void> {
    const preparations = derivativePreparations[variant];
    const existing = preparations.get(target);
    if (existing) return existing;
    if (variant === 'card' && preparations.size >= MAX_CARD_PREPARATIONS) {
      throw new MediaStorageError('MEDIA_DERIVATIVE_BUSY', 'Card image preparation is temporarily busy.');
    }
    const preparation = (async () => {
      // A previously awaited metadata check may have missed a cache that was
      // completed before this task started. Do not replace that valid file.
      try { await this.inspectFile(target); return; }
      catch (error) {
        if (!(error instanceof MediaStorageError) || error.code !== 'MEDIA_NOT_FOUND') throw error;
      }
      await this.createDerivative(root, safeId, variant, target);
    })();
    preparations.set(target, preparation);
    try { await preparation; }
    finally { preparations.delete(target); }
  }

  private async createDerivative(root: string, safeId: string, variant: MediaVariant, target: string): Promise<void> {
    const originalPath = path.join(root, `${safeId}.webp`);
    const original = await this.readFile(originalPath);
    const dimensions = variant === 'card'
      ? { width: CARD_DIMENSION, height: CARD_DIMENSION, fit: 'inside' as const }
      : { width: THUMBNAIL_WIDTH };
    let derivative: Buffer;
    try {
      derivative = await sharp(original, { failOn: 'warning', limitInputPixels: MAX_MEDIA_PIXELS })
        .resize({ ...dimensions, withoutEnlargement: true }).webp({ quality: variant === 'card' ? 80 : 75 }).toBuffer();
    } catch {
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The display image cannot be resized.');
    }
    const temporary = path.join(root, `.${safeId}.${randomUUID()}.${variant}.tmp`);
    try {
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(derivative); await file.sync(); }
      finally { await file.close(); }
      // Atomically expose a complete fixed derivative of immutable input,
      // without a transient hard-link count that private-file checks reject.
      await rename(temporary, target);
      // Physical removal unlinks the source before its derivatives. If it
      // won that race, do not leave a newly generated derivative behind.
      try { await this.inspectFile(originalPath); }
      catch (error) {
        await removeFileIfPresent(target);
        throw error;
      }
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The image derivative could not be stored safely.');
    } finally {
      await removeFileIfPresent(temporary).catch(() => {
        throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The temporary image derivative could not be removed.');
      });
    }
  }

  async remove(id: string): Promise<void> {
    const safeId = canonicalId(id);
    try {
      const root = await this.root(false);
      const targets = [`${safeId}.webp`, `${safeId}.thumb.webp`, `${safeId}.card.webp`].map(filename => path.join(root, filename));
      for (const target of targets) {
        try {
          const stat = await lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media file cannot be removed safely.');
          }
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        }
      }
      for (const target of targets) await removeFileIfPresent(target);
    } catch (error) {
      if (hasCode(error, 'ENOENT') || error instanceof MediaStorageError && error.code === 'MEDIA_NOT_FOUND') return;
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError('MEDIA_STORAGE_ERROR', 'The media file could not be removed.');
    }
  }
}

async function removeFileIfPresent(filename: string): Promise<void> {
  try { await unlink(filename); }
  catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
}
