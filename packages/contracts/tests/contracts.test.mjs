import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import * as common from '../dist/index.js';
import * as publicContract from '../dist/public.js';
import * as admin from '../dist/admin.js';
import { contractFixtures, makeVehicleDraftFixture, makePublicVehicleFixture } from '../dist/fixtures.js';

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

test('draft input cannot mutate aggregate inventory or smuggle external source data', () => {
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
  for (const schema of [admin.PublishVehicleRequestSchema, admin.ArchiveVehicleRequestSchema, admin.MediaCompleteRequestSchema, admin.MediaDeleteRequestSchema]) {
    assert(schema.safeParse({ version: 1 }).success);
    for (const input of [{}, { version: 0 }, { version: 1.2 }, { version: '1' }]) assert.equal(schema.safeParse(input).success, false);
  }
  assert(admin.CreateVehicleRequestSchema.safeParse({ draft: makeVehicleDraftFixture() }).success);
  assert.equal(admin.CreateVehicleRequestSchema.safeParse({ version: 1, draft: makeVehicleDraftFixture() }).success, false);
});

test('home configuration has two identifiable sections without duplicate selections', () => {
  const section = { id: 'first', title: { zh: '精选', en: 'Selected', ru: 'Подборка' }, vehicleIds: ['fixture_vehicle_1'] };
  const input = { version: 1, sections: [section, { ...section, id: 'second', vehicleIds: [] }] };
  assert(admin.AdminHomeSectionsSchema.safeParse(input).success);
  assert.equal(admin.AdminHomeSectionsSchema.safeParse({ ...input, sections: [section, section] }).success, false);
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
  for (const key of ['published', 'onRequest', 'reserved', 'sold', 'missingManufacturedAt']) assert(publicContract.PublicVehicleSchema.safeParse(contractFixtures[key]).success, key);
  for (const key of ['draft', 'archived']) assert(admin.AdminVehicleSchema.safeParse(contractFixtures[key]).success, key);
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
