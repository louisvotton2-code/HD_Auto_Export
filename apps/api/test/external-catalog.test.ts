import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, mock, test } from 'node:test';
import type { InjectOptions } from 'fastify';
import sharp from 'sharp';
import * as admin from '@hd/contracts/admin';
import * as publicApi from '@hd/contracts/public';
import { externalFixtureId, makeExternalCandidateFixture, makeExternalImportFixture, makeExternalVehicleDraftFixture,
  makeExternalWithdrawalFixture, makeVehicleDraftFixture } from '@hd/contracts/fixtures';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { chinaCarSampleProfile } from '../src/external/profiles.js';
import { ExternalStore } from '../src/external/store.js';
import { finishTrialAttempt, markTrialAttemptDispatched, reserveTrialAttempt } from '../src/external/trial.js';
import { createStaff } from '../src/staff-cli.js';

const maintenanceUrl = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
if (maintenanceUrl.hostname !== '127.0.0.1' || maintenanceUrl.pathname !== '/postgres' || maintenanceUrl.search || maintenanceUrl.hash) {
  throw new Error('External catalog tests require a local 127.0.0.1 PostgreSQL maintenance database without URL options.');
}
const name = `hd_ext_test_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(maintenanceUrl);
databaseUrl.pathname = `/${name}`;
const maintenance = createDatabase(maintenanceUrl.toString(), 2);
const origin = 'http://127.0.0.1:3318';
const password = 'Isolated-external-catalog-password!';
const base = '/api/v1/admin/external';
// Routes capture fetch during buildApp; install this before constructing the app.
const remoteFetch = mock.method(globalThis, 'fetch', async () => { throw new Error('External catalog integration must not request a remote service'); });
let runtime: Awaited<ReturnType<typeof buildApp>>;
let temp: string;
let adminCookie: string;
let editorCookie: string;
let adminId: string;
let manualId: string;
let batchId: string;
let trial: admin.ExternalTrial;
let cachedTrial: admin.ExternalTrial;
let request = 0;
const records: admin.ExternalBatchRecord[] = [];
const sample = makeExternalImportFixture(200);
const headers = (cookie = adminCookie, key = randomUUID()) => ({ origin, cookie, 'idempotency-key': key });
const call = (options: InjectOptions) => runtime.app.inject({ remoteAddress: `198.51.${Math.floor(request / 240)}.${(++request % 240) + 1}`, ...options });
const listingId = (row: number) => records[row - 1]!.listingId!;
const detailPath = (id: string, locale = 'en') => `/api/v1/vehicles/${id}?locale=${locale}&view=localized`;
const importBatch = (payload: admin.ExternalImportBatchRequest, key = randomUUID()) => call({ method: 'POST', url: `${base}/batches`, headers: headers(adminCookie, key), payload });
const one = (candidate: admin.ExternalCandidate): admin.ExternalImportBatchRequest => ({ provider: 'synthetic-feed', records: [{ candidate, raw: JSON.stringify(candidate) }] });

async function adminListings(params: Record<string, string> = {}) {
  const response = await call({ url: `${base}/listings?${new URLSearchParams(params)}`, headers: { cookie: editorCookie } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  return admin.ExternalListingListResponseSchema.parse(response.json()).data;
}

async function providerStatus() {
  const response = await call({ url: `${base}/provider-status`, headers: { cookie: editorCookie } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  return admin.ExternalProviderStatusResponseSchema.parse(response.json()).data;
}

async function getListing(id: string) {
  const response = await call({ url: `${base}/listings/${id}?locale=en`, headers: headers(editorCookie) });
  assert.equal(response.statusCode, 200, response.body);
  return admin.ExternalListingResponseSchema.parse(response.json()).data;
}
async function publicVehicle(id: string, locale = 'en') {
  const response = await call({ url: detailPath(id, locale) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  return publicApi.PublicVehicleResponseSchema.parse(response.json()).data;
}
async function list(params = 'pageSize=48') {
  const response = await call({ url: `/api/v1/vehicles?locale=en&view=localized&${params}` });
  assert.equal(response.statusCode, 200, response.body);
  return publicApi.PublicVehicleListSchema.parse(response.json());
}
async function getTrial(id: string) {
  const response = await call({ url: `${base}/batches/${id}/translation-trial`, headers: headers(editorCookie) });
  assert.equal(response.statusCode, 200, response.body);
  return admin.ExternalTrialResponseSchema.parse(response.json()).data;
}
async function revise(id: string, body: admin.SaveExternalOverrides, key = randomUUID()) {
  return call({ method: 'PUT', url: `${base}/listings/${id}/overrides`, headers: headers(editorCookie, key), payload: body });
}
async function readRecords(id: string, page = 1) {
  const response = await call({ url: `${base}/batches/${id}/records?page=${page}&pageSize=100`, headers: headers(editorCookie) });
  assert.equal(response.statusCode, 200, response.body);
  return admin.ExternalBatchRecordsResponseSchema.parse(response.json()).data.items;
}

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'hd-external-catalog-'));
  await maintenance.pool.query(`CREATE DATABASE "${name}"`);
  runtime = await buildApp(readConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl.toString(), EXTERNAL_CATALOG_MODE: 'synthetic',
    AUTH_SECRET: randomBytes(32).toString('hex'), AUTH_BASE_URL: origin, TRUSTED_ORIGINS: origin, MEDIA_ROOT: path.join(temp, 'media'),
    TRANSLATION_PROVIDER: 'disabled' }));
  assert.equal((await call({ url: '/health/ready' })).statusCode, 503);
  await migrateDatabase(runtime.db);
  await migrateDatabase(runtime.db);
  assert.equal((await call({ url: '/health/ready' })).statusCode, 200);
  for (const role of ['admin', 'editor'] as const) {
    const email = `${role}@external.example.invalid`;
    const account = await createStaff(runtime.auth, { email, name: `Isolated ${role}`, role, password });
    const response = await call({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email, password } });
    assert.equal(response.statusCode, 200, response.body);
    const cookie = response.cookies.map(item => `${item.name}=${item.value}`).join('; ');
    assert.ok(cookie);
    if (role === 'admin') { adminCookie = cookie; adminId = account.user.id; }
    else editorCookie = cookie;
  }
  const actor = { id: adminId, requestId: 'isolated-external-staff-fixture' };
  const draft = makeVehicleDraftFixture();
  draft.media = [];
  draft.facts = { ...draft.facts, make: { id: 'toyota', name: 'Toyota' }, model: { id: 'synthetic-r1', name: 'Example R1' }, trim: { id: 'test-trim', name: 'Test trim' }, powertrain: 'hev' };
  draft.price = { kind: 'asking', money: { amount: '128000.50', currency: 'CNY' }, includes: [] };
  let vehicle = await runtime.inventory.create(draft, actor, randomUUID());
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#223344' } }).png().toBuffer();
  const upload = await runtime.media.create({ vehicleId: vehicle.id, contentType: 'image/png', sizeBytes: png.length,
    rights: { basis: 'owned', note: 'Synthetic staff ordering fixture' } }, actor);
  const stored = await runtime.media.upload(upload.media.id, upload.media.version, png, 'image/png', actor);
  const photo = await runtime.media.complete(stored.id, stored.version, actor);
  vehicle.draft.media = [{ id: photo.id, alt: 'Fixture', isCover: true, sortOrder: 0 }];
  vehicle = await runtime.inventory.save(vehicle.id, vehicle.version, vehicle.draft, actor);
  vehicle = await runtime.inventory.availability(vehicle.id, { version: vehicle.version, availability: 'available', checkedAt: new Date().toISOString() }, actor);
  const localization = await runtime.inventory.getLocalization(vehicle.id);
  for (const field of localization.data.fields) for (const locale of ['zh', 'en', 'ru'] as const) {
    field.translations[locale] = { text: field.sourceText, kind: 'human', reviewStatus: 'approved',
      sourceVersion: field.sourceVersion, humanEditVersion: 0, engineVersion: null };
  }
  await runtime.inventory.saveLocalization(vehicle.id, { vehicleVersion: vehicle.version, revision: localization.revision, data: localization.data }, actor);
  vehicle = await runtime.inventory.getAdmin(vehicle.id);
  const preview = await runtime.inventory.publicationPreview(vehicle.id, 'zh', actor);
  await runtime.inventory.confirmPublicationPreview(vehicle.id, { version: preview.vehicleVersion,
    publicContentRevision: preview.publicContentRevision, fingerprint: preview.fingerprint, locale: preview.locale }, actor);
  vehicle = await runtime.inventory.publish(vehicle.id, vehicle.version, actor, randomUUID());
  manualId = vehicle.id;
});

after(async () => {
  if (runtime) await runtime.app.close();
  try { await maintenance.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
  finally {
    await maintenance.close();
    if (temp) await rm(temp, { recursive: true, force: true });
    remoteFetch.mock.restore();
  }
});

test('a bounded sample import archives malformed rows and concurrent retries share a permanent receipt', async () => {
  const invalid = { ...makeExternalCandidateFixture(201), listingUrl: 'https://listings.example.invalid.attacker.invalid/a' };
  sample.records.push({ candidate: { operation: 'upsert' }, raw: 'PRIVATE_RAW_UNPARSEABLE\u0000' });
  sample.records.push({ candidate: invalid, raw: JSON.stringify(invalid) });
  const deepCandidate = JSON.parse('['.repeat(2000) + '0' + ']'.repeat(2000));
  sample.records.push({ candidate: deepCandidate, raw: 'PRIVATE_DEEPLY_NESTED_RAW' });
  const zeroYear = '0000-01-01T00:00:00Z';
  await assert.rejects(runtime.db.pool.query('SELECT $1::timestamptz', [zeroYear]), { code: '22008' });
  const overPrecise = '9999-12-31T23:59:59.9999999Z';
  const validCandidate = makeExternalCandidateFixture(210);
  sample.records.push(
    { candidate: { ...validCandidate, fetchedAt: zeroYear }, raw: 'INVALID_CAPTURE_TIME' },
    { candidate: { ...validCandidate, sourceUpdatedAt: zeroYear }, raw: 'INVALID_SOURCE_TIME' },
    { candidate: { ...validCandidate, images: [{ ...validCandidate.images[0], expiresAt: zeroYear }] }, raw: 'INVALID_EXPIRY_TIME' },
    { candidate: { ...validCandidate, sourceUpdatedAt: overPrecise }, raw: 'UNSAFE_FRACTIONAL_TIME' },
  );
  for (const [auth, expected] of [[headers(''), 401], [headers(editorCookie), 403], [{ ...headers(), origin: 'https://other.invalid' }, 403]] as const) {
    assert.equal((await call({ method: 'POST', url: `${base}/batches`, headers: auth, payload: sample })).statusCode, expected);
  }
  assert.equal((await importBatch({ ...one(makeExternalCandidateFixture(1)), provider: 'chinacarapi-sample' })).statusCode, 422);
  const key = randomUUID();
  const responses = await Promise.all([importBatch(sample, key), importBatch(sample, key)]);
  for (const response of responses) assert.equal(response.statusCode, 201, response.body);
  const first = admin.ExternalBatchResponseSchema.parse(responses[0]!.json()).data;
  assert.deepEqual(admin.ExternalBatchResponseSchema.parse(responses[1]!.json()).data, first);
  assert.deepEqual(first.counts, { total: 207, applied: 200, unchanged: 0, ignored: 0, rejected: 7 });
  batchId = first.id;
  assert.equal((await importBatch(one(makeExternalCandidateFixture(1)), key)).statusCode, 409);
  for (const page of [1, 2, 3]) records.push(...await readRecords(batchId, page));
  assert.equal(records[200]?.reason, 'identity_unconfirmed');
  assert.equal(records[201]?.reason, 'unsafe_listing_url');
  assert.equal(records[202]?.reason, 'invalid_record');
  assert.ok(records.slice(203).every(record => record.reason === 'invalid_record'));
  const rawPath = `${base}/batches/${batchId}/records/201/raw`;
  assert.equal((await call({ url: rawPath, headers: headers(editorCookie) })).statusCode, 403);
  const raw = await call({ url: rawPath, headers: headers() });
  assert.equal(admin.ExternalRawRecordResponseSchema.parse(raw.json()).data.raw, 'PRIVATE_RAW_UNPARSEABLE\u0000');
  assert.equal(admin.ExternalRawRecordResponseSchema.parse((await call({ url: `${base}/batches/${batchId}/records/203/raw`, headers: headers() })).json()).data.raw,
    'PRIVATE_DEEPLY_NESTED_RAW');
  assert.equal((await runtime.db.pool.query('SELECT count(*)::int AS count FROM external_import_batches')).rows[0].count, 1);
});

test('public pagination is staff-first and exact; detail comparison, price and disputes use the same projection', async () => {
  const ids = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const response = await list(`page=${page}&pageSize=48`);
    assert.equal(response.meta.total, 201);
    assert.equal(response.data.hasMore, page !== 5);
    if (page === 1) assert.equal(response.data.items[0]?.id, manualId);
    for (const item of response.data.items) {
      assert.ok(!ids.has(item.id));
      assert.equal(item.external?.detail, undefined);
      ids.add(item.id);
    }
  }
  assert.equal(ids.size, 201);
  assert.equal((await list('page=6&pageSize=48')).data.items.length, 0);
  const legacy = await call({ url: '/api/v1/vehicles?locale=en&view=legacy' });
  assert.equal(publicApi.PublicVehicleListSchema.parse(legacy.json()).meta.total, 1);
  assert.equal((await call({ url: `/api/v1/vehicles/${listingId(1)}?locale=en` })).statusCode, 404);
  const facets = await call({ url: '/api/v1/vehicle-filters?locale=en&view=localized' });
  const filters = publicApi.PublicVehicleFiltersSchema.parse(facets.json()).data;
  assert.equal(filters.total, 201);
  assert.deepEqual(filters.powertrains, [{ id: 'hev', count: 200 }]);
  assert.deepEqual(filters.modelYears, [{ year: 2024, count: 200 }]);
  const range = await list('make=toyota&yearMin=2024&powertrain=hev&priceMin=128000.50&priceMax=128000.50&priceCurrency=CNY');
  assert.equal(range.meta.total, 199);
  assert.equal((await list('powertrain=unknown')).meta.total, 0);
  assert.equal((await list('priceMin=1&priceCurrency=USD')).meta.total, 0);
  assert.equal((await list('q=Example%20R1%20Hybrid')).meta.total, 1);
  for (const locale of ['zh', 'en', 'ru'] as const) {
    const ready = await publicVehicle(listingId(1), locale);
    assert.equal(ready.content.title.kind, locale === 'zh' ? 'original' : 'supplier');
    assert.equal(ready.external?.detail?.original.title?.contentLocale, 'zh');
    assert.equal(ready.external?.detail?.specifications.length, 1);
    assert.equal(ready.external?.detail?.inspection?.entries.length, 1);
    assert.equal(ready.price.money?.amount, '128000.50');
    assert.equal(ready.availability, 'unknown');
    assert.equal(ready.availabilityCheckedAt, null);
    assert.equal(ready.images[0]?.width, null);
    assert.doesNotMatch(JSON.stringify(ready), /PRIVATE_RAW|sellerPrice|sourceHash|externalId|139000/);
  }
  const fallback = await publicVehicle(listingId(2), 'ru');
  assert.equal(fallback.content.title.contentLocale, 'zh');
  assert.equal(fallback.display?.model.provenance, 'catalog');
  const disputed = await publicVehicle(listingId(3));
  assert.equal(disputed.facts.modelYear, null);
  assert.equal(disputed.facts.powertrain, 'unknown');
  assert.equal(disputed.external?.detail?.original.title, null);
  assert.equal(disputed.content.title.kind, 'catalog');
  assert.equal(disputed.content.description, null);
  const missing = await publicVehicle(listingId(4));
  assert.equal(missing.price.kind, 'on_request');
  assert.deepEqual(missing.images, []);
  assert.equal(await getTrial(batchId), null);
});

test('same-event sync is a no-op and source identity preserves platform and staff boundaries', async () => {
  const candidate = { ...makeExternalCandidateFixture(1), fetchedAt: '2026-11-09T08:00:00Z' };
  const response = await importBatch(one(candidate));
  assert.equal(admin.ExternalBatchResponseSchema.parse(response.json()).data.counts.unchanged, 1);
  const changed = await importBatch(one({ ...candidate, price: { cny: '1' } }));
  const rejected = admin.ExternalBatchResponseSchema.parse(changed.json()).data.id;
  assert.equal((await readRecords(rejected))[0]?.reason, 'revision_conflict');
  const other = await importBatch(one({ ...candidate, platformId: 'synthetic-market-alt' }));
  const otherId = (await readRecords(admin.ExternalBatchResponseSchema.parse(other.json()).data.id))[0]!.listingId!;
  assert.notEqual(otherId, listingId(1));
  const staffDraft = makeExternalVehicleDraftFixture();
  assert.equal(staffDraft.source.kind, 'external');
  if (staffDraft.source.kind !== 'external') throw new Error('Expected a staff external draft');
  staffDraft.media = [];
  staffDraft.source = { ...staffDraft.source, platform: { id: 'synthetic-market', name: 'Synthetic Market' }, externalId: 'synthetic-0900' };
  const staff = await runtime.inventory.create(staffDraft, { id: adminId, requestId: 'staff-collision' }, randomUUID());
  const duplicate = await importBatch(one(makeExternalCandidateFixture(900)));
  assert.equal((await readRecords(admin.ExternalBatchResponseSchema.parse(duplicate.json()).data.id))[0]?.reason, 'staff_listing_exists');
  assert.equal((await importBatch(makeExternalWithdrawalFixture(900, 1))).statusCode, 201);
  const reactivate = await importBatch(one({ ...makeExternalCandidateFixture(900), revision: 2 }));
  assert.equal((await readRecords(admin.ExternalBatchResponseSchema.parse(reactivate.json()).data.id))[0]?.reason, 'staff_listing_exists');
  assert.deepEqual((await runtime.inventory.getAdmin(staff.id)).draft, staff.draft);
});

test('employee facts and text survive eligible source changes while concurrent edits retain source hash guards', async () => {
  const id = listingId(2);
  const current = await getListing(id);
  const override = { version: current.version, overrides: { hidden: false, facts: { modelYear: 2025 },
    text: [{ field: 'title' as const, locale: 'en' as const, sourceHash: current.sourceHashes.title!, text: 'Staff checked title' }] } };
  const key = randomUUID();
  const responses = await Promise.all([revise(id, override, key), revise(id, override, key)]);
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(responses.map(response => response.json().data.version), [current.version + 1, current.version + 1]);
  assert.equal((await publicVehicle(id)).content.title.text, 'Staff checked title');
  assert.equal((await revise(id, override)).statusCode, 409);
  const revision = makeExternalCandidateFixture(2);
  revision.revision = 2;
  revision.facts.modelYear = 2026;
  revision.copy.title!.original.text = '新的合成标题';
  assert.equal((await importBatch(one(revision))).statusCode, 201);
  const updated = await getListing(id);
  assert.equal(updated.overrides.facts.modelYear, 2025);
  assert.equal(updated.overrides.text[0]?.text, 'Staff checked title');
  assert.notEqual(updated.sourceHashes.title, current.sourceHashes.title);
  const currentPublic = await publicVehicle(id);
  assert.equal(currentPublic.facts.modelYear, 2025);
  assert.equal(currentPublic.content.title.text, 'Staff checked title');
  assert.equal(currentPublic.external?.detail?.original.title?.text, '新的合成标题');
  assert.equal((await list('yearMin=2025&yearMax=2025')).meta.total, 1);
  const stale = structuredClone(updated.overrides);
  stale.text[0]!.text = 'Edited with a stale source hash';
  assert.equal((await revise(id, { version: updated.version, overrides: stale })).statusCode, 409);
  const audits = await runtime.db.pool.query('SELECT count(*)::int AS count FROM external_override_events WHERE listing_id=$1', [id.slice(4)]);
  assert.equal(audits.rows[0].count, 1);
});

test('stable remote IDs handle refresh and expiry; failure hints contain no URL and deduplicate by revision', async () => {
  const id = listingId(5);
  const image = (await publicVehicle(id)).images[0]!;
  const url = `/api/v1/external-media/${image.id}/failure`;
  const hint = (payload: object) => call({ method: 'POST', url, payload });
  assert.equal((await hint({ revision: image.remote!.revision, url: image.url })).statusCode, 400);
  const repeats = await Promise.all([hint({ revision: 1 }), hint({ revision: 1 })]);
  for (const response of repeats) assert.equal(response.statusCode, 202, response.body);
  assert.deepEqual(repeats.map(response => response.json().data.queued).sort(), [false, true]);
  const revision = makeExternalCandidateFixture(5);
  revision.revision = 2;
  revision.images[0]!.url = 'https://photos.example.invalid/reissued.webp';
  revision.images[0]!.expiresAt = '2001-01-01T00:00:00Z';
  revision.images.push({ ...revision.images[0]!, sourceMediaId: 'other', url: 'https://photos.example.invalid.attacker.invalid/a.webp' });
  assert.equal((await importBatch(one(revision))).statusCode, 201);
  assert.equal((await hint({ revision: 1 })).statusCode, 404);
  assert.deepEqual((await publicVehicle(id)).images, []);
  const saved = await runtime.db.pool.query('SELECT id,revision FROM external_media WHERE listing_id=$1', [id.slice(4)]);
  assert.deepEqual(saved.rows, [{ id: image.id.slice(5), revision: 2 }]);
  const queue = await runtime.db.pool.query('SELECT media_revision FROM external_media_refresh_requests WHERE media_id=$1 ORDER BY media_revision', [image.id.slice(5)]);
  assert.deepEqual(queue.rows.map(row => row.media_revision), [1, 2]);
});

test('explicit withdrawal and staff hiding take effect immediately and out-of-order events cannot restore either', async () => {
  const id = listingId(1);
  const image = (await publicVehicle(id)).images[0]!;
  const afterWithdrawal = await importBatch(makeExternalWithdrawalFixture(1));
  assert.equal(afterWithdrawal.statusCode, 201, afterWithdrawal.body);
  const archived = await getListing(id);
  assert.equal(archived.state, 'withdrawn');
  assert.equal(archived.vehicle, null);
  assert.equal((await call({ url: detailPath(id) })).statusCode, 404);
  assert.equal((await call({ method: 'POST', url: `/api/v1/external-media/${image.id}/failure`, payload: { revision: 1 } })).statusCode, 404);
  assert.equal((await importBatch(one(makeExternalCandidateFixture(1)))).json().data.counts.ignored, 1);
  assert.equal((await list('q=Example%20R1%20Hybrid')).meta.total, 1); // Other platform identity remains visible.
  const second = await getListing(listingId(2));
  const items = [{ id: second.id, version: second.version }, { id: listingId(3), version: 999 }, { id: externalFixtureId(999), version: 1 }];
  const bulk = await call({ method: 'POST', url: `${base}/listings/bulk-visibility`, headers: headers(editorCookie), payload: { hidden: true, items } });
  assert.equal(bulk.statusCode, 200, bulk.body);
  assert.deepEqual(admin.ExternalBulkVisibilityResponseSchema.parse(bulk.json()).data.items.map(item => item.status), ['applied', 'failed', 'failed']);
  assert.equal((await call({ url: detailPath(second.id) })).statusCode, 404);
  assert.equal((await importBatch(one({ ...makeExternalCandidateFixture(2), revision: 3 }))).statusCode, 201);
  assert.equal((await getListing(second.id)).state, 'hidden');
  assert.equal((await revise(id, { version: archived.version, overrides: { hidden: false, facts: {}, text: [] } })).statusCode, 422);
});

test('100 fixed archived IDs yield an auditable dry run; new requests do not select other vehicles', async () => {
  const path = `${base}/batches/${batchId}/translation-trial`;
  const ids = records.slice(0, 100).map(record => record.listingId!);
  const post = (vehicleIds: string[], cookie = adminCookie) => call({ method: 'POST', url: path, headers: headers(cookie), payload: { vehicleIds } });
  assert.equal((await post(ids, editorCookie)).statusCode, 403);
  assert.equal((await post(ids.slice(1))).statusCode, 400);
  assert.equal((await post([externalFixtureId(1000), ...ids.slice(1)])).statusCode, 422);
  const response = await post(ids);
  assert.equal(response.statusCode, 201, response.body);
  trial = admin.ExternalTrialResponseSchema.parse(response.json()).data!;
  assert.deepEqual(trial.vehicleIds, ids);
  const e = trial.estimate;
  assert.ok(e.existingCharacters > 0 && e.glossaryCharacters > 0 && e.duplicateCharacters > 0 && e.estimatedCharacters > 0);
  assert.equal(e.grossCharacters, e.existingCharacters + e.glossaryCharacters + e.cachedCharacters + e.duplicateCharacters + e.estimatedCharacters);
  assert.deepEqual(trial.budget, { month: trial.budget.month, batchLimit: 100_000, accountFreeRemaining: null, reservedCharacters: 0, attemptedCharacters: 0, realCalls: 0 });
  assert.equal((await post([...ids].reverse())).statusCode, 409);
  assert.equal((await post(ids)).json().data.id, trial.id);
  assert.deepEqual(await getTrial(batchId), trial);
  const work = (await runtime.db.pool.query('SELECT call_key FROM external_translation_work WHERE trial_id=$1 LIMIT 1', [trial.id])).rows[0]!;
  await runtime.db.pool.query('INSERT INTO external_translation_cache(call_key,result) VALUES($1,$2)', [work.call_key, 'Synthetic cached result']);
  const repeated = await importBatch({ provider: sample.provider, records: sample.records.slice(0, 100) });
  const next = admin.ExternalBatchResponseSchema.parse(repeated.json()).data;
  // The first two archived events are stale. Use an independent fresh fixture batch for a second budget scope.
  assert.ok(next.counts.ignored > 0);
  const nextSample = makeExternalImportFixture(100);
  nextSample.records = nextSample.records.map(record => ({ ...record, candidate: { ...(record.candidate as admin.ExternalUpsertCandidate), platformId: 'synthetic-market-alt', revision: 10 } }));
  const nextBatch = admin.ExternalBatchResponseSchema.parse((await importBatch(nextSample)).json()).data.id;
  const nextIds = (await readRecords(nextBatch)).map(record => record.listingId!);
  const planned = await call({ method: 'POST', url: `${base}/batches/${nextBatch}/translation-trial`, headers: headers(), payload: { vehicleIds: nextIds } });
  assert.equal(planned.statusCode, 201, planned.body);
  cachedTrial = admin.ExternalTrialResponseSchema.parse(planned.json()).data!;
  assert.ok(cachedTrial.estimate.cachedCharacters > 0);
  assert.ok(cachedTrial.estimate.estimatedCharacters < trial.estimate.estimatedCharacters);
  console.log(`synthetic dry run: ${JSON.stringify(trial.estimate)}`);
});

test('the durable ledger fails closed, shares a monthly allowance, and counts dispatch once across connections', async () => {
  const work = (await runtime.db.pool.query<{ call_key: string; characters: number }>(`SELECT a.call_key,a.characters FROM external_translation_work a
    JOIN external_translation_work b ON b.call_key=a.call_key WHERE a.trial_id=$1 AND b.trial_id=$2 LIMIT 1`, [trial.id, cachedTrial.id])).rows[0]!;
  assert.ok(work.characters > 1);
  const month = `${trial.budget.month}-01`;
  const attempt = randomUUID();
  const nextAttempt = randomUUID();
  assert.equal(await reserveTrialAttempt(runtime.db, trial.id, work.call_key, attempt), false);
  await runtime.db.pool.query("UPDATE external_translation_months SET verified_allowance=$2,verified_until=now()+interval '10 minutes' WHERE month=$1", [month, work.characters]);
  const other = createDatabase(databaseUrl.toString(), 2);
  try {
    const claims = await Promise.all([reserveTrialAttempt(runtime.db, trial.id, work.call_key, attempt), reserveTrialAttempt(other, cachedTrial.id, work.call_key, nextAttempt)]);
    assert.deepEqual([...claims].sort(), [false, true]);
    const winner = claims[0] ? trial : cachedTrial;
    const ticket = claims[0] ? attempt : nextAttempt;
    const dispatch = await Promise.all([markTrialAttemptDispatched(runtime.db, winner.id, ticket), markTrialAttemptDispatched(other, winner.id, ticket)]);
    assert.deepEqual(dispatch.sort(), [false, true]);
    await finishTrialAttempt(other, winner.id, ticket);
    assert.equal(await reserveTrialAttempt(other, winner.id, work.call_key, randomUUID()), false);
    const report = await getTrial(winner.batchId);
    assert.equal(report?.budget.attemptedCharacters, work.characters);
    assert.equal(report?.budget.realCalls, 0);
    await runtime.db.pool.query('UPDATE external_translation_months SET verified_allowance=1000000,attempted_characters=99999 WHERE month=$1', [month]);
    await runtime.db.pool.query('UPDATE external_translation_trials SET attempted_characters=99999 WHERE id=$1', [winner.id]);
    assert.equal(await reserveTrialAttempt(other, winner.id, work.call_key, randomUUID()), false);
  } finally { await other.close(); }
});

test('normal staff can search and page all external listing states without exposing raw import data', async () => {
  for (const endpoint of ['listings', 'listings/overview', 'provider-status']) {
    assert.equal((await call({ url: `${base}/${endpoint}` })).statusCode, 401);
  }
  const candidates = [9101, 9102, 9103, 9104].map(index => {
    const candidate = makeExternalCandidateFixture(index);
    candidate.externalId = `ops-list-${index}`;
    candidate.listingUrl = `https://listings.example.invalid/vehicles/${candidate.externalId}`;
    candidate.platformId = index === 9104 ? 'synthetic-market-alt' : 'synthetic-market';
    candidate.copy.title = { original: { text: `供应商标题 ${index}`, contentLocale: 'zh' }, translations: {
      en: { text: `Supplier Title ${index}`, contentLocale: 'en' }, ru: { text: `Заголовок поставщика ${index}`, contentLocale: 'ru' },
    } };
    candidate.facts.model = { id: `ops-model-${index}`, name: `Vendor Model ${index}` };
    if (index === 9102) candidate.facts.make = { id: 'source-toyota', name: '丰田' };
    candidate.copy.model = { original: { text: `Vendor Model ${index}`, contentLocale: 'en' }, translations: {} };
    if (index === 9103) candidate.disputes = ['modelYear', 'powertrain'];
    return candidate;
  });
  const imported = await importBatch({ provider: 'synthetic-feed', records: candidates.map(candidate => ({ candidate, raw: 'PRIVATE_SEARCH_ONLY_9101' })) });
  assert.equal(imported.statusCode, 201, imported.body);
  const created = await readRecords(admin.ExternalBatchResponseSchema.parse(imported.json()).data.id);
  assert.ok(created.every(record => record.status === 'applied'));
  const ids = created.map(record => record.listingId!);
  const hidden = await getListing(ids[1]!);
  assert.equal((await revise(hidden.id, { version: hidden.version, overrides: { hidden: true, facts: {}, text: [] } })).statusCode, 200);
  const withdraw = await importBatch(one({ operation: 'withdraw', externalId: candidates[2]!.externalId, platformId: 'synthetic-market',
    revision: 2, fetchedAt: '2026-11-10T00:00:00Z', sourceUpdatedAt: null }));
  assert.equal(withdraw.statusCode, 201, withdraw.body);
  const tombstone = await importBatch(one({ operation: 'withdraw', externalId: 'ops-list-9105', platformId: 'synthetic-market',
    revision: 1, fetchedAt: '2026-11-10T00:00:00Z', sourceUpdatedAt: null }));
  const tombstoneId = (await readRecords(admin.ExternalBatchResponseSchema.parse(tombstone.json()).data.id))[0]!.listingId!;
  const defaults = await adminListings({ q: 'ops-list-' });
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 50);
  assert.equal(defaults.total, 5);
  assert.deepEqual(new Set(defaults.items.map(item => item.id)), new Set([...ids, tombstoneId]));
  assert.equal(defaults.items.some(item => item.id === manualId), false);
  const dead = defaults.items.find(item => item.id === tombstoneId)!;
  assert.equal(dead.state, 'withdrawn');
  assert.equal(dead.title, null);
  assert.equal(dead.listingUrl, null);
  assert.equal(dead.publishedAt, null);
  const seen: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const slice = await adminListings({ q: 'ops-list-', page: String(page), pageSize: '2' });
    assert.equal(slice.total, 5);
    assert.equal(slice.page, page);
    assert.equal(slice.pageSize, 2);
    assert.equal(slice.items.length, page === 3 ? 1 : 2);
    seen.push(...slice.items.map(item => item.id));
  }
  assert.deepEqual(seen, defaults.items.map(item => item.id));
  const beyond = await adminListings({ q: 'ops-list-', page: '4', pageSize: '2' });
  assert.equal(beyond.total, 5);
  assert.deepEqual(beyond.items, []);
  for (const q of [ids[0]!, candidates[0]!.externalId, candidates[0]!.listingUrl, 'supplier title 9101', 'Vendor Model 9101']) {
    const found = await adminListings({ q, locale: 'en' });
    assert.equal(found.total, 1, q);
    assert.equal(found.items[0]?.id, ids[0], q);
  }
  for (const [locale, title] of [['zh', '供应商标题 9101'], ['en', 'Supplier Title 9101'], ['ru', 'Заголовок поставщика 9101']]) {
    const found = await adminListings({ q: candidates[0]!.externalId, locale: locale! });
    assert.equal(found.items[0]?.title, title);
    assert.equal(found.items[0]?.hasOverrides, false);
  }
  assert.deepEqual((await adminListings({ q: '  ops-list-  ' })).items, defaults.items);
  assert.deepEqual((await adminListings({ q: '' })).items, (await adminListings()).items);
  for (const [state, expected] of [['published', [ids[0], ids[3]]], ['hidden', [ids[1]]], ['withdrawn', [ids[2], tombstoneId]]] as const) {
    const filtered = await adminListings({ q: 'ops-list-', state });
    assert.equal(filtered.total, expected.length);
    assert.deepEqual(new Set(filtered.items.map(item => item.id)), new Set(expected));
  }
  const combined = await adminListings({ q: 'ops-list-', platformId: 'synthetic-market-alt', state: 'published', locale: 'ru', pageSize: '1' });
  assert.equal(combined.total, 1);
  assert.equal(combined.items[0]?.id, ids[3]);
  assert.equal((await adminListings({ q: 'ops-list-', platformId: 'synthetic-market-alt', state: 'hidden' })).total, 0);
  const attributes = { make: 'source-toyota', model: 'ops-model-9102', powertrain: 'hev', yearMin: '2024', yearMax: '2024', mileageMax: '10102' };
  const classified = await adminListings({ ...attributes, state: 'hidden' });
  assert.equal(classified.total, 1);
  assert.equal(classified.items[0]?.id, ids[1]);
  assert.equal(classified.items[0]?.facts?.model?.name, 'Vendor Model 9102');
  assert.equal(classified.items[0]?.facts?.mileageKm, 10102);
  const archived = await getListing(ids[1]!);
  assert.equal((await revise(archived.id, { version: archived.version, overrides: { ...archived.overrides, hidden: false } })).statusCode, 200);
  const visible = await adminListings({ ...attributes, state: 'published' });
  assert.deepEqual(visible.items[0]?.facts, classified.items[0]?.facts);
  const current = await getListing(ids[1]!);
  assert.equal((await revise(current.id, { version: current.version, overrides: { ...current.overrides, hidden: true } })).statusCode, 200);
  assert.equal((await adminListings({ ...attributes, mileageMax: '10101' })).total, 0);
  const conflicted = await adminListings({ q: 'ops-list-9103', state: 'withdrawn' });
  assert.equal(conflicted.items[0]?.facts?.modelYear, null);
  assert.equal(conflicted.items[0]?.facts?.powertrain, 'unknown');
  assert.equal((await adminListings({ q: 'ops-list-9103', state: 'withdrawn', yearMin: '2024' })).total, 0);
  const overviewResponse = await call({ url: `${base}/listings/overview?make=source-toyota`, headers: { cookie: editorCookie } });
  assert.equal(overviewResponse.statusCode, 200, overviewResponse.body);
  const overview = admin.ExternalListingOverviewResponseSchema.parse(overviewResponse.json()).data;
  assert.equal(overview.total, (await adminListings()).total);
  assert.equal(overview.published + overview.hidden + overview.withdrawn, overview.total);
  assert.ok(overview.platforms.includes('synthetic-market-alt'));
  assert.ok(overview.models.some(model => model.id === 'ops-model-9102'));
  assert.ok(overview.years.includes(2024));
  assert.equal((await adminListings({ q: 'PRIVATE_SEARCH_ONLY_9101' })).total, 0);
  assert.equal(JSON.stringify(defaults).includes('PRIVATE_SEARCH_ONLY_9101'), false);
  const invalidQueries: Record<string, string>[] = [{ page: '0' }, { pageSize: '101' }, { q: 'a'.repeat(2049) }, { q: '\u0000' },
    { state: 'active' }, { locale: 'de' }, { platformId: 'invalid/platform' }, { model: 'ops-model-9102' }, { yearMax: '0' }, { mileageMax: '-1' }];
  for (const invalid of invalidQueries) {
    const result = await call({ url: `${base}/listings?${new URLSearchParams(invalid)}`, headers: { cookie: editorCookie } });
    assert.equal(result.statusCode, 400, JSON.stringify(invalid));
  }
  for (const id of [ids[1]!, ids[2]!, tombstoneId]) assert.equal((await call({ url: detailPath(id) })).statusCode, 404);
});

test('manual copy survives eligible source refresh until staff remove it, with source archives and publication gates preserved', async () => {
  const current = (await adminListings({ q: 'ops-list-9101' })).items[0]!;
  const detail = await getListing(current.id);
  const title = 'Manual 100%_Ops\\Alpha';
  const model = 'Staff Model 9101';
  const description = 'Staff description 9101';
  const saved = await revise(detail.id, { version: detail.version, overrides: { hidden: false, facts: { modelYear: 2025 }, text: [
    { field: 'title', locale: 'en', sourceHash: detail.sourceHashes.title!, text: title },
    { field: 'model', locale: 'en', sourceHash: detail.sourceHashes.model!, text: model },
    { field: 'description', locale: 'en', sourceHash: detail.sourceHashes.description!, text: description },
  ] } });
  assert.equal(saved.statusCode, 200, saved.body);
  for (const q of [title.toLowerCase(), '%_', '\\Alpha', model.toLowerCase()]) {
    const found = await adminListings({ q, locale: 'en' });
    assert.equal(found.total, 1, q);
    assert.equal(found.items[0]?.id, current.id);
    assert.equal(found.items[0]?.title, title);
    assert.equal(found.items[0]?.hasOverrides, true);
  }
  assert.equal((await adminListings({ q: "' OR 1=1 --" })).total, 0);
  const originalCopy = structuredClone(detail.source!.copy);
  const refreshed = structuredClone(detail.source!);
  refreshed.revision++;
  refreshed.price = { cny: '198765.43' };
  refreshed.facts.mileageKm = 4321;
  refreshed.fetchedAt = '2026-11-11T00:00:00Z';
  refreshed.sourceUpdatedAt = '2026-11-10T23:00:00Z';
  assert.equal((await importBatch(one(refreshed))).statusCode, 201);
  const after = await getListing(current.id);
  assert.deepEqual(after.source!.copy, originalCopy);
  assert.deepEqual(after.sourceHashes, detail.sourceHashes);
  assert.equal(after.source!.facts.modelYear, 2024);
  assert.equal(after.overrides.facts.modelYear, 2025);
  assert.equal(after.overrides.text.find(item => item.field === 'title')?.text, title);
  const catalog = await list(`q=${encodeURIComponent(title)}`);
  assert.equal(catalog.meta.total, 1);
  const publicDetail = await publicVehicle(current.id);
  for (const vehicle of [catalog.data.items[0]!, publicDetail]) {
    assert.equal(vehicle.id, current.id);
    assert.equal(vehicle.content.title.text, title);
    assert.equal(vehicle.display?.model.text, model);
    assert.equal(vehicle.content.description?.text, description);
    assert.equal(vehicle.facts.modelYear, 2025);
    assert.equal(vehicle.facts.mileageKm, 4321);
    assert.deepEqual(vehicle.price, { kind: 'reference', money: { amount: '198765.43', currency: 'CNY' }, includes: [] });
  }
  for (const q of [title, model, 'Supplier Title 9101']) {
    assert.equal((await adminListings({ q, locale: 'en' })).items[0]?.id, current.id);
  }
  refreshed.revision++;
  refreshed.copy.title = { original: { text: 'New Supplier Title 9101', contentLocale: 'en' }, translations: {} };
  refreshed.copy.model = { original: { text: 'New Supplier Model 9101', contentLocale: 'en' }, translations: {} };
  refreshed.copy.description = { original: { text: 'New Supplier Description 9101', contentLocale: 'en' }, translations: {} };
  assert.equal((await importBatch(one(refreshed))).statusCode, 201);
  const changed = await getListing(current.id);
  assert.notEqual(changed.sourceHashes.title, detail.sourceHashes.title);
  assert.notEqual(changed.sourceHashes.model, detail.sourceHashes.model);
  assert.notEqual(changed.sourceHashes.description, detail.sourceHashes.description);
  assert.deepEqual(changed.source!.copy, refreshed.copy);
  assert.deepEqual(changed.overrides.text, after.overrides.text);
  for (const vehicle of [(await list(`q=${encodeURIComponent(title)}`)).data.items[0]!, await publicVehicle(current.id)]) {
    assert.equal(vehicle.content.title.text, title);
    assert.equal(vehicle.display?.model.text, model);
    assert.equal(vehicle.content.description?.text, description);
  }
  assert.equal((await adminListings({ q: model, locale: 'en' })).items[0]?.title, title);
  const otherIdentity = await importBatch(one({ ...refreshed, platformId: 'synthetic-market-alt' }));
  const otherId = (await readRecords(admin.ExternalBatchResponseSchema.parse(otherIdentity.json()).data.id))[0]!.listingId!;
  assert.notEqual(otherId, current.id);
  assert.equal((await publicVehicle(otherId)).content.title.text, 'New Supplier Title 9101');
  assert.deepEqual((await getListing(otherId)).overrides.text, []);
  const cleared = await revise(current.id, { version: changed.version, overrides: { ...changed.overrides, text: [] } });
  assert.equal(cleared.statusCode, 200, cleared.body);
  for (const vehicle of [(await list(`q=${encodeURIComponent('New Supplier Title 9101')}`)).data.items.find(item => item.id === current.id)!,
    await publicVehicle(current.id)]) {
    assert.equal(vehicle.content.title.text, 'New Supplier Title 9101');
    assert.equal(vehicle.display?.model.text, 'New Supplier Model 9101');
    assert.equal(vehicle.content.description?.text, 'New Supplier Description 9101');
  }
  assert.equal((await adminListings({ q: title })).total, 0);
  const clearDetail = await getListing(current.id);
  assert.equal((await revise(current.id, { version: clearDetail.version, overrides: { ...clearDetail.overrides,
    text: [{ field: 'title', locale: 'en', sourceHash: clearDetail.sourceHashes.title!, text: title }] } })).statusCode, 200);
  const disputed = { ...refreshed, revision: refreshed.revision + 1, disputes: ['modelYear'] as admin.ExternalUpsertCandidate['disputes'] };
  assert.equal((await importBatch(one(disputed))).statusCode, 201);
  const gated = await publicVehicle(current.id);
  assert.equal(gated.content.title.kind, 'catalog');
  assert.notEqual(gated.content.title.text, title);
  assert.equal(gated.content.description, null);
  assert.equal((await getListing(current.id)).overrides.text[0]?.text, title);
});

test('provider status separates ChinaCarAPI import receipts, fetched times and supplier times from synthetic data', async () => {
  const empty = await providerStatus();
  assert.deepEqual(empty, { provider: 'chinacarapi', worker: 'not_configured', lastBatch: null, lastImportAt: null,
    lastFetchedAt: null, lastSupplierUpdatedAt: null, account: { state: 'not_configured', checkedAt: null,
      plan: null, expiresAt: null, sources: [], dailyLimit: null, remainingToday: null } });
  const store = new ExternalStore(runtime.db, chinaCarSampleProfile);
  const actor = { id: adminId, requestId: 'isolated-provider-status-fixture' };
  const china = (index: number, fetchedAt: string, sourceUpdatedAt: string | null) => ({ ...makeExternalCandidateFixture(index),
    externalId: `provider-status-${index}`, platformId: 'che168', listingUrl: `https://www.che168.com/usedcar/provider-status-${index}.html`,
    images: [], fetchedAt, sourceUpdatedAt });
  const save = async (candidate: unknown, importedAt: string) => {
    const receipt = await store.importBatch({ provider: chinaCarSampleProfile.id, records: [{ candidate, raw: 'LOCAL_PROVIDER_STATUS_FIXTURE' }] }, randomUUID(), actor);
    // Fixed local receipt times distinguish ingestion chronology from provider chronology without wall-clock sleeps.
    await runtime.db.pool.query('UPDATE external_import_batches SET imported_at=$2 WHERE id=$1', [receipt.id, importedAt]);
    return { ...receipt, importedAt };
  };
  const first = await save(china(9201, '2026-11-09T08:00:00Z', '2026-11-08T08:00:00Z'), '2026-11-11T01:00:00.000Z');
  assert.equal(first.counts.applied, 1);
  const firstStatus = await providerStatus();
  assert.deepEqual(firstStatus.lastBatch, first);
  assert.equal(firstStatus.lastImportAt, first.importedAt);
  assert.equal(firstStatus.lastFetchedAt, '2026-11-09T08:00:00.000Z');
  assert.equal(firstStatus.lastSupplierUpdatedAt, '2026-11-08T08:00:00.000Z');
  const second = await save(china(9202, '2026-11-10T08:00:00Z', null), '2026-11-11T02:00:00.000Z');
  const third = await save(china(9203, '2026-11-07T08:00:00Z', '2026-11-09T08:00:00Z'), '2026-11-11T03:00:00.000Z');
  assert.equal(second.counts.applied, 1);
  assert.equal(third.counts.applied, 1);
  const failed = await save({ operation: 'upsert' }, '2026-11-11T04:00:00.000Z');
  assert.equal(failed.counts.rejected, 1);
  const synthetic = makeExternalCandidateFixture(9301);
  synthetic.fetchedAt = '2099-11-11T00:00:00Z';
  synthetic.sourceUpdatedAt = '2099-11-11T00:00:00Z';
  const other = admin.ExternalBatchResponseSchema.parse((await importBatch(one(synthetic))).json()).data;
  await runtime.db.pool.query('UPDATE external_import_batches SET imported_at=$2 WHERE id=$1', [other.id, '2099-11-11T00:00:00Z']);
  const status = await providerStatus();
  assert.deepEqual(status.lastBatch, failed);
  assert.equal(status.lastImportAt, third.importedAt);
  assert.equal(status.lastFetchedAt, '2026-11-10T08:00:00.000Z');
  assert.equal(status.lastSupplierUpdatedAt, '2026-11-09T08:00:00.000Z');
  assert.deepEqual(status.account, empty.account);
  assert.equal(status.worker, 'not_configured');
  const asAdmin = await call({ url: `${base}/provider-status`, headers: { cookie: adminCookie } });
  assert.equal(asAdmin.statusCode, 200, asAdmin.body);
  assert.deepEqual(admin.ExternalProviderStatusResponseSchema.parse(asAdmin.json()).data, status);
  assert.equal(remoteFetch.mock.callCount(), 0);
});

test('the provider operations migration repairs earlier supplier projections and is idempotent for public revisions', async () => {
  const candidate = makeExternalCandidateFixture(9401);
  candidate.copy.title = { original: { text: 'Upgrade Supplier Title', contentLocale: 'en' }, translations: {} };
  candidate.facts.model = { id: 'upgrade-model', name: 'Upgrade Supplier Model' };
  candidate.copy.model = { original: { text: 'Upgrade Supplier Model', contentLocale: 'en' }, translations: {} };
  candidate.copy.description = { original: { text: 'Upgrade Supplier Description', contentLocale: 'en' }, translations: {} };
  const receipt = admin.ExternalBatchResponseSchema.parse((await importBatch(one(candidate))).json()).data;
  const id = (await readRecords(receipt.id))[0]!.listingId!;
  const previous = (await runtime.db.pool.query('SELECT localized FROM external_catalog WHERE listing_id=$1', [id.slice(4)])).rows[0]!.localized;
  const current = await getListing(id);
  const human = { title: 'Upgrade Human Title', model: 'Upgrade Human Model', description: 'Upgrade Human Description' };
  const text = (['title', 'model', 'description'] as const).map(field => ({ field, locale: 'en' as const,
    sourceHash: current.sourceHashes[field]!, text: human[field] }));
  assert.equal((await revise(id, { version: current.version, overrides: { hidden: false, facts: {}, text } })).statusCode, 200);
  assert.equal((await list(`q=${encodeURIComponent(human.title)}`)).meta.total, 1);
  const changedSource = structuredClone(candidate);
  changedSource.revision++;
  for (const field of ['title', 'model', 'description'] as const) changedSource.copy[field]!.original.text = `Updated ${candidate.copy[field]!.original.text}`;
  assert.equal((await importBatch(one(changedSource))).statusCode, 201);
  const afterSource = await getListing(id);
  assert.notEqual(afterSource.sourceHashes.title, text[0]!.sourceHash);
  assert.notEqual(afterSource.sourceHashes.model, text[1]!.sourceHash);
  // Emulate an older stored projection while retaining the independently saved manual override.
  await runtime.db.pool.query('UPDATE external_catalog SET localized=$2 WHERE listing_id=$1', [id.slice(4), JSON.stringify(previous)]);
  await runtime.db.pool.query("UPDATE external_listing_overrides SET text_source_identities='{}'::jsonb WHERE listing_id=$1", [id.slice(4)]);
  assert.equal((await publicVehicle(id)).content.title.text, 'Upgrade Supplier Title');
  assert.equal((await list(`q=${encodeURIComponent(human.title)}`)).meta.total, 0);
  const migration = await readFile(new URL('../migrations/0013_external_provider_operations.sql', import.meta.url), 'utf8');
  const backfill = migration.split('--> statement-breakpoint').slice(-2).join('\n').trim();
  assert.ok(backfill.length > 0);
  await runtime.db.pool.query(backfill);
  const recovered = (await runtime.db.pool.query('SELECT text_source_identities FROM external_listing_overrides WHERE listing_id=$1', [id.slice(4)])).rows[0]!.text_source_identities;
  for (const edit of text) assert.deepEqual(recovered[edit.sourceHash], ['toyota', 'upgrade-model']);
  const found = await list(`q=${encodeURIComponent(human.title)}`);
  assert.equal(found.meta.total, 1);
  for (const vehicle of [found.data.items[0]!, await publicVehicle(id)]) {
    assert.equal(vehicle.id, id);
    assert.equal(vehicle.content.title.text, human.title);
    assert.equal(vehicle.display?.model.text, human.model);
    assert.equal(vehicle.content.description?.text, human.description);
  }
  assert.equal((await adminListings({ q: human.model, locale: 'en' })).items[0]?.title, human.title);
  const revision = async () => (await runtime.db.pool.query('SELECT revision::text FROM public_catalog_state WHERE id=1')).rows[0]!.revision;
  const repaired = await revision();
  await runtime.db.pool.query(backfill);
  assert.equal(await revision(), repaired);
});

test('a confirmed source make or model identity change suspends manual copy until a fresh staff edit', async () => {
  const id = (await adminListings({ q: 'synthetic-9401' })).items[0]!.id;
  let current = await getListing(id);
  for (const field of ['make', 'model'] as const) {
    const candidate = structuredClone(current.source!);
    candidate.revision++;
    candidate.facts[field] = field === 'make' ? { id: 'honda', name: 'Honda' } : { id: 'upgrade-reidentified', name: 'Reidentified Model' };
    const response = await importBatch(one(candidate));
    assert.equal(response.statusCode, 201, response.body);
    const changed = await getListing(id);
    assert.deepEqual(changed.overrides.text, current.overrides.text);
    assert.notEqual(changed.sourceHashes.title, current.sourceHashes.title);
    const suspended = await publicVehicle(id);
    assert.equal(suspended.content.title.text, candidate.copy.title!.original.text);
    assert.equal(suspended.display?.model.text, candidate.copy.model!.original.text);
    assert.equal(suspended.content.description?.text, candidate.copy.description!.original.text);
    assert.equal((await adminListings({ q: 'synthetic-9401', locale: 'en' })).items[0]?.title, candidate.copy.title!.original.text);
    const text = changed.overrides.text.map(item => ({ ...item, sourceHash: changed.sourceHashes[item.field]! }));
    assert.equal((await revise(id, { version: changed.version, overrides: { ...changed.overrides, text } })).statusCode, 200);
    current = await getListing(id);
    const restored = await publicVehicle(id);
    assert.equal(restored.content.title.text, 'Upgrade Human Title');
    assert.equal(restored.display?.model.text, 'Upgrade Human Model');
    assert.equal(restored.content.description?.text, 'Upgrade Human Description');
    assert.equal((await list(`q=${encodeURIComponent('Upgrade Human Title')}`)).meta.total, 1);
  }
});
