import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { calculateImportEstimate } from '../index';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { convertImportAmountToUsd } from './display-currency';
import { createVehicleEstimateDraft, retargetVehicleEstimateDraft, vehicleEstimateInput } from './vehicle-estimate';
import {
  createVehicleEstimateFragment, parseVehicleEstimateSeed, readVehicleEstimateFragment,
  readStoredEstimateRates, type VehicleEstimateSeed,
} from './estimate-seed';

function seed(): VehicleEstimateSeed {
  const rates = createReferenceSnapshot();
  const vehicle = makePublicVehicleFixture();
  return { version: 1, sourceId: vehicle.id, input: createVehicleEstimateDraft(vehicle, 'RU', '2026-11-08', rates), rates };
}

describe('explicit vehicle calculator fragment handoff', () => {
  it('round trips missing facts and the full 40-digit reference snapshot without fallback defaults', () => {
    const value = seed();
    value.input.powertrain = '';
    value.input.manufactureDate = '';
    value.input.price = '';
    const fragment = createVehicleEstimateFragment(value)!;
    expect(fragment).toMatch(/^#hd-estimate=/);
    expect(readVehicleEstimateFragment(fragment, 'RU')).toEqual({ seed: value, remainingHash: '' });
    expect(readVehicleEstimateFragment(fragment, 'KZ')).toBeNull();
  });

  it('preserves the origin of positive inferred engine power for combustion vehicles only', () => {
    const value = seed();
    value.input.powertrain = 'petrol';
    value.input.powerHp = '360.2993';
    value.enginePowerPrefill = true;
    const fragment = createVehicleEstimateFragment(value)!;
    expect(readVehicleEstimateFragment(fragment, 'RU')?.seed).toEqual(value);
    expect(parseVehicleEstimateSeed({ ...value, input: { ...value.input, powertrain: 'bev' } })).toBeNull();
    expect(parseVehicleEstimateSeed({ ...value, input: { ...value.input, powerHp: '0' } })).toBeNull();
  });

  it('accepts a seven-destination FX snapshot while preserving all originally supplied rates', () => {
    const value = seed();
    const { TJS, TMT, ...legacyRates } = value.rates.rates;
    const parsed = parseVehicleEstimateSeed({ ...value, rates: { ...value.rates, rates: legacyRates } });
    expect(parsed?.rates.rates).toEqual({ ...legacyRates, TJS, TMT });
    expect(parsed?.input).toEqual(value.input);
  });

  it('carries entered Tajik tariff fields to the standalone calculator without accepting them on another route', () => {
    const value = seed();
    const vehicle = makePublicVehicleFixture();
    const vehiclePrice = value.input.price;
    const defaults = retargetVehicleEstimateDraft(value.input, 'TJ', value.rates, vehicle);
    expect(defaults).toMatchObject({ tjDutyPercent: '10', tjExcisePercent: '14', tjExciseMinimum: '0.20' });
    value.input = {
      ...defaults, tjExciseMinimum: '0.25', price: '12345',
    };
    const fragment = createVehicleEstimateFragment(value)!;
    expect(readVehicleEstimateFragment(fragment, 'TJ')?.seed).toEqual(value);
    const anotherCountry = retargetVehicleEstimateDraft(value.input, 'TM', value.rates, vehicle);
    expect(parseVehicleEstimateSeed({ ...value, input: anotherCountry })).toBeNull();
    const anotherFragment = createVehicleEstimateFragment({ ...value, input: anotherCountry })!;
    const anotherSeed = readVehicleEstimateFragment(anotherFragment, 'TM')?.seed;
    expect(anotherSeed?.input).toMatchObject({ country: 'TM', price: vehiclePrice });
    expect(anotherSeed?.input).not.toHaveProperty('tjExciseMinimum');
    expect(retargetVehicleEstimateDraft(anotherCountry, 'TJ', value.rates, vehicle))
      .toEqual({ ...value.input, price: vehiclePrice });
  });

  it('removes only its valid entry while preserving other fragment content byte-for-byte', () => {
    const fragment = createVehicleEstimateFragment(seed())!;
    expect(readVehicleEstimateFragment(`#contact&${fragment.slice(1)}&panel=fees%20open`, 'RU')?.remainingHash)
      .toBe('#contact&panel=fees%20open');
    expect(readVehicleEstimateFragment('#contact', 'RU')).toBeNull();
    expect(readVehicleEstimateFragment(`${fragment}&${fragment.slice(1)}`, 'RU')).toBeNull();
    expect(readVehicleEstimateFragment('#hd-estimate=%ZZ', 'RU')).toBeNull();
    expect(readVehicleEstimateFragment('#hd-estimate=' + 'x'.repeat(6000), 'RU')).toBeNull();
  });

  it('removes an old guessed January date while retaining other known draft facts', () => {
    const value = seed();
    expect(parseVehicleEstimateSeed(value)).toEqual(value);
    const legacy = { ...value, manufactureEstimate: 'model_year' };
    expect(parseVehicleEstimateSeed(legacy)).toBeNull();
    value.input.manufactureDate = '2024-01';
    const fragment = `#hd-estimate=${encodeURIComponent(JSON.stringify(legacy))}`;
    expect(readVehicleEstimateFragment(fragment, 'RU')?.seed).toEqual({ ...value, input: { ...value.input, manufactureDate: '' } });
  });

  it('consumes a legacy link with its vehicle facts and FX, dropping the obsolete source range', () => {
    const value = seed();
    value.input.manufactureDate = '';
    const legacy = { ...value, manufactureRange: { from: '2019-04', to: '2021-01' } };
    const fragment = `#hd-estimate=${encodeURIComponent(JSON.stringify(legacy))}`;
    expect(readVehicleEstimateFragment(fragment, 'RU')?.seed).toEqual(value);
    expect(parseVehicleEstimateSeed({ ...legacy, manufactureRange: { from: '2024-12', to: '2024-01' } })).toBeNull();
    expect(parseVehicleEstimateSeed({ ...legacy, input: { ...legacy.input, manufactureDate: '2024-01' } })).toBeNull();
  });

  it.each([
    (value: VehicleEstimateSeed) => Object.assign(value, { admin: true }),
    (value: VehicleEstimateSeed) => Object.assign(value, { version: 2 }),
    (value: VehicleEstimateSeed) => Object.assign(value, { manufactureEstimate: 'trusted' }),
    (value: VehicleEstimateSeed) => Object.assign(value, { sourceId: '../api/admin' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { unknown: 'field' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { country: { toString: 'x' } }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { price: '1e6' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { price: '-5' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { powertrain: 'lpg' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { steering: 'unknown' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { manufactureDate: '2024' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { customsDate: '2026-02-30' }),
    (value: VehicleEstimateSeed) => Object.assign(value.input, { transactionRate: '0' }),
    (value: VehicleEstimateSeed) => Object.assign(value.rates.rates, { USD: '2' }),
    (value: VehicleEstimateSeed) => Object.assign(value.rates.rates, { GEL: '-1' }),
    (value: VehicleEstimateSeed) => Object.assign(value.rates, { source: 'untrusted' }),
  ])('rejects malformed or extra facts rather than treating them as a valid seed (%#)', (mutate) => {
    const value = seed();
    mutate(value);
    expect(parseVehicleEstimateSeed(value)).toBeNull();
    expect(createVehicleEstimateFragment(value)).toBeNull();
  });

  it('retains the exact local/secondary total after GE handoff and same-country refresh', () => {
    const value = seed();
    value.rates.rates.GEL = '3.1';
    value.input = { ...createVehicleEstimateDraft(makePublicVehicleFixture(), 'GE', '2026-11-08', value.rates), steering: 'left' };
    const consumed = readVehicleEstimateFragment(createVehicleEstimateFragment(value)!, 'GE')!.seed;
    const result = calculateImportEstimate(vehicleEstimateInput(consumed.input));
    expect(result.status).toBe('reference');
    const before = convertImportAmountToUsd(result.total!, vehicleEstimateInput(consumed.input), consumed.rates);
    const saved = JSON.stringify({ input: consumed.input, manualRates: true, rates: consumed.rates });
    const restoredRates = readStoredEstimateRates(saved, 'GE')!;
    expect(restoredRates).toEqual(value.rates);
    expect(convertImportAmountToUsd(result.total!, vehicleEstimateInput(consumed.input), restoredRates)).toBe(before);
    expect(readStoredEstimateRates(saved, 'RU')).toBeNull();
    expect(readStoredEstimateRates('{', 'GE')).toBeNull();
    expect(readStoredEstimateRates(JSON.stringify({ input: consumed.input, rates: { ...value.rates, rates: {} } }), 'GE')).toBeNull();
  });
});
