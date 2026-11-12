import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminVehicleResponseSchema, CreateVehicleRequestSchema, DraftMoneySchema, DraftPriceSchema,
  SaveVehicleRequestSchema, VehicleDraftInputSchema,
} from '../dist/admin.js';
import { MoneySchema, PublicPriceSchema, PublicVehicleSchema } from '../dist/public.js';
import { adminVehicleFixture, makeDemoVehicleDraftFixture, makeExternalVehicleDraftFixture,
  makePublicVehicleFixture, makeVehicleDraftFixture } from '../dist/fixtures.js';

test('draft amounts preserve a selected currency and distinguish missing from known zero', () => {
  for (const currency of ['USD', 'CNY', 'RUB', 'KRW']) {
    assert.deepEqual(DraftMoneySchema.parse({ amount: null, currency }), { amount: null, currency });
    for (const amount of ['0', '0.00', '23500.50']) {
      const value = { amount, currency };
      assert.deepEqual(DraftMoneySchema.parse(value), MoneySchema.parse(value));
    }
  }
  for (const value of [
    { currency: 'USD' }, { amount: null }, { amount: null, currency: 'ZZZ' },
    { amount: null, currency: 'usd' }, { amount: null, currency: 'USD', country: 'US' },
  ]) assert.equal(DraftMoneySchema.safeParse(value).success, false);
  for (const amount of ['', 'null', ' ', '01.00', '-1', '1e3', '1,000', '1.234', 0, undefined]) {
    assert.equal(DraftMoneySchema.safeParse({ amount, currency: 'USD' }).success, false);
  }
});

test('create, save and admin readback contracts preserve incomplete asking price and purchase cost', () => {
  for (const money of [null, { amount: null, currency: 'RUB' }]) {
    const draft = makeVehicleDraftFixture();
    draft.price = { kind: 'asking', money, includes: ['Vehicle only'] };
    draft.internal.purchaseCost = { amount: null, currency: 'CNY' };
    const created = CreateVehicleRequestSchema.parse({ draft });
    const saved = SaveVehicleRequestSchema.parse({ version: 2, draft: created.draft });
    const encoded = JSON.stringify({ data: { ...adminVehicleFixture, version: 3, draft: saved.draft }, meta: { requestId: 'draft-money-roundtrip' } });
    const readback = AdminVehicleResponseSchema.parse(JSON.parse(encoded)).data.draft;
    assert.deepEqual(readback.price, draft.price);
    assert.deepEqual(readback.internal.purchaseCost, { amount: null, currency: 'CNY' });
    assert.equal(readback.price.kind, 'asking');
  }
  const knownZero = makeVehicleDraftFixture();
  knownZero.price = { kind: 'asking', money: { amount: '0', currency: 'USD' }, includes: [] };
  knownZero.internal.purchaseCost = { amount: '0.00', currency: 'CNY' };
  assert.deepEqual(VehicleDraftInputSchema.parse(knownZero), knownZero);
});

test('incomplete draft money cannot cross the public price or public vehicle boundary', () => {
  for (const money of [null, { amount: null, currency: 'USD' }]) {
    const price = { kind: 'asking', money, includes: [] };
    assert.equal(DraftPriceSchema.safeParse(price).success, true);
    assert.equal(PublicPriceSchema.safeParse(price).success, false);
    assert.equal(PublicVehicleSchema.safeParse({ ...makePublicVehicleFixture(), price }).success, false);
  }
  assert.equal(MoneySchema.safeParse({ amount: null, currency: 'USD' }).success, false);
  assert.equal(PublicPriceSchema.safeParse({ kind: 'on_request', money: null, includes: [] }).success, true);
});

test('reference and on-request branches keep strict money rules and existing source restrictions', () => {
  for (const money of [null, { amount: null, currency: 'CNY' }]) {
    assert.equal(DraftPriceSchema.safeParse({ kind: 'reference', money, includes: [] }).success, false);
  }
  assert.equal(DraftPriceSchema.safeParse({ kind: 'on_request', money: { amount: null, currency: 'USD' }, includes: [] }).success, false);
  for (const draft of [makeVehicleDraftFixture(), makeDemoVehicleDraftFixture(), makeExternalVehicleDraftFixture()]) {
    assert.deepEqual(VehicleDraftInputSchema.parse(draft), draft);
  }
  const external = makeExternalVehicleDraftFixture();
  external.price = { kind: 'asking', money: null, includes: [] };
  assert.equal(VehicleDraftInputSchema.safeParse(external).success, false);
  const demo = makeDemoVehicleDraftFixture();
  demo.price = { kind: 'asking', money: { amount: null, currency: 'USD' }, includes: [] };
  assert.equal(VehicleDraftInputSchema.safeParse(demo).success, false);
});
