import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationPreviewSchema, PublishReadinessSchema, ConfirmPublicationPreviewRequestSchema } from '../dist/admin.js';
import { makePublicationPreviewFixture, makePublishReadinessFixture } from '../dist/fixtures.js';

test('authenticated preview represents incomplete prices and real review states without private fields', () => {
  for (const locale of ['zh', 'en', 'ru']) for (const scenario of ['ready', 'incomplete', 'stale', 'machine']) {
    const preview = makePublicationPreviewFixture(locale, scenario);
    assert.equal(PublicationPreviewSchema.safeParse(preview).success, true);
    assert.equal(PublicationPreviewSchema.safeParse({ ...preview, vehicle: { ...preview.vehicle, internal: { purchaseCost: 'secret' } } }).success, false);
    if (scenario === 'incomplete') {
      assert.equal(preview.vehicle.price.money.amount, null);
      assert.equal(preview.vehicle.price.money.currency, 'CNY');
      assert.equal(preview.vehicle.price.displayPrice, null);
      assert.equal(PublicationPreviewSchema.safeParse({ ...preview, vehicle: { ...preview.vehicle, price: { ...preview.vehicle.price, status: 'ready' } } }).success, false);
    }
    if (scenario === 'machine') {
      assert.equal(preview.vehicle.content.title.kind, 'machine');
      assert.equal(preview.vehicle.content.title.reviewStatus, 'pending');
    }
  }
});

test('confirmation explicitly binds a viewed revision, fingerprint and locale; gates cannot substitute for one another', () => {
  const preview = makePublicationPreviewFixture();
  const input = { version: preview.vehicleVersion, publicContentRevision: preview.publicContentRevision,
    fingerprint: preview.fingerprint, locale: preview.locale };
  assert.equal(ConfirmPublicationPreviewRequestSchema.safeParse(input).success, true);
  for (const field of Object.keys(input)) {
    const missing = { ...input }; delete missing[field];
    assert.equal(ConfirmPublicationPreviewRequestSchema.safeParse(missing).success, false);
  }
  const readiness = makePublishReadinessFixture(true);
  assert.equal(PublishReadinessSchema.safeParse({ ...readiness, localizationReady: false }).success, false);
  assert.equal(makePublishReadinessFixture(false).canPublish, false);
});
