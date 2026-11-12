import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminReportSchema, ExternalUpsertCandidateSchema } from '../dist/external-admin.js';
import {
  EXTERNAL_INSPECTION_MAX_LEAVES, ExternalHistorySchema, ExternalInspectionContentSchema,
  ExternalInspectionSchema, ExternalReportAccessSchema, PublicReportSchema,
} from '../dist/external-public.js';
import { PublicVehicleSchema } from '../dist/public.js';
import {
  makeExternalCandidateFixture, makeExternalInspectionFixture, makeExternalStructuredCandidateFixture,
  makeExternalStructuredPublicVehicleFixture, makeImportedPublicVehicleFixture,
} from '../dist/external-fixtures.js';

const tag = text => ({ text, contentLocale: 'en' });
const checkedAt = '2026-11-09T00:00:00Z';
const expiresAt = '2026-11-09T01:00:00Z';
const reportUrl = 'https://reports.example.invalid/synthetic-0001';

test('legacy external candidates and public details need no history, structured inspection or report evidence', () => {
  const candidate = ExternalUpsertCandidateSchema.parse(makeExternalCandidateFixture());
  const vehicle = PublicVehicleSchema.parse(makeImportedPublicVehicleFixture('en', 'supplier', true));
  assert.equal(candidate.history, undefined);
  assert.equal(candidate.inspection.checks, undefined);
  assert.equal(vehicle.external.detail.history, undefined);
  assert.equal(vehicle.external.detail.inspection.reportAccess, undefined);
  assert.equal(vehicle.external.detail.inspection.reportUrl, null);
  vehicle.external.detail.history = null;
  assert.equal(PublicVehicleSchema.parse(vehicle).external.detail.history, null);
});

test('ownership history preserves explicit zero and unknown without accepting unrelated event counts', () => {
  for (const value of [0, 100, null]) assert.deepEqual(ExternalHistorySchema.parse({ ownershipTransfers: value }), { ownershipTransfers: value });
  for (const value of [-1, 101, 0.5, false, '0', undefined]) assert.equal(ExternalHistorySchema.safeParse({ ownershipTransfers: value }).success, false);
  for (const field of ['accidents', 'thefts', 'floods', 'fires', 'owners']) {
    assert.equal(ExternalHistorySchema.safeParse({ ownershipTransfers: 0, [field]: 0 }).success, false);
  }
});

test('inspection leaves retain false, zero and null as distinct source facts', () => {
  const inspection = makeExternalInspectionFixture();
  assert.equal(inspection.checks[0].groups[0].items[0].ok, false);
  assert.equal(inspection.checks[0].groups[0].items[1].ok, null);
  assert.equal(inspection.checks[0].groups[0].items[1].result, null);
  assert.equal(inspection.checks[0].groups[1].defects, 0);
  assert.equal(inspection.checks[0].groups[1].items[0].ok, true);
  inspection.checks[0].defects = null;
  inspection.defects[0].count = 0;
  const parsed = ExternalInspectionSchema.parse(inspection);
  assert.equal(parsed.checks[0].defects, null);
  assert.equal(parsed.defects[0].count, 0);
  assert.equal(parsed.defects[0].items[0].details[0].text.contentLocale, 'en');
  assert.equal(parsed.defects[0].items[0].details[0].textZh.contentLocale, 'zh');
  for (const value of [-1, 1.5, '0', false, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(inspection); invalid.checks[0].defects = value;
    assert.equal(ExternalInspectionSchema.safeParse(invalid).success, false);
  }
  const invalidOk = structuredClone(inspection); invalidOk.checks[0].groups[0].items[0].ok = 'false';
  assert.equal(ExternalInspectionSchema.safeParse(invalidOk).success, false);
});

test('structured inspection accepts only tagged text and never a raw photo or private field', () => {
  for (const mutate of [
    value => { value.defects[0].items[0].details[0].photos = ['https://photos.example.invalid/private.webp']; },
    value => { value.checks[0].groups[0].items[0].vin = 'PRIVATE_FIXTURE'; },
    value => { value.checks[0].category = 'Raw category string'; },
    value => { value.defects[0].items[0].details[0] = { text: null, textZh: null }; },
  ]) {
    const invalid = makeExternalInspectionFixture(); mutate(invalid);
    assert.equal(ExternalInspectionSchema.safeParse(invalid).success, false);
  }
});

test('the combined inspection leaf limit survives both public and candidate extensions', () => {
  const content = {
    entries: [],
    checks: [{ category: tag('Fixture'), defects: null, groups: [{ name: tag('Fixture group'), defects: null,
      items: Array.from({ length: EXTERNAL_INSPECTION_MAX_LEAVES - 2 }, () => ({ part: tag('Fixture part'), result: null, ok: null })) }] }],
    defects: [{ category: tag('Fixture'), count: 1, items: [{ group: tag('Fixture group'), part: tag('Fixture part'),
      finding: tag('Fixture finding'), details: [{ text: tag('Fixture detail'), textZh: null }] }] }],
  };
  assert.ok(ExternalInspectionContentSchema.safeParse(content).success);
  assert.ok(ExternalInspectionSchema.safeParse({ ...content, reportUrl: null }).success);
  assert.ok(ExternalUpsertCandidateSchema.safeParse({ ...makeExternalCandidateFixture(), inspection: { ...content, reportUrl: null } }).success);
  content.checks[0].groups[0].items.push({ part: tag('One extra leaf'), result: null, ok: null });
  assert.equal(ExternalInspectionContentSchema.safeParse(content).success, false);
  assert.equal(ExternalInspectionSchema.safeParse({ ...content, reportUrl: null }).success, false);
  assert.equal(ExternalUpsertCandidateSchema.safeParse({ ...makeExternalCandidateFixture(), inspection: { ...content, reportUrl: null } }).success, false);
  const emptyOverflow = { entries: [], checks: Array.from({ length: 31 }, () => ({ category: tag('Fixture'), defects: 0, groups: [] })) };
  assert.equal(ExternalInspectionContentSchema.safeParse(emptyOverflow).success, false);
});

test('report evidence has four strict states and an available-only URL', () => {
  const unknown = { status: 'unknown', url: null, checkedAt: null, expiresAt: null };
  assert.deepEqual(ExternalReportAccessSchema.parse(unknown), unknown);
  for (const status of ['available', 'unavailable', 'expired']) {
    const input = { status, url: status === 'available' ? reportUrl : null, checkedAt, expiresAt };
    assert.deepEqual(ExternalReportAccessSchema.parse(input), input);
    assert.equal(ExternalReportAccessSchema.safeParse({ ...input, checkedAt: null }).success, false);
    assert.equal(ExternalReportAccessSchema.safeParse({ ...input, expiresAt: checkedAt }).success, false);
    assert.equal(ExternalReportAccessSchema.safeParse({ ...input, expiresAt: '2026-11-08T23:00:00Z' }).success, false);
    assert.equal(ExternalReportAccessSchema.safeParse({ ...input, url: status === 'available' ? null : reportUrl }).success, false);
  }
  for (const invalid of [{ ...unknown, url: reportUrl }, { ...unknown, checkedAt }, { ...unknown, hasReport: true },
    { status: 'available', url: 'http://reports.example.invalid/report', checkedAt, expiresAt },
    { status: 'available', url: 'https://user:secret@reports.example.invalid/report', checkedAt, expiresAt }]) {
    assert.equal(ExternalReportAccessSchema.safeParse(invalid).success, false);
  }
});

test('report schema validates declared evidence time ordering without deciding wall-clock availability', () => {
  assert.ok(ExternalReportAccessSchema.safeParse({ status: 'available', url: reportUrl,
    checkedAt: '2001-01-01T00:00:00Z', expiresAt: '2001-01-01T01:00:00Z' }).success);
  assert.ok(ExternalReportAccessSchema.safeParse({ status: 'expired', url: null,
    checkedAt: '2099-01-01T00:00:00Z', expiresAt: '2099-01-01T01:00:00Z' }).success);
});

test('candidates may carry source history and inspection content but cannot assert verified report access', () => {
  const candidate = makeExternalStructuredCandidateFixture();
  assert.equal(candidate.history.ownershipTransfers, 0);
  assert.equal(candidate.inspection.checks[0].groups[0].items[0].ok, false);
  assert.equal('reportAccess' in candidate.inspection, false);
  const verified = { status: 'available', url: reportUrl, checkedAt, expiresAt };
  assert.equal(ExternalUpsertCandidateSchema.safeParse({ ...candidate, inspection: { ...candidate.inspection, reportAccess: verified } }).success, false);
});

test('public reports always contact sales and never carry original URLs, regardless of internal evidence', () => {
  const unknown = makeExternalInspectionFixture('unknown');
  assert.equal(ExternalInspectionSchema.safeParse({ ...unknown, reportUrl }).success, false);
  const available = makeExternalInspectionFixture('available');
  assert.equal(ExternalInspectionSchema.safeParse({ ...available, reportUrl: `${reportUrl}-other` }).success, false);
  for (const locale of ['zh', 'en', 'ru']) for (const status of ['unknown', 'available', 'unavailable', 'expired']) {
    const vehicle = PublicVehicleSchema.parse(makeExternalStructuredPublicVehicleFixture(locale, status));
    const detail = vehicle.external.detail;
    assert.deepEqual(detail.history, { ownershipTransfers: 0 });
    assert.equal(detail.inspection.reportAccess.status, 'unknown');
    assert.deepEqual(vehicle.report, { hasReport: true });
    assert.equal(detail.inspection.reportUrl, null);
    assert.equal(detail.inspection.checks[0].groups[0].items[0].ok, false);
    assert.equal(JSON.stringify(detail).includes('photos'), false);
  }
});


test('report presence is separate from safe admin links and source candidates cannot assert public access', () => {
  for (const hasReport of [true, false]) assert.deepEqual(PublicReportSchema.parse({ hasReport }), { hasReport });
  assert.equal(PublicReportSchema.safeParse({ hasReport: true, url: reportUrl }).success, false);
  assert.deepEqual(AdminReportSchema.parse({ hasReport: true, url: null }), { hasReport: true, url: null });
  assert.deepEqual(AdminReportSchema.parse({ hasReport: true, url: reportUrl }), { hasReport: true, url: reportUrl });
  for (const url of ['http://reports.example.invalid/report', 'javascript:alert(1)', 'https://user:secret@reports.example.invalid/report'])
    assert.equal(AdminReportSchema.safeParse({ hasReport: true, url }).success, false);
  assert.equal(AdminReportSchema.safeParse({ hasReport: false, url: reportUrl }).success, false);
  const candidate = makeExternalStructuredCandidateFixture();
  assert.equal(candidate.inspection.hasReport, true);
  candidate.inspection.reportUrl = null;
  assert.equal(ExternalUpsertCandidateSchema.parse(candidate).inspection.hasReport, true);
  const publicVehicle = makeExternalStructuredPublicVehicleFixture();
  publicVehicle.external.detail.inspection.reportUrl = reportUrl;
  delete publicVehicle.external.detail.inspection.reportAccess;
  assert.equal(PublicVehicleSchema.safeParse(publicVehicle).success, false);
  publicVehicle.external.detail.inspection.reportUrl = null;
  publicVehicle.external.detail.inspection.reportAccess = { status: 'available', url: reportUrl, checkedAt, expiresAt };
  assert.equal(PublicVehicleSchema.safeParse(publicVehicle).success, false);
});
