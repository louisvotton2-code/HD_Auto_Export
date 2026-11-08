import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import sharp from 'sharp';
import { LocalMediaStore, MAX_MEDIA_BYTES, MediaStorageError, type MediaStorageErrorCode } from './storage.js';

async function setup(t: TestContext) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hd-media-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'media');
  return { temporary, directory, store: new LocalMediaStore(directory) };
}

function errorCode(code: MediaStorageErrorCode) {
  return (error: unknown): boolean => error instanceof MediaStorageError && error.code === code;
}

async function png(width = 12, height = 8, background = '#ff0000') {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

test('stores a private processed image and a new store instance can read and remove it', async (t) => {
  const { directory, store } = await setup(t);
  const id = randomUUID();
  const result = await store.put(id, await png(), 'image/png');
  const bytes = await new LocalMediaStore(directory).read(id);
  const metadata = await sharp(bytes).metadata();
  assert.equal(result.mimeType, 'image/webp');
  assert.equal(result.width, 12);
  assert.equal(result.height, 8);
  assert.equal(result.byteSize, bytes.length);
  assert.equal(metadata.format, 'webp');
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(path.join(directory, `${id}.webp`))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), [`${id}.webp`]);
  await store.remove(id);
  await store.remove(id);
  await assert.rejects(store.read(id), errorCode('MEDIA_NOT_FOUND'));
});

test('accepts JPEG and WebP by their actual format and does not enlarge small images', async (t) => {
  const { store } = await setup(t);
  const source = await png(9, 7);
  for (const [mimeType, bytes] of [
    ['image/jpeg', await sharp(source).jpeg().toBuffer()],
    ['image/webp', await sharp(source).webp().toBuffer()],
  ] as const) {
    const result = await store.put(randomUUID(), bytes, mimeType);
    assert.equal(result.width, 9);
    assert.equal(result.height, 7);
  }
});

test('fixed thumbnails preserve aspect ratio, remain private and cache atomically across instances', async (t) => {
  const {directory,store}=await setup(t);const id=randomUUID();
  await store.put(id,await png(800,600),'image/png');
  const original=await store.read(id);
  const thumbnails=await Promise.all(Array.from({length:8},()=>new LocalMediaStore(directory).readThumbnail(id)));
  for(const bytes of thumbnails) {
    const metadata=await sharp(bytes).metadata();
    assert.equal(metadata.format,'webp');assert.equal(metadata.width,240);assert.equal(metadata.height,180);
    assert.deepEqual(bytes,thumbnails[0]);
  }
  const filename=path.join(directory,`${id}.thumb.webp`);
  const before=await lstat(filename);
  assert.equal(before.mode&0o777,0o600);assert.equal(before.nlink,1);
  assert.deepEqual(await store.readThumbnail(id.toUpperCase()),thumbnails[0]);
  assert.equal((await lstat(filename)).mtimeMs,before.mtimeMs);
  assert.deepEqual(await store.read(id),original);
  assert.deepEqual((await readdir(directory)).sort(),[`${id}.thumb.webp`,`${id}.webp`].sort());
  await store.remove(id);await store.remove(id);
  assert.deepEqual(await readdir(directory),[]);
  await assert.rejects(store.readThumbnail(id),errorCode('MEDIA_NOT_FOUND'));
});

test('thumbnails do not enlarge small images or use a cache without its source',async(t)=>{
  const {directory,store}=await setup(t);const id=randomUUID();
  await store.put(id,await png(90,140),'image/png');
  const thumbnail=await store.readThumbnail(id);const metadata=await sharp(thumbnail).metadata();
  assert.equal(metadata.width,90);assert.equal(metadata.height,140);
  await rm(path.join(directory,`${id}.webp`));
  await assert.rejects(store.readThumbnail(id),errorCode('MEDIA_NOT_FOUND'));
  await store.remove(id);assert.deepEqual(await readdir(directory),[]);
});

test('thumbnail cache rejects traversal and symlinks without altering their targets',async(t)=>{
  const {temporary,directory,store}=await setup(t);const id=randomUUID();
  await store.put(id,await png(),'image/png');
  await assert.rejects(store.readThumbnail('../secret'),errorCode('INVALID_MEDIA_ID'));
  const outside=path.join(temporary,'outside');await writeFile(outside,'private fixture',{mode:0o600});
  await symlink(outside,path.join(directory,`${id}.thumb.webp`));
  await assert.rejects(store.readThumbnail(id),errorCode('MEDIA_STORAGE_ERROR'));
  await assert.rejects(store.remove(id),errorCode('MEDIA_STORAGE_ERROR'));
  assert.equal(await readFile(outside,'utf8'),'private fixture');assert.ok((await store.read(id)).length);
});

test('resizes oversized display dimensions and strips metadata after orientation', async (t) => {
  const { store } = await setup(t);
  const input = await sharp({
    create: { width: 3_000, height: 1_500, channels: 3, background: '#7e4551' },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const id = randomUUID();
  const result = await store.put(id, input, 'image/jpeg');
  assert.equal(result.width, 1_200);
  assert.equal(result.height, 2_400);
  const metadata = await sharp(await store.read(id)).metadata();
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.icc, undefined);
});

test('rejects spoofed types, SVG, empty input and corrupt image bytes', async (t) => {
  const { store } = await setup(t);
  await assert.rejects(store.put(randomUUID(), await png(), 'image/jpeg'), errorCode('INVALID_MEDIA'));
  await assert.rejects(store.put(randomUUID(), Buffer.from('<svg/>'), 'image/svg+xml'), errorCode('UNSUPPORTED_MEDIA_TYPE'));
  await assert.rejects(store.put(randomUUID(), Buffer.alloc(0), 'image/png'), errorCode('INVALID_MEDIA'));
  await assert.rejects(store.put(randomUUID(), Buffer.from('not an image'), 'image/png'), errorCode('INVALID_MEDIA'));
  const input = await png();
  await assert.rejects(store.put(randomUUID(), input.subarray(0, input.length / 2), 'image/png'), errorCode('INVALID_MEDIA'));
});

test('rejects the actual byte limit before image decoding', async (t) => {
  const { store } = await setup(t);
  await assert.rejects(
    store.put(randomUUID(), Buffer.alloc(MAX_MEDIA_BYTES + 1), 'image/png'),
    errorCode('MEDIA_TOO_LARGE'),
  );
});

test('rejects compressed images whose decoded pixel count exceeds the limit', async (t) => {
  const { store } = await setup(t);
  const input = await png(7_000, 6_000);
  assert.ok(input.length < MAX_MEDIA_BYTES);
  await assert.rejects(store.put(randomUUID(), input, 'image/png'), errorCode('INVALID_MEDIA'));
});

test('rejects APNG animation chunks even when a decoder would only return the first frame', async (t) => {
  const { store } = await setup(t);
  const input = await png();
  // PNG's acTL chunk is enough to identify an animated source, including when
  // the remaining animation data is corrupt. It must never become a still photo.
  const animationControl = Buffer.from('000000086163544c0000000200000000f38d9370', 'hex');
  const animated = Buffer.concat([input.subarray(0, 33), animationControl, input.subarray(33)]);
  await assert.rejects(store.put(randomUUID(), animated, 'image/png'), errorCode('INVALID_MEDIA'));
});

test('rejects multi-frame WebP', async (t) => {
  const { store } = await setup(t);
  const gif = Buffer.from([
    ...Buffer.from('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0,
    0, 0, 0, 255, 255, 255,
    0x21, 0xf9, 4, 0, 10, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0,
    0x21, 0xf9, 4, 0, 10, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 1, 0,
    0x3b,
  ]);
  const animated = await sharp(gif, { animated: true }).webp({ loop: 0 }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  await assert.rejects(store.put(randomUUID(), animated, 'image/webp'), errorCode('INVALID_MEDIA'));
});

test('retries of identical contents are idempotent but a different image cannot replace an ID', async (t) => {
  const { directory, store } = await setup(t);
  const id = randomUUID();
  const image = await png();
  const first = await store.put(id, image, 'image/png');
  assert.deepEqual(await store.put(id, image, 'image/png'), first);
  const before = await store.read(id);
  await assert.rejects(store.put(id, await png(12, 8, '#00ff00'), 'image/png'), errorCode('MEDIA_ALREADY_EXISTS'));
  assert.deepEqual(await store.read(id), before);
  assert.deepEqual(await readdir(directory), [`${id}.webp`]);
});

test('rejects path traversal and normalizes valid UUID casing', async (t) => {
  const { store } = await setup(t);
  for (const id of ['../secret', '/etc/passwd', '.', '', 'not-a-uuid', `${randomUUID()}/../secret`]) {
    await assert.rejects(store.put(id, await png(), 'image/png'), errorCode('INVALID_MEDIA_ID'));
    await assert.rejects(store.read(id), errorCode('INVALID_MEDIA_ID'));
    await assert.rejects(store.remove(id), errorCode('INVALID_MEDIA_ID'));
  }
  const id = randomUUID();
  await store.put(id.toUpperCase(), await png(), 'image/png');
  assert.deepEqual(await store.read(id), await store.read(id.toUpperCase()));
});

test('does not follow a symlink at the media root', async (t) => {
  const { temporary, directory, store } = await setup(t);
  const outside = path.join(temporary, 'outside');
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, directory);
  await assert.rejects(store.put(randomUUID(), await png(), 'image/png'), errorCode('MEDIA_STORAGE_ERROR'));
  assert.deepEqual(await readdir(outside), []);
});

test('refuses a directory readable by other local users', async (t) => {
  const { directory, store } = await setup(t);
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o755);
  await assert.rejects(store.put(randomUUID(), await png(), 'image/png'), errorCode('MEDIA_STORAGE_ERROR'));
});

test('does not read, overwrite or delete through a media file symlink', async (t) => {
  const { temporary, directory, store } = await setup(t);
  await mkdir(directory, { mode: 0o700 });
  const outside = path.join(temporary, 'secret.txt');
  await writeFile(outside, 'not media', { mode: 0o600 });
  const id = randomUUID();
  await symlink(outside, path.join(directory, `${id}.webp`));
  await assert.rejects(store.read(id), errorCode('MEDIA_STORAGE_ERROR'));
  await assert.rejects(store.put(id, await png(), 'image/png'), errorCode('MEDIA_STORAGE_ERROR'));
  await assert.rejects(store.remove(id), errorCode('MEDIA_STORAGE_ERROR'));
  assert.equal(await readFile(outside, 'utf8'), 'not media');
});

test('refuses hard-linked files and missing files without exposing filesystem paths', async (t) => {
  const { temporary, directory, store } = await setup(t);
  await mkdir(directory, { mode: 0o700 });
  const outside = path.join(temporary, 'secret.txt');
  await writeFile(outside, 'not media', { mode: 0o600 });
  const id = randomUUID();
  await link(outside, path.join(directory, `${id}.webp`));
  await assert.rejects(store.read(id), errorCode('MEDIA_STORAGE_ERROR'));
  await assert.rejects(store.read(randomUUID()), (error: unknown) => {
    assert.ok(error instanceof MediaStorageError);
    assert.equal(error.code, 'MEDIA_NOT_FOUND');
    assert.equal(error.message.includes(temporary), false);
    return true;
  });
});

test('original delivery checks metadata without reading image bytes and returns only a canonical basename', async (t) => {
  const { directory, store } = await setup(t);
  const id = randomUUID();
  const stored = await store.put(id, await png(600, 400), 'image/png');
  const bodyReader = store as unknown as { readFile(filename: string): Promise<Buffer> };
  const read = t.mock.method(bodyReader, 'readFile', async () => { throw new Error('Delivery must not read image bytes'); });
  const delivery = await store.prepareDelivery(id.toUpperCase());
  assert.deepEqual(delivery, { filename: `${id}.webp`, byteSize: stored.byteSize });
  assert.equal(delivery.filename.includes(directory), false);
  assert.equal(read.mock.callCount(), 0);
});

test('delivery creates a fixed private thumbnail once and cached delivery does not read either body', async (t) => {
  const { directory, store } = await setup(t);
  const id = randomUUID();
  await store.put(id, await png(800, 600), 'image/png');
  const bodyReader = store as unknown as { readFile(filename: string): Promise<Buffer> };
  const read = t.mock.method(bodyReader, 'readFile');
  const delivery = await store.prepareDelivery(id, 'thumb');
  assert.equal(read.mock.callCount(), 1);
  assert.equal(read.mock.calls[0]?.arguments[0], path.join(await realpath(directory), `${id}.webp`));
  assert.equal(delivery.filename, `${id}.thumb.webp`);
  const filename = path.join(directory, delivery.filename);
  const before = await lstat(filename);
  assert.equal(delivery.byteSize, before.size);
  assert.equal(before.mode & 0o777, 0o600);
  assert.equal(before.nlink, 1);
  const metadata = await sharp(await readFile(filename)).metadata();
  assert.equal(metadata.width, 240); assert.equal(metadata.height, 180);

  const reopened = new LocalMediaStore(directory);
  const cachedRead = t.mock.method(reopened as unknown as typeof bodyReader, 'readFile', async () => {
    throw new Error('Cached delivery must not read image bytes');
  });
  assert.deepEqual(await reopened.prepareDelivery(id, 'thumb'), delivery);
  assert.equal(cachedRead.mock.callCount(), 0);
  assert.equal((await lstat(filename)).mtimeMs, before.mtimeMs);
  assert.deepEqual((await readdir(directory)).sort(), [`${id}.thumb.webp`, `${id}.webp`].sort());
});

test('delivery rejects invalid identifiers and variants instead of deriving arbitrary paths', async (t) => {
  const { store } = await setup(t);
  for (const id of ['../secret', '/etc/passwd', `${randomUUID()}.webp`, 'not-an-id']) {
    await assert.rejects(store.prepareDelivery(id), errorCode('INVALID_MEDIA_ID'));
  }
  for (const variant of ['../secret', 'original', '', '/tmp/file']) {
    await assert.rejects(store.prepareDelivery(randomUUID(), variant as 'thumb'), errorCode('INVALID_MEDIA_ID'));
  }
});

test('delivery applies the same private-file checks to original and cached thumbnails', async (t) => {
  for (const variant of [undefined, 'thumb'] as const) {
    for (const unsafe of ['symlink', 'hardlink', 'oversize', 'public-mode', 'directory'] as const) {
      await t.test(`${variant ?? 'original'}: ${unsafe}`, async (subtest) => {
        const { temporary, directory, store } = await setup(subtest);
        const id = randomUUID();
        await store.put(id, await png(), 'image/png');
        if (variant) await store.prepareDelivery(id, variant);
        const target = path.join(directory, `${id}${variant ? '.thumb' : ''}.webp`);
        if (unsafe === 'symlink' || unsafe === 'hardlink') {
          const outside = path.join(temporary, 'outside');
          await writeFile(outside, 'private outside fixture', { mode: 0o600 });
          await rm(target);
          if (unsafe === 'symlink') await symlink(outside, target);
          else await link(outside, target);
        } else if (unsafe === 'oversize') await truncate(target, MAX_MEDIA_BYTES + 1);
        else if (unsafe === 'public-mode') await chmod(target, 0o644);
        else { await rm(target); await mkdir(target, { mode: 0o700 }); }
        const read = subtest.mock.method(store as unknown as { readFile(filename: string): Promise<Buffer> }, 'readFile', async () => {
          throw new Error('Unsafe delivery must not read image bytes');
        });
        await assert.rejects(store.prepareDelivery(id, variant), errorCode('MEDIA_STORAGE_ERROR'));
        assert.equal(read.mock.callCount(), 0);
        if (unsafe === 'symlink' || unsafe === 'hardlink') {
          assert.equal(await readFile(path.join(temporary, 'outside'), 'utf8'), 'private outside fixture');
        }
      });
    }
  }
});

test('delivery refuses an orphan thumbnail after its original is removed', async (t) => {
  const { directory, store } = await setup(t);
  const id = randomUUID();
  await store.put(id, await png(), 'image/png');
  await store.prepareDelivery(id, 'thumb');
  await rm(path.join(directory, `${id}.webp`));
  assert.ok((await lstat(path.join(directory, `${id}.thumb.webp`))).isFile());
  await assert.rejects(store.prepareDelivery(id), errorCode('MEDIA_NOT_FOUND'));
  await assert.rejects(store.prepareDelivery(id, 'thumb'), errorCode('MEDIA_NOT_FOUND'));
});

test('an original removed during first thumbnail generation fails delivery without a fallback path', async (t) => {
  const { directory, store } = await setup(t);
  const id = randomUUID();
  await store.put(id, await png(), 'image/png');
  const bodyReader = store as unknown as { readFile(filename: string): Promise<Buffer> };
  const read = bodyReader.readFile.bind(store);
  t.mock.method(bodyReader, 'readFile', async (filename: string) => {
    const bytes = await read(filename);
    await rm(filename);
    return bytes;
  });
  await assert.rejects(store.prepareDelivery(id, 'thumb'), errorCode('MEDIA_NOT_FOUND'));
  assert.ok((await lstat(path.join(directory, `${id}.thumb.webp`))).isFile());
  await assert.rejects(store.prepareDelivery(id, 'thumb'), errorCode('MEDIA_NOT_FOUND'));
});

test('unlink or cross-process replacement between open and fstat is missing, never a weakened private-file check', async (t) => {
  for (const operation of ['unlink', 'replace'] as const) {
    await t.test(operation, async (subtest) => {
      const { directory, store } = await setup(subtest);
      const id = randomUUID();
      const result = await store.put(id, await png(), 'image/png');
      const target = path.join(directory, `${id}.webp`);
      const replacement = path.join(directory, 'replacement.tmp');
      if (operation === 'replace') await writeFile(replacement, await readFile(target), { mode: 0o600 });
      const probe = await open(target, 'r');
      const prototype = Object.getPrototypeOf(probe) as { stat(): Promise<Stats> };
      const originalStat = prototype.stat;
      await probe.close();
      let interrupted = false;
      subtest.mock.method(prototype, 'stat', async function (this: typeof prototype) {
        if (!interrupted) {
          interrupted = true;
          if (operation === 'replace') await rename(replacement, target);
          else await rm(target);
        }
        return originalStat.call(this);
      });
      await assert.rejects(store.prepareDelivery(id), errorCode('MEDIA_NOT_FOUND'));
      if (operation === 'replace') {
        assert.deepEqual(await store.prepareDelivery(id), { filename: `${id}.webp`, byteSize: result.byteSize });
      }
    });
  }
});
