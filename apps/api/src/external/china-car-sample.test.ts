import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExternalUpsertCandidateSchema } from '@hd/contracts/admin';
import { adaptChinaCarSample, loadChinaCarSample } from './china-car-sample.js';
import { buildProjection, emptyOverrides } from './normalize.js';
import { chinaCarSampleProfile, knownPhotoExpiry, publicLink } from './profiles.js';

const fetchedAt = '2026-11-09T00:00:00Z';
const signed = 'https://p3-dcd-sign.byteimg.com/synthetic/asset~large.webp?psm=sample.module&lk3s=abc12345&x-expires=2000000000&x-signature=synthetic-signature';
const listing = 'https://www.dongchedi.com/synthetic/S-TEST-01';
const report = 'https://activitym.che168.com/2025/honestVehicleInspectionReport/main/index?dealerid=synthetic&infoid=sample&fromtype=1&isglobal=0';

test('the offline profile permits only approved signed image and report URL shapes', () => {
  assert.equal(publicLink(signed, 'media', chinaCarSampleProfile), signed);
  assert.equal(knownPhotoExpiry(new URL(signed)), '2033-05-18T03:33:20.000Z');
  assert.equal(publicLink(report, 'report', chinaCarSampleProfile), report);
  for (const input of [`${signed}&token=secret`, `${signed}&x-expires=2000000000`, signed.replace('p3-dcd-sign.byteimg.com', 'p3-dcd-sign.byteimg.com.example.invalid'),
    signed.replace('https://', 'https://user:password@'), signed.replace('2000000000', 'forever')]) {
    assert.equal(publicLink(input, 'media', chinaCarSampleProfile), null);
  }
  assert.equal(publicLink(report.replace('/2025/', '/unapproved/'), 'report', chinaCarSampleProfile), null);
  assert.equal(publicLink(listing, 'listing', chinaCarSampleProfile, 'che168'), null);
  assert.equal(publicLink(listing, 'listing', chinaCarSampleProfile, 'dongchedi'), listing);
});

test('sample adaptation preserves dates, CNY and exact same-version language pairs', () => {
  const source = {
    source: 'dongchedi', id: 'S-TEST-01', status: 'active', updatedAt: fetchedAt, url: listing, title: 'Fixture Model S1 2024',
    make: { id: 1, name: 'Example', nameZh: '示例' }, model: { id: 2, name: 'Model S1', nameZh: '样例 S1' },
    modelYear: 2024, firstRegistration: '2024-11', manufactureDate: null, mileageKm: 1900,
    price: { cny: 123400, usd: 18000 }, sellerPrice: { cny: 127000 }, fuel: 'Electric',
    specs: { energyType: 'Pure Electric', bodyType: 'SUV', seats: 5 }, photos: [signed, signed], image: signed,
    seller: { name: 'PRIVATE_VENDOR_MARKER' }, inspectionReportUrl: report,
  };
  const newer = { ...source, title: 'Другой автомобиль S1 2024', updatedAt: '2026-11-10T00:00:00Z' };
  const parsed = ExternalUpsertCandidateSchema.parse(adaptChinaCarSample(source, fetchedAt, { zh: { ...source, title: '样例 S1 2024' }, ru: newer }));
  assert.equal(parsed.copy.title?.original.contentLocale, 'zh');
  assert.equal(parsed.copy.title?.translations.en?.text, source.title);
  assert.equal(parsed.copy.title?.translations.ru, undefined);
  assert.equal(parsed.facts.manufacturedAt, null);
  assert.deepEqual(parsed.facts.firstRegistration, { precision: 'month', value: '2024-11' });
  assert.equal(parsed.images.length, 1);
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE_VENDOR_MARKER/);
  const projection = buildProjection(parsed, emptyOverrides(), '懂车帝', chinaCarSampleProfile);
  assert.equal(projection.priceCny, '123400');
  assert.equal(projection.localized.en.title.kind, 'supplier');
  assert.equal(projection.localized.en.display.platform.contentLocale, 'zh');
  const conflict = adaptChinaCarSample({ ...source, fuel: 'Petrol' }, fetchedAt, {}, [{ field: 'domesticPrice', evidence: { sourceMatchesPrice: false } }])!;
  const disputed = buildProjection(conflict, emptyOverrides(), '懂车帝', chinaCarSampleProfile);
  assert.equal(disputed.facts.powertrain, 'unknown');
  assert.equal(disputed.priceCny, null);
  assert.equal(disputed.details.original.title, null);
  const wrongFacts = { ...source, title: 'Бензиновый S1 2024', fuel: 'Petrol', specs: { ...source.specs, energyType: 'Gasoline' } };
  const mismatched = adaptChinaCarSample(source, fetchedAt, { ru: wrongFacts })!;
  assert.equal(mismatched.copy.title?.translations.ru, undefined);
  const olderPhoto = signed.replace('2000000000', '1000000000');
  const refreshed = adaptChinaCarSample({ ...source, image: olderPhoto }, fetchedAt)!;
  assert.equal(refreshed.images[0]?.sourceMediaId, parsed.images[0]?.sourceMediaId);
  assert.equal(refreshed.images[0]?.url, signed);
});


test('verified offline capture context grants presence without rewriting an omitted raw source field', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'hd-report-capture-fixture-'));
  try {
    for (const relative of ['handoff', 'package/raw', 'package/pilot_100']) await mkdir(path.join(folder, relative), { recursive: true });
    const rows = Array.from({ length: 200 }, (_, i) => ({ source: 'dongchedi', id: `S-CAPTURE-${i + 1}`, status: 'active',
      updatedAt: fetchedAt, lifecycle: { detailFetchedAt: fetchedAt }, url: `https://www.dongchedi.com/synthetic/capture-${i + 1}`, title: 'Synthetic capture' }));
    const jsonl = (values: unknown[]) => values.map(value => JSON.stringify(value)).join('\n') + '\n';
    const pilot = jsonl(rows.slice(0, 100)), control = jsonl(rows.slice(100)), envelopes = jsonl(rows.slice(0, 100).map(row => ({
      source: row.source, id: row.id, raw_payload: row, observed_info: { api_language: 'en', api_response_received_at_utc: fetchedAt },
    })));
    const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
    const capture = { id: rows[0]!.id, checks: [{ category: 'Body', defects: 0, groups: [{ name: 'Exterior', defects: 0,
      items: [{ part: 'Door', result: null, ok: false }] }] }] };
    const files: Record<string, string> = {
      'handoff/summary.json': JSON.stringify({ pilot_raw_sha256: digest(pilot), control_sha256: digest(control), pilot_envelope_sha256: digest(envelopes) }),
      'package/pilot_100/vehicles_100_raw.jsonl': pilot, 'handoff/control-100-raw.jsonl': control,
      'package/pilot_100/vehicles_100_envelopes.jsonl': envelopes,
      'handoff/pilot-identities.json': JSON.stringify(rows.slice(0, 100).map(row => ({ source: row.source, id: row.id, listingUrl: row.url }))),
      'handoff/control-identities.json': JSON.stringify(rows.slice(100).map(row => ({ source: row.source, id: row.id, listingUrl: row.url }))),
      'handoff/language-matches.json': '[]', 'handoff/disputes.json': '[]',
      'package/raw/40_inspection_dongchedi_S-CAPTURE-1_en.json': JSON.stringify({ status: 200, truncated: false, data: capture }),
    };
    await Promise.all(Object.entries(files).map(([relative, value]) => writeFile(path.join(folder, relative), value)));
    const loaded = await loadChinaCarSample(folder), first = loaded.pilot.records[0]!;
    assert.equal(ExternalUpsertCandidateSchema.parse(first.candidate).inspection!.hasReport, true);
    const archived = JSON.parse(first.raw);
    assert.deepEqual(archived.inspection, capture); assert.equal(Object.hasOwn(archived.inspection, 'source'), false);
    assert.equal(ExternalUpsertCandidateSchema.parse(loaded.pilot.records[1]!.candidate).inspection, null);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
