import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationPreviewFrameMessageSchema } from '../dist/admin.js';
const base = { schemaVersion: 1, type: 'hd:auto:publication-preview',
  loadId: '00000000-0000-4000-8000-000000000001', vehicleId: 'fixture-vehicle', locale: 'zh' };
const proof = { vehicleId: base.vehicleId, vehicleVersion: 4, publicContentRevision: 3, fingerprint: 'a'.repeat(64), locale: 'zh' };
test('frame protocol admits only minimal lifecycle messages and bounded layout height', () => {
  for (const event of ['loading', 'disposed']) assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...base, event }).success, true);
  assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...base, event: 'error', error: { code: 'unauthenticated' } }).success, true);
  assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...base, event: 'error', error: { code: 'unavailable', message: 'private detail' } }).success, false);
  for (const height of [240, 16000]) assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...base, event: 'resize', height }).success, true);
  for (const height of [239, 16001, 500.1, Infinity]) assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...base, event: 'resize', height }).success, false);
  assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...base, event: 'resize', height: 500, preview: proof }).success, false);
});
test('rendered proof must identify the same vehicle/language and current exact version fields', () => {
  const ready = { ...base, event: 'ready', preview: proof };
  assert.equal(PublicationPreviewFrameMessageSchema.safeParse(ready).success, true);
  for (const changes of [{ vehicleId: 'wrong' }, { locale: 'ru' }, { fingerprint: 'wrong' }, { publicContentRevision: 0 }])
    assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...ready, preview: { ...proof, ...changes } }).success, false);
  assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...base, event: 'ready' }).success, false);
  assert.equal(PublicationPreviewFrameMessageSchema.safeParse({ ...ready, sourceText: 'private' }).success, false);
});
