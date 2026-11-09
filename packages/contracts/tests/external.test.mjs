import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExternalBulkVisibilityRequestSchema, ExternalImportBatchRequestSchema, ExternalTrialRequestSchema,
} from '../dist/admin.js';
import { ExternalMediaFailureRequestSchema, PublicVehicleSchema } from '../dist/public.js';
import { externalFixtureId, makeExternalAdminFixture, makeExternalImportFixture, makeImportedPublicVehicleFixture, makePublicVehicleFixture } from '../dist/fixtures.js';

test('imported listings may omit remote dimensions or the whole gallery; existing stored media cannot', () => {
  const remote = makeImportedPublicVehicleFixture('ru');
  assert.equal(remote.images[0].width, null);
  assert.equal(remote.images[0].remote.revision, 1);
  assert.equal(makeImportedPublicVehicleFixture('en', 'missing', true).images.length, 0);
  assert.equal(PublicVehicleSchema.safeParse({ ...makePublicVehicleFixture(), images: [] }).success, false);
  for (const bad of [{ url: 'https://user:password@photos.example.invalid/a.webp' }, { width: 100 }, { remote: undefined }]) {
    assert.equal(PublicVehicleSchema.safeParse({ ...remote, images: [{ ...remote.images[0], ...bad }] }).success, false);
  }
  assert.equal(PublicVehicleSchema.safeParse({ ...remote, price: { ...remote.price, money: { amount: '2', currency: 'USD' } } }).success, false);
});

test('three language fixtures distinguish actual origin, supplier and machine text and keep detail optional', () => {
  for (const locale of ['zh', 'en', 'ru']) {
    const original = makeImportedPublicVehicleFixture(locale, 'original');
    assert.equal(original.content.title.kind, 'original');
    assert.equal(original.content.title.contentLocale, 'zh');
    assert.equal(original.external.detail, undefined);
    const supplied = makeImportedPublicVehicleFixture(locale, 'supplier', true);
    assert.equal(supplied.external.detail.original.title.contentLocale, 'zh');
    assert.equal(supplied.content.title.kind, locale === 'zh' ? 'original' : 'supplier');
    const machine = makeImportedPublicVehicleFixture(locale, 'machine', true);
    assert.equal(machine.content.title.reviewed, false);
    if (locale !== 'zh') assert.equal(machine.content.title.kind, 'machine');
  }
  const listing = makeExternalAdminFixture().listing;
  assert.equal(PublicVehicleSchema.safeParse({ ...listing.vehicle, overrides: listing.overrides }).success, false);
});

test('fixed trial IDs are distinct and a browser media hint cannot carry a URL', () => {
  const ids = Array.from({ length: 100 }, (_, index) => externalFixtureId(index + 1));
  assert.ok(ExternalTrialRequestSchema.safeParse({ vehicleIds: ids }).success);
  assert.equal(ExternalTrialRequestSchema.safeParse({ vehicleIds: ids.slice(1) }).success, false);
  assert.equal(ExternalTrialRequestSchema.safeParse({ vehicleIds: [...ids.slice(1), ids[1]] }).success, false);
  assert.equal(ExternalBulkVisibilityRequestSchema.safeParse({ hidden: true, items: [{ id: ids[0], version: 1 }, { id: ids[0], version: 2 }] }).success, false);
  assert.equal(ExternalMediaFailureRequestSchema.safeParse({ revision: 1, url: 'https://example.invalid/photo' }).success, false);
  assert.equal(ExternalImportBatchRequestSchema.parse(makeExternalImportFixture()).records.length, 200);
});
