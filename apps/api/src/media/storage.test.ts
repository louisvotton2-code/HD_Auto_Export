import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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
