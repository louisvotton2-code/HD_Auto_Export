import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { calculateImportEstimate, type CountryCode } from '../index';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { createVehicleEstimateDraft, vehicleEstimateIdentity, vehicleEstimateInput } from './vehicle-estimate';

const date = '2026-11-08';
const rates = createReferenceSnapshot();

describe('vehicle facts to import estimate', () => {
  it('prefills known facts and converts actual kW without copying reference placeholders', () => {
    const vehicle = makePublicVehicleFixture();
    const input = createVehicleEstimateDraft(vehicle, 'RU', date, rates);
    expect(input).toMatchObject({
      price: '23500.00', currency: 'USD', displacementCc: '1998',
      powerHp: '149.558378', manufactureDate: '2024-02', customsDate: date,
      freight: '', insurance: '', steering: '', condition: '',
    });
    expect(calculateImportEstimate(vehicleEstimateInput(input)).status).toBe('reference');
  });

  it('does not infer a manufacture month from model year, first registration or a year-only date', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.facts.firstRegistration = { precision: 'day', value: '2024-05-15' };
    for (const manufacturedAt of [null, { precision: 'year' as const, value: '2024' }]) {
      vehicle.facts.manufacturedAt = manufacturedAt;
      const input = createVehicleEstimateDraft(vehicle, 'RU', date, rates);
      expect(input.manufactureDate).toBe('');
      expect(calculateImportEstimate(vehicleEstimateInput(input))).toMatchObject({
        status: 'incomplete', total: null, missingFields: expect.arrayContaining(['manufactureDate']),
      });
    }
    vehicle.facts.manufacturedAt = { precision: 'day', value: '2024-03-28' };
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates).manufactureDate).toBe('2024-03');
  });

  it.each(['unknown', 'lpg', 'other'] as const)('keeps unsupported %s and missing numeric facts unselected', (powertrain) => {
    const vehicle = makePublicVehicleFixture();
    Object.assign(vehicle.facts, { powertrain, engineCc: null, powerKw: null });
    const input = createVehicleEstimateDraft(vehicle, 'RU', date, rates);
    expect(input).toMatchObject({ powertrain: '', displacementCc: '', powerHp: '' });
    expect(calculateImportEstimate(vehicleEstimateInput(input))).toMatchObject({ status: 'incomplete', total: null });
  });

  it('uses only supported snapshot currencies and preserves missing/on-request prices', () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.price = { kind: 'reference', money: { amount: '69000', currency: 'CNY' }, includes: [] };
    expect(createVehicleEstimateDraft(vehicle, 'RU', date, rates).price).toBe('10000.00');
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
      const vehicle = makePublicVehicleFixture();
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
  });
});
