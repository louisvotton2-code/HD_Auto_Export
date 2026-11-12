import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeExternalStructuredCandidateFixture } from '@hd/contracts/fixtures';
import { ExternalUpsertCandidateSchema } from '@hd/contracts/admin';
import { adaptChinaCarSample } from './china-car-sample.js';
import { sourceInspectionContent } from './inspection.js';
import { buildProjection, emptyOverrides } from './normalize.js';

const time = '2026-11-09T00:00:00Z';
const source = { source: 'dongchedi', id: 'S-INSPECTION-01', status: 'active', updatedAt: time,
  url: 'https://www.dongchedi.com/synthetic/S-INSPECTION-01', title: 'Fixture car', ownershipTransfers: 0,
  hasReport: true, inspectionAvailable: true };
const rawReport = { id: source.id, source: source.source,
  counts: [{ category: 'Accident', faults: 0, checked: 73 }, { category: 'Fire', faults: null, checked: null }],
  checks: [{ category: 'Body', defects: 1, groups: [{ name: 'Exterior', defects: 1, items: [
    { part: 'Door', result: 'Scratch', ok: false }, { part: 'Bonnet', result: null, ok: null },
  ] }] }],
  defects: [{ category: 'Body', count: 1, items: [{ group: 'Exterior', part: 'Door', finding: 'Scratch',
    details: [{ text: 'Surface scratch', textZh: '表面划痕', photos: ['https://private.example.invalid/photo'] }] }] }],
};

test('adapter keeps source ownership separate from inspection totals, with false/zero/null preserved', () => {
  const candidate = ExternalUpsertCandidateSchema.parse(adaptChinaCarSample(source, time, {}, [], rawReport));
  assert.deepEqual(candidate.history, { ownershipTransfers: 0 });
  assert.equal(candidate.inspection!.checks![0]!.groups[0]!.items[0]!.ok, false);
  assert.equal(candidate.inspection!.checks![0]!.groups[0]!.items[1]!.ok, null);
  assert.equal(candidate.inspection!.checks![0]!.groups[0]!.items[1]!.result, null);
  assert.equal(candidate.inspection!.defects![0]!.items[0]!.details[0]!.textZh!.contentLocale, 'zh');
  assert.equal(candidate.inspection!.hasReport, true);
  assert.deepEqual(Object.keys(candidate.history!), ['ownershipTransfers']);
  assert.doesNotMatch(JSON.stringify(candidate), /photos|private\.example|inspectionAvailable/);
  for (const ownershipTransfers of [null, '0', false, -1, 101]) {
    assert.deepEqual(adaptChinaCarSample({ ...source, ownershipTransfers }, time)!.history, { ownershipTransfers: null });
  }
  assert.deepEqual(adaptChinaCarSample(source, time, {}, [{ field: 'ownershipTransfers' }])!.history, { ownershipTransfers: null });
});

test('normalization filters each tagged leaf and makes every unverified report unknown', () => {
  const candidate = makeExternalStructuredCandidateFixture();
  candidate.inspection!.checks![0]!.groups[0]!.items[0]!.result!.text = 'Contact: +44 7700 900123';
  candidate.inspection!.defects![0]!.items[0]!.details[0]!.text!.text = 'VIN: 1hgcm82633a004352';
  const projected = buildProjection(candidate, emptyOverrides(), 'Synthetic Market');
  assert.deepEqual(projected.details.history, { ownershipTransfers: 0 });
  assert.equal(projected.details.inspection!.checks![0]!.groups[0]!.items[0]!.result, null);
  assert.equal(projected.details.inspection!.checks![0]!.groups[0]!.items[0]!.ok, false);
  assert.equal(projected.details.inspection!.defects![0]!.items[0]!.details[0]!.text, null);
  assert.ok(projected.details.inspection!.defects![0]!.items[0]!.details[0]!.textZh);
  assert.deepEqual(projected.details.inspection!.reportAccess, { status: 'unknown', url: null, checkedAt: null, expiresAt: null });
  assert.equal(projected.details.inspection!.reportUrl, null);
  assert.doesNotMatch(JSON.stringify(projected), /7700|1hgcm|reports\.example/);
  assert.ok(projected.issues.some(issue => issue.field === 'inspection' && issue.code === 'invalid'));
  candidate.disputes = ['modelYear'];
  const disputed = buildProjection(candidate, emptyOverrides(), 'Synthetic Market');
  assert.equal(disputed.details.inspection, null);
  assert.equal(disputed.details.history, null);
});

test('raw detector counts are numeric-or-null and excessive nested leaves have a combined bound', () => {
  const text = (value: unknown) => typeof value === 'string' ? { text: value, contentLocale: 'en' } : null;
  const content = sourceInspectionContent({ checks: [{ category: 'Body', defects: '0', groups: [{ name: 'Panels', defects: 0,
    items: Array.from({ length: 1400 }, () => ({ part: 'Door', result: null, ok: false })) }] }],
    defects: rawReport.defects }, text);
  assert.equal(content.checks![0]!.defects, null);
  assert.equal(content.checks![0]!.groups[0]!.defects, 0);
  assert.equal(content.checks![0]!.groups[0]!.items.length, 1000);
  assert.equal(content.defects!.length, 0);
});


test('source report markers and nonempty original URLs survive as presence without granting unsafe links', () => {
  for (const patch of [{ hasInspectionReport: true }, { inspectionAvailable: true }, { inspectionReportUrl: 'http://unsafe.invalid/report' }]) {
    const candidate = adaptChinaCarSample({ ...source, hasReport: false, inspectionAvailable: false, ...patch }, time)!;
    assert.deepEqual(candidate.inspection, { hasReport: true, reportUrl: null, entries: [], checks: [], defects: [] });
  }
  const absent = adaptChinaCarSample({ ...source, hasReport: false, inspectionAvailable: false, hasInspectionReport: false }, time)!;
  assert.equal(absent.inspection, null);
});


test('a populated report record proves presence only after exact vehicle and platform association', () => {
  const noFlags = { ...source, hasReport: false, inspectionAvailable: false };
  assert.equal(adaptChinaCarSample(noFlags, time, {}, [], rawReport)!.inspection!.hasReport, true);
  for (const report of [{}, { id: source.id, source: source.source }, { ...rawReport, id: 'another-vehicle' },
    { ...rawReport, source: 'che168' }, { ...rawReport, source: undefined }]) {
    assert.equal(adaptChinaCarSample(noFlags, time, {}, [], report)!.inspection, null);
  }
});
