/** Synthetic source records and consumer examples. No URL here is an operating source. */
import {
  ExternalBatchSchema, ExternalBatchRecordSchema, ExternalListingSchema, ExternalTrialSchema, ExternalUpsertCandidateSchema,
  type ExternalImportBatchRequest, type ExternalUpsertCandidate,
} from './external-admin.js';
import { PublicVehicleSchema, type Locale, type PublicText, type PublicVehicle } from './public.js';
import { ExternalInspectionSchema, type ExternalInspection, type ExternalReportAccess } from './external-public.js';

export const externalFixtureTime = '2026-11-09T00:00:00Z';
const fixtureExpiry = '2099-11-09T00:00:00Z';
export const externalFixtureProvider = 'synthetic-feed';
const platform = { id: 'synthetic-market', name: 'Synthetic Market' };
const tag = (text: string, contentLocale: Locale = 'zh') => ({ text, contentLocale });
const copy = (text: string) => ({ original: tag(text), translations: {} });

export function makeExternalCandidateFixture(index = 1): ExternalUpsertCandidate {
  const externalId = `synthetic-${String(index).padStart(4, '0')}`;
  return ExternalUpsertCandidateSchema.parse({
    operation: 'upsert', externalId, platformId: platform.id, revision: 1,
    fetchedAt: externalFixtureTime, sourceUpdatedAt: null,
    listingUrl: `https://listings.example.invalid/vehicles/${externalId}`,
    relatedListingUrls: index === 1 ? ['https://listings.example.invalid/related/synthetic-0001'] : [],
    facts: {
      make: { id: 'toyota', name: '丰田' }, model: { id: 'synthetic-r1', name: '示例 R1' },
      trim: null, generation: null, drivetrain: index === 1 ? 'fwd' : null, modelYear: 2024,
      manufacturedAt: null, firstRegistration: { value: '2024-08', precision: 'month' }, registrationStatus: 'registered',
      mileageKm: 1000 + index, powertrain: 'hev', engineCc: null, powerKw: null, body: 'suv', transmission: 'automatic', location: null,
    },
    disputes: index === 3 ? ['modelYear', 'powertrain'] : [],
    price: index === 4 ? { cny: 'invalid-fixture-price' } : { cny: '128000.50' },
    sellerPrice: { cny: '139000' },
    copy: {
      title: index === 1 ? { original: tag('示例 R1 混动'), translations: { en: tag('Example R1 Hybrid', 'en'), ru: tag('Пример R1 гибрид', 'ru') } } : copy(`示例 R1 ${index}`),
      model: copy('示例 R1'), description: index === 4 ? null : copy('这是合成测试说明。'),
    },
    images: index === 4 ? [] : [{ sourceMediaId: 'main', url: `https://photos.example.invalid/${externalId}.webp`, width: null, height: null, alt: tag('示例照片'), expiresAt: fixtureExpiry }],
    specifications: index === 1 ? [{ name: tag('车身'), value: tag('运动型多用途车') }] : [],
    inspection: index === 1 ? {
      reportUrl: 'https://reports.example.invalid/synthetic-0001', entries: [{ name: tag('检测范围'), value: tag('合成测试项') }],
    } : null,
  });
}

/** Structured synthetic inspection; declared evidence times are fixed, not a claim about a live report. */
export function makeExternalInspectionFixture(status: ExternalReportAccess['status'] = 'unknown'): ExternalInspection {
  // Even a verified internal observation never changes the public contact-sales projection.
  void status;
  return ExternalInspectionSchema.parse({
    reportUrl: null, reportAccess: { status: 'unknown', url: null, checkedAt: null, expiresAt: null }, entries: [],
    checks: [{ category: tag('Body inspection', 'en'), defects: 1, groups: [
      { name: tag('Exterior panels', 'en'), defects: 1, items: [
        { part: tag('Left front door', 'en'), result: tag('Surface scratch observed', 'en'), ok: false },
        { part: tag('Right front door', 'en'), result: null, ok: null },
      ] },
      { name: tag('Bonnet', 'en'), defects: 0, items: [
        { part: tag('Bonnet surface', 'en'), result: tag('No defect observed', 'en'), ok: true },
      ] },
    ] }],
    defects: [{ category: tag('Body inspection', 'en'), count: 1, items: [{
      group: tag('Exterior panels', 'en'), part: tag('Left front door', 'en'), finding: tag('Surface scratch', 'en'),
      details: [{ text: tag('Synthetic surface scratch description', 'en'), textZh: tag('合成样例：表面划痕说明。') }],
    }] }],
  });
}

export function makeExternalStructuredCandidateFixture(index = 1): ExternalUpsertCandidate {
  const candidate = makeExternalCandidateFixture(index);
  const { reportAccess: _evidence, ...inspection } = makeExternalInspectionFixture();
  return ExternalUpsertCandidateSchema.parse({ ...candidate, history: { ownershipTransfers: 0 },
    inspection: { ...inspection, hasReport: true, reportUrl: 'https://reports.example.invalid/synthetic-0001' } });
}

export function makeExternalImportFixture(count = 200): ExternalImportBatchRequest {
  if (!Number.isInteger(count) || count < 1 || count > 250) throw new RangeError('Fixture count must be 1–250');
  return {
    provider: externalFixtureProvider,
    records: Array.from({ length: count }, (_, i) => {
      const candidate = makeExternalCandidateFixture(i + 1);
      return { raw: JSON.stringify({ fixture: 'PRIVATE_RAW_MARKER', source: candidate }), candidate };
    }),
  };
}

export function makeExternalWithdrawalFixture(index = 1, revision = 2): ExternalImportBatchRequest {
  const { externalId, platformId, fetchedAt, sourceUpdatedAt } = makeExternalCandidateFixture(index);
  const candidate = { operation: 'withdraw', externalId, platformId, fetchedAt, sourceUpdatedAt, revision };
  return { provider: externalFixtureProvider, records: [{ raw: JSON.stringify(candidate), candidate }] };
}

export const externalFixtureBatchId = '00000000-0000-4000-8000-000000000101';
export const externalFixtureId = (index: number) => `ext-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export function makeImportedPublicVehicleFixture(locale: Locale, state: 'supplier' | 'original' | 'machine' | 'conflict' | 'missing' = 'supplier', detail = false): PublicVehicle {
  const index = { supplier: 1, original: 2, conflict: 3, missing: 4, machine: 5 }[state];
  const source = makeExternalCandidateFixture(index);
  const id = externalFixtureId(index);
  const original = (text: string): PublicText => ({ text, requestedLocale: locale, contentLocale: 'zh', kind: 'original', reviewed: false });
  const title = original(source.copy.title!.original.text);
  const supplier = source.copy.title?.translations[locale];
  const selectedTitle: PublicText = supplier ? { ...title, ...supplier, kind: 'supplier' }
    : state === 'machine' && locale !== 'zh' ? { ...title, text: locale === 'en' ? 'Example R1' : 'Пример R1', contentLocale: locale, kind: 'machine' }
      : state === 'conflict' ? { ...title, text: { zh: '外部挂牌', en: 'External listing', ru: 'Внешнее объявление' }[locale], contentLocale: locale, kind: 'catalog' } : title;
  const missing = { status: 'missing', text: null, requestedLocale: locale, contentLocale: null, provenance: null, reviewed: false };
  const ready = (text: string, contentLocale: Locale, provenance: string) => ({ status: 'ready', text, requestedLocale: locale, contentLocale, provenance, reviewed: false });
  const images = source.images.map((image, sortOrder) => ({
    id: `ximg-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, url: image.url, alt: '',
    width: image.width, height: image.height, sortOrder, isCover: sortOrder === 0,
    remote: { revision: 1, refreshedAt: externalFixtureTime, expiresAt: image.expiresAt },
  }));
  const makeName = locale === 'zh' ? '丰田' : 'Toyota';
  const modelName = state === 'conflict' ? null : source.facts.model;
  const description = state === 'conflict' || !source.copy.description ? null : original(source.copy.description.original.text);
  return PublicVehicleSchema.parse({
    id, stockCode: `EXT-${String(index).padStart(6, '0')}`, detailPath: `/${locale}/cars/${id}/`,
    source: { kind: 'external', platform, listingUrl: source.listingUrl },
    facts: { ...source.facts, make: { ...source.facts.make, name: makeName }, model: modelName,
      ...(state === 'conflict' ? { modelYear: null, powertrain: 'unknown' } : {}) },
    display: { make: ready(makeName, locale, 'catalog'), model: modelName ? ready(modelName.name, 'zh', 'original') : missing,
      trim: missing, generation: missing, city: missing, location: missing, platform: ready(platform.name, 'en', 'original'),
      priceIncludes: [], mediaAlt: images.map(image => ({ mediaId: image.id, value: missing })) },
    content: { title: selectedTitle, description }, images,
    ...(detail ? { report: { hasReport: !!source.inspection?.reportUrl || source.inspection?.hasReport === true } } : {}),
    price: state === 'missing' ? { kind: 'on_request', money: null, includes: [] } : { kind: 'reference', money: { amount: '128000.50', currency: 'CNY' }, includes: [] },
    availability: 'unknown', availabilityCheckedAt: null, sourceUpdatedAt: null, fetchedAt: externalFixtureTime, publishedAt: externalFixtureTime,
    external: {
      issues: state === 'conflict' ? [{ field: 'modelYear', code: 'conflict' }, { field: 'powertrain', code: 'conflict' }]
        : state === 'missing' ? [{ field: 'price', code: 'invalid' }, { field: 'images', code: 'missing' }] : [],
      ...(detail ? { detail: {
        original: { title: state === 'conflict' ? null : title, model: modelName ? original(modelName.name) : null, description },
        specifications: source.specifications, inspection: source.inspection ? { entries: source.inspection.entries, reportUrl: null } : null, relatedListingUrls: source.relatedListingUrls,
      } } : {}),
    },
  });
}

export function makeExternalStructuredPublicVehicleFixture(locale: Locale = 'en', status: ExternalReportAccess['status'] = 'unknown'): PublicVehicle {
  const vehicle = makeImportedPublicVehicleFixture(locale, 'supplier', true);
  vehicle.external!.detail!.history = { ownershipTransfers: 0 };
  vehicle.external!.detail!.inspection = makeExternalInspectionFixture(status);
  return PublicVehicleSchema.parse(vehicle);
}

export function makeExternalAdminFixture(locale: Locale = 'zh') {
  const candidate = makeExternalCandidateFixture(1);
  const vehicle = makeImportedPublicVehicleFixture(locale, 'supplier', true);
  const batch = ExternalBatchSchema.parse({
    id: externalFixtureBatchId, provider: externalFixtureProvider, importedAt: externalFixtureTime, state: 'completed_with_issues',
    counts: { total: 202, applied: 200, unchanged: 0, ignored: 0, rejected: 2 },
  });
  const listing = ExternalListingSchema.parse({
    id: vehicle.id, version: 3, state: 'published', identity: { provider: externalFixtureProvider, platformId: platform.id, externalId: candidate.externalId },
    sourceRevision: candidate.revision, sourceUpdatedAt: null, fetchedAt: candidate.fetchedAt, source: candidate,
    overrides: { hidden: false, facts: {}, text: [] }, report: { hasReport: true, url: candidate.inspection?.reportUrl ?? null }, sourceHashes: { title: 'a'.repeat(64), model: 'b'.repeat(64), description: 'c'.repeat(64) }, vehicle,
  });
  const records = [
    { row: 1, listingId: vehicle.id, operation: 'upsert', status: 'applied', reason: null, issues: [] },
    { row: 2, listingId: externalFixtureId(3), operation: 'upsert', status: 'applied', reason: null, issues: [{ field: 'modelYear', code: 'conflict' }] },
    { row: 3, listingId: null, operation: null, status: 'rejected', reason: 'identity_unconfirmed', issues: [] },
    { row: 4, listingId: externalFixtureId(8), operation: 'withdraw', status: 'applied', reason: null, issues: [] },
  ].map(row => ExternalBatchRecordSchema.parse(row));
  const stats = { grossCharacters: 30, existingCharacters: 10, glossaryCharacters: 5, cachedCharacters: 0, duplicateCharacters: 5, estimatedCharacters: 10, estimatedCalls: 1 };
  const trial = ExternalTrialSchema.parse({
    id: '00000000-0000-4000-8000-000000000102', batchId: batch.id, createdAt: externalFixtureTime, status: 'dry_run',
    vehicleIds: Array.from({ length: 100 }, (_, i) => externalFixtureId(i + 1)),
    estimate: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value * 3])),
    byField: ['title', 'model', 'description'].map(field => ({ field, ...stats })),
    budget: { month: '2026-11', batchLimit: 100_000, accountFreeRemaining: null, reservedCharacters: 0, attemptedCharacters: 0, realCalls: 0 },
  });
  return { batch, records, listing, withdrawn: { ...listing, state: 'withdrawn' as const, vehicle: null }, trial };
}
