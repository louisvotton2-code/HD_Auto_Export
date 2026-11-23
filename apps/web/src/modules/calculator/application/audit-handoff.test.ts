import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { calculateImportEstimate } from '../core/calculate';
import { getCountryByCode } from '../config/countries';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { createDefaultInput } from './defaults';
import { restoreCalculatorDraft } from './draft';
import { createVehicleEstimateFragment, readVehicleEstimateFragment } from './estimate-seed';
import { normalizePageInput } from './page-input';
import { createVehicleEstimateDraft, retargetVehicleEstimateDraft, vehicleEstimateInput } from './vehicle-estimate';

const rates = createReferenceSnapshot();
const date = '2026-11-23';

describe('documented facts and edits between the two calculators', () => {
  it('uses July 1 only for a documented production year on the passenger schedule', () => {
    const input = { ...createDefaultInput('RU', '2026-07-01', rates), manufactureDate: '', manufactureYear: '2021', euroRate: '100' };
    const result = calculateImportEstimate(input);
    expect(result.lines.find(line => line.id === 'duty')?.amount).toBe('539460');
    expect(result.assumptions).toContain('eaeu_documented_year');
    expect(calculateImportEstimate({ ...input, customsDate: '2026-07-02' }).lines.find(line => line.id === 'duty')?.amount).toBe('959040');
    expect(calculateImportEstimate({ ...input, manufactureDay: 'bad' }).status).toBe('invalid');
  });
  it('preserves an explicitly cleared date and the remaining vehicle facts through the link', () => {
    const car = makePublicVehicleFixture();
    const input = { ...createVehicleEstimateDraft(car, 'RU', date, rates), customsDate: '' };
    const fragment = createVehicleEstimateFragment({ version: 1, sourceId: car.id, input, rates, customsDateEdited: true });
    expect(readVehicleEstimateFragment(fragment!, 'RU')?.seed.input).toEqual(input);
    expect(createVehicleEstimateFragment({ version: 1, sourceId: car.id, input, rates })).toBeNull();
  });
  it('does not convert a used zero-kilometre listing into a new exempt EV on return from UZ', () => {
    const car = makePublicVehicleFixture();
    Object.assign(car.facts, { registrationStatus: 'registered', mileageKm: 0, powertrain: 'bev' });
    const edited = { ...createVehicleEstimateDraft(car, 'UZ', date, rates), condition: 'new' as const, price: '10000' };
    const al = retargetVehicleEstimateDraft(edited, 'AL', rates, car);
    const restored = restoreCalculatorDraft({ current: JSON.stringify({ input: edited }) }, getCountryByCode('AL')!, date, rates);
    for (const input of [vehicleEstimateInput(al), restored.input]) {
      expect(calculateImportEstimate({ ...input, transactionRate: '100' }).lines.find(l => l.id === 'vat')?.amount).toBe('200000');
    }
  });
  it('uses the KZ customs value entered on the form without importing invisible freight from UZ', () => {
    const input = { ...createDefaultInput('KZ', date, rates), powertrain: 'bev' as const,
      price: '20000', transactionRate: '500', freight: '5000', insurance: '100' };
    const result = calculateImportEstimate(normalizePageInput(input, getCountryByCode('KZ')!));
    expect(result.lines.find(l => l.id === 'duty')?.amount).toBe('1500000');
    expect(calculateImportEstimate(input).lines.find(l => l.id === 'duty')?.amount).toBe('1882500');
  });
  it.each(['UZ', 'GE'] as const)('dispatches the validated calendar date for %s', country => {
    const input = createDefaultInput(country, date, rates);
    expect(calculateImportEstimate({ ...input, customsDate: ' ' + date + ' ' })).toEqual(calculateImportEstimate(input));
  });
});
