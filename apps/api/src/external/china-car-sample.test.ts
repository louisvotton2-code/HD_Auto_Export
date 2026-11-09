import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExternalUpsertCandidateSchema } from '@hd/contracts/admin';
import { adaptChinaCarSample } from './china-car-sample.js';
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
