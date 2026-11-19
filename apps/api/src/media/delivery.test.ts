import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';
import { MediaService } from './service.js';
import { LocalMediaStore, MediaStorageError, type PublicMediaDeliveryOptions } from './storage.js';

const etag = 'W/"public-image"';

function fixture() {
  let authorized = true;
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const accesses: Array<{ method: string; id: string; variant?: 'thumb'; options?: PublicMediaDeliveryOptions }> = [];
  const db = {
    pool: {
      query: async (sql: string, values: unknown[]) => {
        queries.push({ sql, values });
        return authorized ? { rowCount: 1, rows: [{ id: values[0] }] } : { rowCount: 0, rows: [] };
      },
    },
  } as unknown as Database;
  const store = {
    async read(id: string) {
      accesses.push({ method: 'read', id });
      return Buffer.from('display image');
    },
    async prepareDelivery(id: string, variant?: 'thumb') {
      accesses.push({ method: 'prepareDelivery', id, variant });
      return { filename: `${id}${variant ? '.thumb' : ''}.webp`, byteSize: 100 };
    },
    async preparePublicDelivery(id: string, variant: 'thumb' | undefined, options: PublicMediaDeliveryOptions) {
      accesses.push({ method: 'preparePublicDelivery', id, variant, options });
      return {
        filename: `${id}${variant ? '.thumb' : ''}.webp`, byteSize: 100, etag, notModified: false,
        body: options.readBody ? Buffer.from(variant ? 'thumbnail' : 'display image') : undefined,
      };
    },
  } as unknown as LocalMediaStore;
  return {
    service: new MediaService(db, store), store, queries, accesses,
    revoke: () => { authorized = false; },
  };
}

const unavailable = (error: unknown) => error instanceof ApiError && error.status === 404 && error.code === 'NOT_FOUND';

test('public delivery checks current publication before either body or metadata delivery', async () => {
  const { service, queries, accesses } = fixture();
  const id = randomUUID();
  const bodyOptions = { readBody: true };
  const metadataOptions = { readBody: false, ifNoneMatch: 'W/"previous-image"' };
  assert.equal((await service.publicDelivery(id, undefined, bodyOptions)).body?.toString(), 'display image');
  assert.equal((await service.publicDelivery(id, 'thumb', bodyOptions)).body?.toString(), 'thumbnail');
  assert.deepEqual(await service.publicDelivery(id, undefined, metadataOptions), {
    filename: `${id}.webp`, byteSize: 100, etag, notModified: false, body: undefined,
  });
  assert.deepEqual(await service.publicDelivery(id, 'thumb', metadataOptions), {
    filename: `${id}.thumb.webp`, byteSize: 100, etag, notModified: false, body: undefined,
  });
  assert.equal(queries.length, 4);
  assert.ok(queries.every(({ sql, values }) => sql === queries[0]?.sql && values[0] === id));
  // In particular, a historical reference alone is not permission to serve it.
  const sql = queries[0]!.sql;
  assert.match(sql, /v\.published_revision_id\s*=\s*pm\.publication_id/);
  assert.match(sql, /m\.state='ready'/);
  assert.match(sql, /v\.publication_state='published'/);
  assert.match(sql, /v\.deleted_at IS NULL/);
  assert.deepEqual(accesses, [
    { method: 'preparePublicDelivery', id, variant: undefined, options: bodyOptions },
    { method: 'preparePublicDelivery', id, variant: 'thumb', options: bodyOptions },
    { method: 'preparePublicDelivery', id, variant: undefined, options: metadataOptions },
    { method: 'preparePublicDelivery', id, variant: 'thumb', options: metadataOptions },
  ]);
});

test('preview buffer and file delivery share ready-media and active-vehicle checks', async () => {
  const { service, queries, accesses } = fixture();
  const id = randomUUID();
  assert.equal((await service.preview(id)).toString(), 'display image');
  assert.deepEqual(await service.previewFile(id), { filename: `${id}.webp`, byteSize: 100 });
  assert.equal(queries.length, 2);
  assert.equal(queries[0]?.sql, queries[1]?.sql);
  assert.ok(queries.every(({ values }) => values[0] === id));
  assert.match(queries[0]!.sql, /m\.state='ready'/);
  assert.match(queries[0]!.sql, /v\.deleted_at IS NULL/);
  assert.deepEqual(accesses, [{ method: 'read', id }, { method: 'prepareDelivery', id, variant: undefined }]);
});

test('revoked public access is rechecked on every request and never prepares an internal filename', async () => {
  const { service, queries, accesses, revoke } = fixture();
  const id = randomUUID();
  await service.publicDelivery(id, undefined, { readBody: false });
  revoke();
  for (const variant of [undefined, 'thumb'] as const) {
    await assert.rejects(service.publicDelivery(id, variant, { readBody: false, ifNoneMatch: etag }), unavailable);
    await assert.rejects(service.publicDelivery(id, variant, { readBody: true }), unavailable);
  }
  assert.equal(queries.length, 5);
  assert.deepEqual(accesses, [{ method: 'preparePublicDelivery', id, variant: undefined, options: { readBody: false } }]);
});

test('revoked preview access prevents both file preparation and buffer reads', async () => {
  const { service, queries, accesses, revoke } = fixture();
  const id = randomUUID();
  await service.previewFile(id);
  revoke();
  await assert.rejects(service.previewFile(id), unavailable);
  await assert.rejects(service.preview(id), unavailable);
  assert.equal(queries.length, 3);
  assert.deepEqual(accesses, [{ method: 'prepareDelivery', id, variant: undefined }]);
});

test('storage disappearance after authorization is propagated without a buffer fallback', async (t) => {
  const { service, store, accesses } = fixture();
  const missing = new MediaStorageError('MEDIA_NOT_FOUND', 'The media file does not exist.');
  const publicPreparation = t.mock.method(store, 'preparePublicDelivery', async () => { throw missing; });
  const previewPreparation = t.mock.method(store, 'prepareDelivery', async () => { throw missing; });
  await assert.rejects(service.publicDelivery(randomUUID(), undefined, { readBody: false }), (error) => error === missing);
  await assert.rejects(service.publicDelivery(randomUUID(), 'thumb', { readBody: false }), (error) => error === missing);
  await assert.rejects(service.previewFile(randomUUID()), (error) => error === missing);
  assert.equal(publicPreparation.mock.callCount(), 2);
  assert.equal(previewPreparation.mock.callCount(), 1);
  assert.deepEqual(accesses, []);
});

test('authorization database failure cannot generate a filename or trigger a file read', async () => {
  const unavailableDb = new Error('fixture database unavailable');
  const db = { pool: { query: async () => { throw unavailableDb; } } } as unknown as Database;
  let accessed = false;
  const store = {
    preparePublicDelivery: async () => { accessed = true; throw new Error('must not reach storage'); },
    prepareDelivery: async () => { accessed = true; throw new Error('must not reach storage'); },
    read: async () => { accessed = true; throw new Error('must not reach storage'); },
  } as unknown as LocalMediaStore;
  const service = new MediaService(db, store);
  await assert.rejects(service.publicDelivery(randomUUID(), undefined, { readBody: false }), (error) => error === unavailableDb);
  await assert.rejects(service.previewFile(randomUUID()), (error) => error === unavailableDb);
  assert.equal(accessed, false);
});
