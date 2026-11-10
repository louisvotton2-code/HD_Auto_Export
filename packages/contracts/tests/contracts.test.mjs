import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import * as common from '../dist/index.js';
import * as publicContract from '../dist/public.js';
import * as admin from '../dist/admin.js';
import {
  contractFixtures, makeVehicleDraftFixture, makePublicVehicleFixture, makeDemoVehicleDraftFixture,
  demoPublicVehicleFixture, makeExternalVehicleDraftFixture, makePublicExternalVehicleFixture,
} from '../dist/fixtures.js';

test('money stays decimal text; unknown price is separate from a known zero', () => {
  assert(common.MoneySchema.safeParse({ amount: '0.00', currency: 'USD' }).success);
  assert(common.MoneySchema.safeParse({ amount: '23500.50', currency: 'KRW' }).success);
  for (const amount of [1, -1, '-1', '01.00', '1,000', '1e3', 'NaN', '1.234', '']) assert.equal(common.MoneySchema.safeParse({ amount, currency: 'USD' }).success, false);
  assert.equal(common.MoneySchema.safeParse({ amount: '10', currency: 'usd' }).success, false);
  assert.equal(common.MoneySchema.safeParse({ amount: '10', currency: 'ZZZ' }).success, false);
  assert(common.PublicPriceSchema.safeParse({ kind: 'on_request', money: null, includes: [] }).success);
  assert.equal(common.PublicPriceSchema.safeParse({ kind: 'asking', money: null, includes: [] }).success, false);
  assert.equal(common.PublicPriceSchema.safeParse({ kind: 'on_request', money: { amount: '0', currency: 'USD' }, includes: [] }).success, false);
});

test('partial dates validate precision and Gregorian calendar without reading the clock', () => {
  for (const [precision, value] of [['year', '2024'], ['month', '2024-02'], ['day', '2024-02-29'], ['day', '2000-02-29']]) assert(common.PartialDateSchema.safeParse({ precision, value }).success, value);
  for (const [precision, value] of [['day', '2023-02-29'], ['day', '1900-02-29'], ['day', '2024-04-31'], ['month', '2024-13'], ['month', '2024-2'], ['year', '2024-02'], ['day', '2024-01'], ['year', '0000']]) assert.equal(common.PartialDateSchema.safeParse({ precision, value }).success, false, value);
  assert(common.TimestampSchema.safeParse('2026-11-08T00:00:00.123Z').success);
  assert.equal(common.TimestampSchema.safeParse('2026-11-08T00:00:00').success, false);
});

test('unknown vehicle facts remain null and registration stays independent', () => {
  const draft = makeVehicleDraftFixture();
  Object.assign(draft.facts, { modelYear: null, manufacturedAt: null, firstRegistration: null, mileageKm: null, engineCc: null, powerKw: null });
  const parsed = admin.VehicleDraftInputSchema.parse(draft);
  assert.equal(parsed.facts.mileageKm, null);
  assert.equal(parsed.facts.manufacturedAt, null);
  assert.equal(parsed.facts.registrationStatus, 'unknown');
});

test('draft input cannot mutate aggregate inventory or omit external source metadata', () => {
  const draft = makeVehicleDraftFixture();
  assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, availability: 'available' }).success, false);
  assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, source: { kind: 'external' } }).success, false);
  assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, source: { kind: 'manual', apiKey: 'secret' } }).success, false);
});

test('public output rejects internal data at every nested boundary', () => {
  const vehicle = makePublicVehicleFixture();
  for (const extra of [{ internal: { notes: 'private' } }, { purchaseCost: { amount: '1', currency: 'USD' } }, { vin: 'PRIVATE_VIN' }]) assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, ...extra }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, source: { kind: 'manual', rawJson: '{}' } }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, facts: { ...vehicle.facts, supplierContact: 'private' } }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, content: { ...vehicle.content, title: { ...vehicle.content.title, engineVersion: 'private-engine' } } }).success, false);
  assert.equal(publicContract.PublicMediaSchema.safeParse({ ...vehicle.images[0], rights: { basis: 'permission', note: 'Private license details.' } }).success, false);
});

test('public links use stable local detail routes and permitted image addresses', () => {
  const vehicle = makePublicVehicleFixture();
  for (const detailPath of ['https://example.test/car', '//example.test/car', '/ru/cars/../', '/ru/cars/fixture_vehicle_1/?x=1']) assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, detailPath }).success, false);
  for (const url of ['javascript:alert(1)', 'http://example.test/image.jpg', '//example.test/image.jpg', '/api/v1/admin/media/id/preview']) assert.equal(publicContract.PublicMediaSchema.safeParse({ ...vehicle.images[0], url }).success, false);
  assert(publicContract.PublicMediaSchema.safeParse({ ...vehicle.images[0], url: 'https://images.example.test/photo.webp' }).success);
});

test('queries reject unsupported catalogs, foreign fields and over-limit pages', () => {
  assert.deepEqual(publicContract.PublicVehicleQuerySchema.parse({}), { locale: 'ru', catalog: 'curated', page: 1, pageSize: 24 });
  for (const value of [{ catalog: 'market' }, { page: 0 }, { pageSize: 49 }, { pageSize: '24' }, { sort: 'price' }, { locale: 'ko' }]) assert.equal(publicContract.PublicVehicleQuerySchema.safeParse(value).success, false);
  const meta = { requestId: 'fixture-request', catalog: 'curated', total: null, totalKind: 'unknown', accessibleTotal: null, dataAsOf: '2026-11-08T00:00:00Z', freshness: 'fresh' };
  assert(publicContract.CatalogMetaSchema.safeParse(meta).success);
  assert.equal(publicContract.CatalogMetaSchema.safeParse({ ...meta, total: 0 }).success, false);
  assert.equal(publicContract.CatalogMetaSchema.safeParse({ ...meta, totalKind: 'exact' }).success, false);
});

test('admin vehicle search trims text and composes with existing status, category and pagination fields', () => {
  assert.deepEqual(admin.AdminVehicleQuerySchema.parse({}), { page: 1, pageSize: 24, deleted: 'exclude' });
  assert.deepEqual(admin.AdminVehicleQuerySchema.parse({
    q: '  HD-000123 \n', make: 'kia', model: 'k5', powertrain: 'hev',
    publicationState: 'draft', availability: 'available', page: 2, pageSize: 48,
  }), {
    q: 'HD-000123', make: 'kia', model: 'k5', powertrain: 'hev',
    publicationState: 'draft', availability: 'available', page: 2, pageSize: 48,
    deleted: 'exclude',
  });
  assert.equal(admin.AdminVehicleQuerySchema.parse({ q: '' }).q, '');
  assert.equal(admin.AdminVehicleQuerySchema.parse({ q: ' \t\n ' }).q, '');
  assert.equal(admin.AdminVehicleQuerySchema.parse({ q: ` ${'车'.repeat(100)} ` }).q, '车'.repeat(100));
  assert.equal(admin.AdminVehicleQuerySchema.parse({ q: '  %_\\  ' }).q, '%_\\');
});

test('admin vehicle search rejects invalid lengths, NUL, category values and unknown properties', () => {
  for (const input of [
    { q: 'x'.repeat(101) }, { q: 'car\u0000title' }, { q: '\u0000' },
    { q: 123 }, { q: null }, { q: ['car'] },
    { make: '' }, { make: 'has space' }, { model: '../k5' }, { model: 'm'.repeat(101) },
    { powertrain: 'electric' }, { publicationState: 'available' }, { availability: 'draft' },
    { page: 0 }, { pageSize: 49 }, { pageSize: '24' },
    { sort: 'price' }, { locale: 'zh' }, { catalog: 'curated' },
  ]) assert.equal(admin.AdminVehicleQuerySchema.safeParse(input).success, false, JSON.stringify(input));
});

test('public list and dictionaries share bounded literal search text without accepting private fields', () => {
  for (const schema of [publicContract.PublicVehicleQuerySchema, publicContract.PublicFilterQuerySchema]) {
    assert.equal(schema.parse({ q: '  HD-000123 \n' }).q, 'HD-000123');
    assert.equal(schema.parse({ q: ' \t\n ' }).q, '');
    assert.equal(schema.parse({ q: ` ${'车'.repeat(100)} ` }).q, '车'.repeat(100));
    assert.equal(schema.parse({ q: '  %_\\  ' }).q, '%_\\');
    assert.equal(schema.parse({}).q, undefined);
    for (const input of [
      { q: 'x'.repeat(101) }, { q: '\u0000' }, { q: 'car\u0000title' },
      { q: null }, { q: 1 }, { q: ['car'] }, { q: 'car', deleted: 'only' },
      { publicationState: 'draft' }, { source: 'external' }, { internal: 'secret' },
    ]) assert.equal(schema.safeParse(input).success, false, JSON.stringify(input));
  }
  assert(publicContract.PublicVehicleQuerySchema.safeParse({ q: 'model', locale: 'zh', make: 'kia', model: 'k5', powertrain: 'hev', page: 2 }).success);
  assert.equal(publicContract.PublicFilterQuerySchema.safeParse({ q: 'model', make: 'kia' }).success, true);
});

test('recycle-bin queries use explicit strings and old admin receipts gain a null deletion marker', () => {
  const { deletedAt, ...oldReceipt } = contractFixtures.draft;
  assert.equal(admin.AdminVehicleSchema.parse(oldReceipt).deletedAt, null);
  assert.equal(admin.AdminVehicleResponseSchema.parse({ data: oldReceipt, meta: { requestId: 'old-receipt' } }).data.deletedAt, null);
  const timestamp = '2026-11-08T00:00:00Z';
  assert.equal(admin.AdminVehicleSchema.parse({ ...oldReceipt, deletedAt: timestamp }).deletedAt, timestamp);
  assert.equal(admin.AdminVehicleSchema.safeParse({ ...oldReceipt, deletedAt: '2026-11-08' }).success, false);
  assert.equal(admin.AdminVehicleQuerySchema.parse({ deleted: 'only', q: ' car ' }).deleted, 'only');
  assert.deepEqual(admin.AdminVehicleDetailQuerySchema.parse({}), { includeDeleted: 'false' });
  for (const includeDeleted of ['false', 'true']) assert.deepEqual(admin.AdminVehicleDetailQuerySchema.parse({ includeDeleted }), { includeDeleted });
  for (const deleted of ['all', '', true, false, null]) assert.equal(admin.AdminVehicleQuerySchema.safeParse({ deleted }).success, false);
  for (const includeDeleted of [true, false, '1', '0', '', 'TRUE', null]) assert.equal(admin.AdminVehicleDetailQuerySchema.safeParse({ includeDeleted }).success, false);
  assert.equal(admin.AdminVehicleDetailQuerySchema.safeParse({ includeDeleted: 'true', deleted: 'only' }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...makePublicVehicleFixture(), deletedAt: null }).success, false);
});

const bulkItem = (index = 1) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, expectedVersion: 1 });

test('bulk mutations accept one through fifty distinct UUIDs and reject duplicates regardless of case', () => {
  for (const length of [1, 50]) {
    const items = Array.from({ length }, (_, index) => bulkItem(index + 1));
    assert(admin.BulkVehicleMutationRequestSchema.safeParse({ operation: 'archive', items }).success);
  }
  for (const length of [0, 51]) {
    const items = Array.from({ length }, (_, index) => bulkItem(index + 1));
    assert.equal(admin.BulkVehicleMutationRequestSchema.safeParse({ operation: 'archive', items }).success, false);
  }
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for (const duplicate of [id, id.toUpperCase()]) {
    assert.equal(admin.BulkVehicleMutationRequestSchema.safeParse({
      operation: 'archive', items: [{ id, expectedVersion: 1 }, { id: duplicate, expectedVersion: 2 }],
    }).success, false);
  }
  assert(admin.BulkVehicleMutationRequestSchema.safeParse({ operation: 'archive', items: [{ id: id.toUpperCase(), expectedVersion: 1 }] }).success);
});

test('bulk mutation operation determines required fields and rejects unknown or malformed item fields', () => {
  const input = { operation: 'availability', availability: 'reserved', checkedAt: '2026-11-08T00:00:00Z', items: [bulkItem()] };
  assert.deepEqual(admin.BulkVehicleMutationRequestSchema.parse(input), input);
  for (const value of [
    { operation: 'availability', items: [bulkItem()] },
    { ...input, checkedAt: '2026-11-08' }, { ...input, availability: 'draft' },
    { ...input, operation: 'archive' }, { ...input, operation: 'publish' },
    { operation: 'archive', items: [{ ...bulkItem(), id: 'fixture_vehicle_1' }] },
    { operation: 'archive', items: [{ ...bulkItem(), expectedVersion: 0 }] },
    { operation: 'archive', items: [{ ...bulkItem(), expectedVersion: '1' }] },
    { operation: 'archive', items: [{ ...bulkItem(), version: 1 }] },
    { operation: 'archive', items: [bulkItem()], force: true },
  ]) assert.equal(admin.BulkVehicleMutationRequestSchema.safeParse(value).success, false);
});

test('bulk responses represent partial failure without authorizing automatic version retries', () => {
  const success = { status: 'succeeded', id: bulkItem().id, version: 2, publicationState: 'published', availability: 'reserved', availabilityCheckedAt: '2026-11-08T00:00:00Z' };
  const failure = { status: 'failed', id: bulkItem(2).id, error: { code: 'VERSION_CONFLICT', message: 'Reload before changing this vehicle.', retryable: false } };
  const response = { data: { operation: 'availability', results: [success, failure], summary: { total: 2, succeeded: 1, failed: 1 } }, meta: { requestId: 'fixture-bulk-request' } };
  assert.deepEqual(admin.BulkVehicleMutationResponseSchema.parse(response), response);
  for (const code of ['NOT_FOUND', 'VERSION_CONFLICT', 'DEMO_RESTRICTION', 'EXTERNAL_RESTRICTION']) {
    assert(admin.BulkVehicleMutationResultSchema.safeParse({ ...failure, error: { ...failure.error, code } }).success);
  }
  assert.equal(admin.BulkVehicleMutationResultSchema.safeParse({ ...failure, error: { ...failure.error, retryable: true } }).success, false);
  assert.equal(admin.BulkVehicleMutationResultSchema.safeParse({ ...failure, error: { ...failure.error, code: 'SERVICE_UNAVAILABLE' } }).success, false);
  assert.equal(admin.BulkVehicleMutationResultSchema.safeParse({ ...failure, version: 2 }).success, false);
  assert.equal(admin.BulkVehicleMutationResponseSchema.safeParse({ ...response, data: { ...response.data, summary: { total: 2, succeeded: 0, failed: 2 } } }).success, false);
  assert.equal(admin.BulkVehicleMutationResponseSchema.safeParse({ ...response, data: { ...response.data, results: [], summary: { total: 0, succeeded: 0, failed: 0 } } }).success, false);
  assert(admin.BulkVehicleMutationResponseSchema.safeParse({ ...response, data: { operation: 'archive', results: [failure], summary: { total: 1, succeeded: 0, failed: 1 } } }).success);
});

test('admin filter dictionaries explicitly cover all inventory and accept only the optional make query', () => {
  assert.deepEqual(admin.AdminVehicleFiltersQuerySchema.parse({}), {});
  assert.deepEqual(admin.AdminVehicleFiltersQuerySchema.parse({ make: 'kia' }), { make: 'kia' });
  for (const value of [{ make: '' }, { make: 'kia motors' }, { q: 'kia' }, { availability: 'available' }, { locale: 'ru' }, { model: 'k5' }]) {
    assert.equal(admin.AdminVehicleFiltersQuerySchema.safeParse(value).success, false);
  }
  const response = { data: {
    scope: 'all_inventory', makes: [{ id: 'kia', name: 'Kia', count: 3 }],
    models: [{ id: 'k5', name: 'K5', makeId: 'kia', count: 2 }], powertrains: [{ id: 'hev', count: 1 }],
  }, meta: { requestId: 'fixture-filter-request' } };
  assert.deepEqual(admin.AdminVehicleFiltersResponseSchema.parse(response), response);
  assert(admin.AdminVehicleFiltersResponseSchema.safeParse({ ...response, data: { scope: 'all_inventory', makes: [], models: [], powertrains: [] } }).success);
  assert.equal(admin.AdminVehicleFiltersResponseSchema.safeParse({ ...response, data: { ...response.data, scope: 'curated' } }).success, false);
  for (const count of [-1, 1.5]) {
    assert.equal(admin.AdminVehicleFiltersResponseSchema.safeParse({ ...response, data: { ...response.data, makes: [{ id: 'kia', name: 'Kia', count }] } }).success, false);
  }
  assert.equal(admin.AdminVehicleFiltersResponseSchema.safeParse({ ...response, data: { ...response.data, powertrains: [{ id: 'electric', count: 1 }] } }).success, false);
});

test('isolated demo fixtures preserve model specifications without inventing stock or quotations', () => {
  const draft = makeDemoVehicleDraftFixture();
  assert(admin.VehicleDraftInputSchema.safeParse(draft).success);
  assert(publicContract.PublicVehicleSchema.safeParse(demoPublicVehicleFixture).success);
  assert.deepEqual(draft.price, { kind: 'on_request', money: null, includes: [] });
  assert.equal(draft.facts.modelYear, 2024);
  assert.equal(draft.facts.engineCc, 1998);
  assert.equal(draft.internal.purchaseCost, null);
  draft.content.title.sourceText = 'Edited isolated fixture';
  assert.notEqual(draft.content.title.sourceText, makeDemoVehicleDraftFixture().content.title.sourceText);
  assert(admin.VehicleDraftInputSchema.safeParse(makeVehicleDraftFixture()).success);
  assert(publicContract.PublicVehicleSchema.safeParse(makePublicVehicleFixture()).success);
});

test('demo drafts reject physical inventory facts, VIN and quoted prices', () => {
  for (const facts of [
    { manufacturedAt: { precision: 'month', value: '2024-02' } },
    { firstRegistration: { precision: 'day', value: '2024-03-01' } },
    { mileageKm: 0 }, { registrationStatus: 'never_registered' },
    { location: { country: 'CN', city: null, displayName: null } },
  ]) {
    const draft = makeDemoVehicleDraftFixture();
    assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, facts: { ...draft.facts, ...facts } }).success, false);
  }
  const draft = makeDemoVehicleDraftFixture();
  assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, internal: { ...draft.internal, vin: 'DEMO123' } }).success, false);
  assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, price: { kind: 'asking', money: { amount: '0', currency: 'USD' }, includes: [] } }).success, false);
});

test('public demo vehicles cannot present checked availability, physical facts or reference quotations', () => {
  for (const availability of ['available', 'reserved', 'sold']) {
    assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...demoPublicVehicleFixture, availability }).success, false);
  }
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...demoPublicVehicleFixture, availabilityCheckedAt: '2026-11-08T00:00:00Z' }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...demoPublicVehicleFixture, facts: { ...demoPublicVehicleFixture.facts, mileageKm: 0 } }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...demoPublicVehicleFixture, price: { kind: 'reference', money: { amount: '100', currency: 'USD' }, includes: [] } }).success, false);
  assert(common.ApiErrorSchema.safeParse({ error: { code: 'DEMO_RESTRICTION', message: 'Demonstration vehicles cannot change inventory state.', retryable: false }, meta: { requestId: 'fixture-demo-restriction' } }).success);
});

test('demo fixtures and public content never claim human-reviewed translations', () => {
  const draft = makeDemoVehicleDraftFixture();
  for (const field of Object.values(draft.content)) {
    for (const locale of ['zh', 'en', 'ru']) {
      const text = field.translations[locale];
      assert.equal(text.kind, locale === 'zh' ? 'original' : 'machine');
      assert.equal(text.reviewStatus, 'pending');
      assert.equal(text.humanEditVersion, 0);
      assert.equal(text.sourceVersion, field.sourceVersion);
    }
  }
  for (const name of ['title', 'description']) {
    assert.equal(demoPublicVehicleFixture.content[name].kind, 'machine');
    assert.equal(demoPublicVehicleFixture.content[name].reviewed, false);
    assert.equal(publicContract.PublicVehicleSchema.safeParse({
      ...demoPublicVehicleFixture,
      content: { ...demoPublicVehicleFixture.content, [name]: { ...demoPublicVehicleFixture.content[name], reviewed: true } },
    }).success, false);
  }
  assert(publicContract.PublicVehicleSchema.safeParse({ ...demoPublicVehicleFixture, content: { ...demoPublicVehicleFixture.content, description: null } }).success);
  const manual = makeVehicleDraftFixture();
  assert.equal(manual.content.title.translations.ru.reviewStatus, 'approved');
  assert.equal(makePublicVehicleFixture().content.title.reviewed, true);
});

test('external source requires complete bounded metadata and never fetches credential-bearing URLs', () => {
  const draft = makeExternalVehicleDraftFixture();
  assert(admin.VehicleDraftInputSchema.safeParse(draft).success);
  assert.equal(draft.source.kind, 'external');
  for (const property of ['platform', 'listingUrl', 'externalId', 'collectedAt', 'sourceUpdatedAt']) {
    const source = { ...draft.source }; delete source[property];
    assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, source }).success, false, property);
  }
  for (const source of [
    { ...draft.source, platform: { id: 'invalid id', name: 'Example' } },
    { ...draft.source, platform: { id: 'example', name: ' \n ' } },
    { ...draft.source, platform: { id: 'example', name: 'x'.repeat(121) } },
    { ...draft.source, externalId: ' \t ' }, { ...draft.source, externalId: 'x'.repeat(301) },
    { ...draft.source, collectedAt: null }, { ...draft.source, sourceUpdatedAt: '2026-11-08' },
    { ...draft.source, apiKey: 'secret' },
  ]) assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, source }).success, false);
  const prefix = 'https://example.invalid/';
  assert(common.SafeHttpUrlSchema.safeParse(prefix + 'a'.repeat(2048 - prefix.length)).success);
  assert.equal(common.SafeHttpUrlSchema.safeParse(prefix + 'a'.repeat(2049 - prefix.length)).success, false);
  for (const listingUrl of [
    'https://user:password@example.invalid/listing', 'http://user@example.invalid/listing',
    'ftp://example.invalid/listing', 'javascript:alert(1)', '//example.invalid/listing',
    'https:example.invalid/listing', ' https://example.invalid/listing',
    'https://example.invalid/a\nb', 'https://[',
  ]) assert.equal(admin.ExternalVehicleSourceSchema.safeParse({ ...draft.source, listingUrl }).success, false, listingUrl);
  assert(admin.ExternalVehicleSourceSchema.safeParse({ ...draft.source, listingUrl: 'http://example.invalid/listing', externalId: 'x'.repeat(300) }).success);
  for (const kind of ['manual', 'demo']) assert.equal(admin.VehicleDraftSourceSchema.safeParse({ ...draft.source, kind }).success, false);
});

test('external fixtures distinguish observed facts and reference prices from owned inventory and human review', () => {
  const draft = makeExternalVehicleDraftFixture();
  const vehicle = makePublicExternalVehicleFixture();
  assert.equal(draft.price.kind, 'reference');
  assert.equal(draft.facts.mileageKm, 12000);
  assert.equal(new URL(draft.source.listingUrl).hostname, 'example.invalid');
  assert.equal(vehicle.fetchedAt, draft.source.collectedAt);
  assert.equal(vehicle.sourceUpdatedAt, draft.source.sourceUpdatedAt);
  for (const field of Object.values(draft.content)) {
    for (const locale of ['zh', 'en', 'ru']) {
      const text = field.translations[locale];
      assert.equal(text.kind, locale === 'zh' ? 'original' : 'machine');
      assert.equal(text.reviewStatus, 'pending');
      assert.equal(text.sourceVersion, field.sourceVersion);
      assert.equal(text.humanEditVersion, 0);
    }
  }
  const asking = { kind: 'asking', money: { amount: '100', currency: 'USD' }, includes: [] };
  assert.equal(admin.VehicleDraftInputSchema.safeParse({ ...draft, price: asking }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, price: asking }).success, false);
  const onRequest = { kind: 'on_request', money: null, includes: [] };
  assert(admin.VehicleDraftInputSchema.safeParse({ ...draft, price: onRequest }).success);
  assert(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, price: onRequest }).success);
  for (const availability of ['available', 'reserved', 'sold']) assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, availability }).success, false);
  assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, availabilityCheckedAt: '2026-11-08T00:00:00Z' }).success, false);
  for (const name of ['title', 'description']) {
    assert.equal(vehicle.content[name].reviewed, false);
    assert.equal(publicContract.PublicVehicleSchema.safeParse({
      ...vehicle, content: { ...vehicle.content, [name]: { ...vehicle.content[name], reviewed: true } },
    }).success, false);
  }
  assert(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, content: { ...vehicle.content, description: null } }).success);
  draft.source.externalId = 'isolated-edit';
  vehicle.source.platform.name = 'isolated-edit';
  assert.notEqual(makeExternalVehicleDraftFixture().source.externalId, draft.source.externalId);
  assert.notEqual(makePublicExternalVehicleFixture().source.platform.name, vehicle.source.platform.name);
});

test('public external source exposes only platform and listing while restriction errors remain explicit', () => {
  const draft = makeExternalVehicleDraftFixture();
  const vehicle = makePublicExternalVehicleFixture();
  assert(publicContract.SourceSchema.safeParse(vehicle.source).success);
  for (const extra of [
    { externalId: draft.source.externalId }, { collectedAt: draft.source.collectedAt },
    { sourceUpdatedAt: null }, { notes: 'private' },
  ]) assert.equal(publicContract.PublicVehicleSchema.safeParse({ ...vehicle, source: { ...vehicle.source, ...extra } }).success, false);
  assert.equal(publicContract.SourceSchema.safeParse({ kind: 'external' }).success, false);
  for (const code of ['EXTERNAL_RESTRICTION', 'SOURCE_IDENTITY_CONFLICT']) {
    assert(common.ApiErrorSchema.safeParse({ error: { code, message: 'Synthetic source restriction.', retryable: false }, meta: { requestId: 'fixture-source-restriction' } }).success);
  }
});

test('media source evidence supports unverified local metadata without exposing it in public DTOs', () => {
  const source = { listingUrl: 'https://example.invalid/listings/synthetic-001', imageUrl: 'https://images.example.invalid/synthetic-001.jpg', collectedAt: '2026-11-08T00:00:00Z' };
  const rights = { basis: 'unverified', note: 'Synthetic fixture; permission has not been verified.', source };
  const upload = { vehicleId: 'fixture_external_vehicle_1', contentType: 'image/jpeg', sizeBytes: 128, rights };
  assert.deepEqual(admin.MediaUploadRequestSchema.parse(upload), upload);
  assert(admin.MediaAssetSchema.safeParse({ ...contractFixtures.failedMedia, rights }).success);
  for (const field of ['listingUrl', 'imageUrl', 'collectedAt']) {
    const incomplete = { ...source }; delete incomplete[field];
    assert.equal(admin.MediaRightsSchema.safeParse({ ...rights, source: incomplete }).success, false);
  }
  for (const field of ['listingUrl', 'imageUrl']) {
    assert.equal(admin.MediaRightsSchema.safeParse({ ...rights, source: { ...source, [field]: 'https://user:password@example.invalid/' } }).success, false);
  }
  assert.equal(admin.MediaRightsSchema.safeParse({ ...rights, note: '\t ' }).success, false);
  assert.equal(admin.MediaRightsSchema.safeParse({ ...rights, source: { ...source, fetch: true } }).success, false);
  assert.equal(publicContract.PublicMediaSchema.safeParse({ ...makePublicExternalVehicleFixture().images[0], rights }).success, false);
});

test('public thumbnails permit only the fixed variant and exact local URL form', () => {
  assert.deepEqual(publicContract.PublicMediaQuerySchema.parse({}), {});
  assert.deepEqual(publicContract.PublicMediaQuerySchema.parse({ variant: 'thumb' }), { variant: 'thumb' });
  for (const query of [{ variant: '' }, { variant: 'original' }, { variant: 'THUMB' }, { variant: ['thumb'] }, { width: 240 }, { variant: 'thumb', width: 240 }]) {
    assert.equal(publicContract.PublicMediaQuerySchema.safeParse(query).success, false);
  }
  const path = '/api/v1/media/fixture_media_1';
  assert(publicContract.MediaUrlSchema.safeParse(path).success);
  assert(publicContract.MediaUrlSchema.safeParse(`${path}?variant=thumb`).success);
  for (const query of ['?variant=original', '?width=240', '?variant=thumb&width=240', '?variant=thumb&variant=thumb', '?variant=thumb#fragment']) {
    assert.equal(publicContract.MediaUrlSchema.safeParse(path + query).success, false, query);
  }
  assert.equal(makePublicExternalVehicleFixture().images[0].url, path);
});

test('source language can expand while output locales and translation status stay explicit', () => {
  assert(admin.VehicleDraftInputSchema.safeParse(contractFixtures.untranslatedKorean).success);
  assert(common.LanguageTagSchema.safeParse('zh-CN').success);
  assert.equal(common.LanguageTagSchema.safeParse('unknown language').success, false);
  const draft = makeVehicleDraftFixture(); draft.content.title.translations.ko = null;
  assert.equal(admin.VehicleDraftInputSchema.safeParse(draft).success, false);
  assert.equal(admin.VehicleDraftInputSchema.parse(contractFixtures.pendingTranslation).content.title.translations.ru.reviewStatus, 'pending');
  const stale = admin.VehicleDraftInputSchema.parse(contractFixtures.staleTranslation);
  assert.notEqual(stale.content.title.sourceVersion, stale.content.title.translations.ru.sourceVersion);
  const output = publicContract.PublicTextSchema.parse({ text: '테스트 차량', requestedLocale: 'ru', contentLocale: 'ko', kind: 'original', reviewed: false });
  assert.notEqual(output.requestedLocale, output.contentLocale);
  const machineReviewed = publicContract.PublicTextSchema.parse({ text: 'Проверенный перевод', requestedLocale: 'ru', contentLocale: 'ru', kind: 'machine', reviewed: true });
  assert.equal(machineReviewed.kind, 'machine');
  assert.equal(machineReviewed.reviewed, true);
  assert.equal(publicContract.PublicTextSchema.safeParse({ text: 'Legacy', requestedLocale: 'en', contentLocale: 'en', kind: 'human' }).success, false);
});

test('media references cannot duplicate IDs, positions or covers', () => {
  for (const extra of [
    { id: 'fixture_media_1', alt: '', sortOrder: 1, isCover: false },
    { id: 'fixture_media_2', alt: '', sortOrder: 0, isCover: false },
    { id: 'fixture_media_2', alt: '', sortOrder: 1, isCover: true },
  ]) {
    const draft = makeVehicleDraftFixture(); draft.media.push(extra);
    assert.equal(admin.VehicleDraftInputSchema.safeParse(draft).success, false);
  }
});

test('uploads are bounded, bound to a vehicle and cannot request a remote fetch', () => {
  const input = { vehicleId: 'fixture_vehicle_1', contentType: 'image/jpeg', sizeBytes: 1000, rights: { basis: 'owned', note: 'Our own synthetic test image.' } };
  assert(admin.MediaUploadRequestSchema.safeParse(input).success);
  for (const extra of [{ sizeBytes: 0 }, { sizeBytes: 10 * 1024 * 1024 + 1 }, { contentType: 'image/svg+xml' }, { filename: '../photo.jpg' }, { filename: 'a\\photo.jpg' }, { url: 'https://private.test/' }]) assert.equal(admin.MediaUploadRequestSchema.safeParse({ ...input, ...extra }).success, false);
  assert.equal(admin.MediaUploadRequestSchema.safeParse({ contentType: 'image/jpeg', sizeBytes: 1000 }).success, false);
  const { rights, ...noDeclaration } = input;
  assert.equal(admin.MediaUploadRequestSchema.safeParse(noDeclaration).success, false);
  assert.equal(admin.MediaUploadRequestSchema.safeParse({ ...input, rights: { basis: 'permission', note: ' \n ' } }).success, false);
  assert.equal(admin.MediaUploadRequestSchema.safeParse({ ...input, rights: { basis: 'unknown', note: 'Not checked' } }).success, false);
});

test('mutations require an integer resource version except creation', () => {
  for (const schema of [admin.PublishVehicleRequestSchema, admin.ArchiveVehicleRequestSchema, admin.DeleteVehicleRequestSchema, admin.RestoreVehicleRequestSchema, admin.MediaCompleteRequestSchema, admin.MediaDeleteRequestSchema]) {
    assert(schema.safeParse({ version: 1 }).success);
    for (const input of [{}, { version: 0 }, { version: 1.2 }, { version: '1' }, { version: 1, force: true }]) assert.equal(schema.safeParse(input).success, false);
  }
  assert(admin.CreateVehicleRequestSchema.safeParse({ draft: makeVehicleDraftFixture() }).success);
  assert.equal(admin.CreateVehicleRequestSchema.safeParse({ version: 1, draft: makeVehicleDraftFixture() }).success, false);
});

test('home configuration has two identifiable sections without duplicate selections', () => {
  const section = { id: 'first', title: { zh: '精选', en: 'Selected', ru: 'Подборка' }, vehicleIds: ['fixture_vehicle_1'] };
  const input = { version: 1, sections: [section, { ...section, id: 'second', vehicleIds: [] }] };
  assert(admin.AdminHomeSectionsSchema.safeParse(input).success);
  assert.equal(admin.AdminHomeSectionsSchema.safeParse({ ...input, sections: [section, section] }).success, false);
  assert.equal(admin.AdminHomeSectionSchema.safeParse({ ...section, vehicleIds: ['ABCDEFAB-1111-4111-8111-111111111111','abcdefab-1111-4111-8111-111111111111'] }).success, false);
  assert.equal(admin.AdminHomeSectionsSchema.safeParse({ ...input, sections: [{ ...section, vehicleIds: ['fixture_vehicle_1', 'fixture_vehicle_1'] }, input.sections[1]] }).success, false);
});

test('required visible names, localized content and section titles reject whitespace', () => {
  const draft = makeVehicleDraftFixture();
  const vehicle = makePublicVehicleFixture();
  assert.equal(common.NamedValueSchema.safeParse({ id: 'make', name: ' \n ' }).success, false);
  assert.equal(publicContract.PublicTextSchema.safeParse({ ...vehicle.content.title, text: '\t ' }).success, false);
  assert.equal(admin.LocalizedTextSchema.safeParse({ ...draft.content.title.translations.zh, text: ' \n ' }).success, false);
  for (const locale of ['zh', 'en', 'ru']) {
    const title = { zh: '精选', en: 'Selected', ru: 'Подборка', [locale]: ' \n ' };
    assert.equal(admin.AdminHomeSectionSchema.safeParse({ id: 'section', title, vehicleIds: [] }).success, false);
  }
});

test('scenario fixtures validate and clone helpers do not share edits', () => {
  for (const key of ['published', 'onRequest', 'reserved', 'sold', 'missingManufacturedAt', 'externalPublic']) assert(publicContract.PublicVehicleSchema.safeParse(contractFixtures[key]).success, key);
  for (const key of ['draft', 'archived', 'deleted']) assert(admin.AdminVehicleSchema.safeParse(contractFixtures[key]).success, key);
  assert(admin.VehicleDraftInputSchema.safeParse(contractFixtures.externalDraft).success);
  assert(admin.MediaAssetSchema.safeParse(contractFixtures.failedMedia).success);
  assert(common.ApiErrorSchema.safeParse(contractFixtures.versionConflict).success);
  const first = makeVehicleDraftFixture(); first.content.title.sourceText = 'changed';
  assert.notEqual(first.content.title.sourceText, makeVehicleDraftFixture().content.title.sourceText);
});

test('all exported schemas remain JSON Schema representable for OpenAPI generation', () => {
  for (const [name, schema] of Object.entries({ ...common, ...publicContract, ...admin })) {
    if (!name.endsWith('Schema') || !(schema instanceof z.ZodType)) continue;
    assert.doesNotThrow(() => z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }), name);
  }
});
