import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { calculateImportEstimate, type CountryCode } from '../index';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { createVehicleEstimateDraft, vehicleEstimateIdentity, vehicleEstimateInput } from './vehicle-estimate';
import { vehicleManufacturePrefill } from './manufacture-estimate';

const date = '2026-11-08';
const rates = createReferenceSnapshot();
function knownVehicle() {
  const vehicle = makePublicVehicleFixture();
  vehicle.facts.powerHp = 150;
  return vehicle;
}

describe('vehicle facts to import estimate', () => {
  it('prefills actual hp without deriving or mixing other power measurements', () => {
    const vehicle = knownVehicle();
    const input = createVehicleEstimateDraft(vehicle, 'RU', date, rates);
    expect(input).toMatchObject({
      price: '23500.00', currency: 'USD', displacementCc: '1998',
      powerHp: '150', manufactureDate: '2024-02', customsDate: date,
      freight: '', insurance: '', steering: '', condition: '',
    });
    expect(calculateImportEstimate(vehicleEstimateInput(input)).status).toBe('reference');
  });

  it('uses real manufacture evidence and never turns a manufacture/model year into January', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.firstRegistration = { precision: 'day', value: '2024-05-15' };
    vehicle.facts.manufacturedAt = null;
    expect(vehicleManufacturePrefill(vehicle, date)).toEqual({ value: '' });
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates).manufactureDate).toBe('');
    vehicle.facts.manufacturedAt = { precision: 'year', value: '2023' };
    expect(vehicleManufacturePrefill(vehicle, date)).toEqual({ value: '' });
    vehicle.facts.manufacturedAt = { precision: 'day', value: '2024-03-28' };
    expect(vehicleManufacturePrefill(vehicle, date)).toEqual({ value: '2024-03' });
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates).manufactureDate).toBe('2024-03');
  });

  it('uses formal ranges as ranges, expands year endpoints, and prioritizes exact evidence', () => {
    const vehicle = knownVehicle();
    vehicle.facts.manufacturedAt = null;
    vehicle.manufacture = { date: null, range: {
      earliest: { precision: 'year', value: '2021' }, latest: { precision: 'year', value: '2024' },
    }, source: 'supplier', basis: null };
    expect(vehicleManufacturePrefill(vehicle, date)).toEqual({ value: '', range: { from: '2021-01', to: '2024-12' } });
    vehicle.manufacture.date = { precision: 'day', value: '2023-04-15' };
    expect(vehicleManufacturePrefill(vehicle, date)).toEqual({ value: '2023-04' });
  });

  it('does not substitute a kW or another scope when direct hp is missing', () => {
    const vehicle = knownVehicle();
    vehicle.facts.powerHp = null;
    vehicle.facts.powerKw = 400;
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates).powerHp).toBe('');
  });

  it('leaves the month empty for missing or future year estimates, even if first registration is known', () => {
    const vehicle = knownVehicle();
    vehicle.facts.firstRegistration = { precision: 'day', value: '2024-05-15' };
    vehicle.facts.manufacturedAt = null;
    for (const year of [null, 2027]) {
      vehicle.facts.modelYear = year;
      const input = createVehicleEstimateDraft(vehicle, 'RU', date, rates);
      expect(input.manufactureDate).toBe('');
      expect(calculateImportEstimate(vehicleEstimateInput(input))).toMatchObject({
        status: 'incomplete', total: null, missingFields: expect.arrayContaining(['manufactureDate']),
      });
    }
  });

  it.each(['unknown', 'lpg', 'other'] as const)('keeps unsupported %s and missing numeric facts unselected', (powertrain) => {
    const vehicle = makePublicVehicleFixture();
    Object.assign(vehicle.facts, { powertrain, engineCc: null, powerKw: null, powerHp: null });
    const input = createVehicleEstimateDraft(vehicle, 'RU', date, rates);
    expect(input).toMatchObject({ powertrain: '', displacementCc: '', powerHp: '' });
    expect(calculateImportEstimate(vehicleEstimateInput(input))).toMatchObject({ status: 'incomplete', total: null });
  });

  it('uses only supported snapshot currencies and preserves missing/on-request prices', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.price = { kind: 'reference', money: { amount: '69000', currency: 'CNY' }, includes: [] };
    vehicle.displayPrice = {
      status: 'ready', kind: 'reference', money: { amount: '9900.00', currency: 'USD' },
      conversion: { asOf: '2026-11-09T00:00:00Z', source: 'synthetic' },
    };
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates)).toMatchObject({ price: '9900.00', currency: 'USD' });
    vehicle.displayPrice = { status: 'unavailable', money: null, conversion: null, reason: 'rate_unavailable' };
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates)).toMatchObject({ price: '69000', currency: 'CNY' });
    vehicle.price.money!.currency = 'KRW';
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates).price).toBe('');
    vehicle.price = { kind: 'on_request', money: null, includes: [] };
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates).price).toBe('');
  });

  it('requires explicit GE steering and UZ registration, rather than assuming left/used', () => {
    const vehicle = makePublicVehicleFixture();
    expect(calculateImportEstimate(vehicleEstimateInput(createVehicleEstimateDraft(vehicle, 'GE', date, rates))))
      .toMatchObject({ status: 'incomplete', missingFields: expect.arrayContaining(['steering']) });
    expect(calculateImportEstimate(vehicleEstimateInput(createVehicleEstimateDraft(vehicle, 'UZ', date, rates))))
      .toMatchObject({ status: 'incomplete', missingFields: expect.arrayContaining(['condition']) });
    vehicle.facts.registrationStatus = 'never_registered';
    expect(createVehicleEstimateDraft(vehicle, 'UZ', date, rates).condition).toBe('new');
    vehicle.facts.registrationStatus = 'registered';
    expect(createVehicleEstimateDraft(vehicle, 'UZ', date, rates).condition).toBe('used');
  });

  it.each(['RU', 'KZ', 'UZ', 'GE', 'AM', 'KG', 'AL'] as CountryCode[])(
    'passes completed known facts to the existing %s core without a separate tax algorithm', (country) => {
      const vehicle = knownVehicle();
      vehicle.facts.registrationStatus = 'registered';
      const input = { ...createVehicleEstimateDraft(vehicle, country, date, rates), steering: 'left' as const };
      const result = calculateImportEstimate(vehicleEstimateInput(input));
      expect(result.status).toBe('reference');
      expect(result.total).not.toBeNull();
      if (['UZ', 'AM', 'KG', 'AL'].includes(country)) expect(result.assumptions).toContain('transport_not_in_tax_base');
      expect(result.excludedCosts).toContain('vehicle_price');
    },
  );

  it('changes the reset identity on facts/price edits even when ID and publication time stay the same', () => {
    const vehicle = makePublicVehicleFixture();
    const initial = vehicleEstimateIdentity(vehicle);
    vehicle.facts.engineCc = 1499;
    expect(vehicleEstimateIdentity(vehicle)).not.toBe(initial);
    const afterFacts = vehicleEstimateIdentity(vehicle);
    vehicle.price = { kind: 'on_request', money: null, includes: [] };
    expect(vehicleEstimateIdentity(vehicle)).not.toBe(afterFacts);
    const beforeProjection = vehicleEstimateIdentity(vehicle);
    vehicle.displayPrice = { status: 'unavailable', money: null, conversion: null, reason: 'rate_unavailable' };
    expect(vehicleEstimateIdentity(vehicle)).not.toBe(beforeProjection);
  });
});
