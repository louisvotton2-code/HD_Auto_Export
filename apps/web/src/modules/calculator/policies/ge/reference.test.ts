import { describe, expect, it } from 'vitest';
import { createDefaultInput } from '../../application/defaults';
import { Amount } from '../../core/decimal';
import type { CalculationInput } from '../../core/types';
import { calculateGeReference } from './reference';

function quote(overrides: Partial<CalculationInput> = {}) {
  const input = { ...createDefaultInput('GE', '2026-11-23'), customsDate: '2026-11-23', manufactureDate: '2021-01', displacementCc: '1998', ...overrides };
  return calculateGeReference({
    input, ageYears: Number(input.customsDate.slice(0, 4)) - Number(input.manufactureDate.slice(0, 4)),
    ageMonths: 0,
  });
}

describe('Georgia ordinary HS 8703 passenger car', () => {
  it('uses the reported cc and separates the basic clearance fee from optional services', () => {
    const { lines } = quote();
    expect(Object.fromEntries(lines.map(line => [line.id, line.amount]))).toEqual({
      excise: '2997.00', importTax: '124.88', service: '150.00', vat: '0.00',
    });
    expect(lines.reduce((sum, item) => sum.add(item.amount), new Amount(0)).toFixed(2)).toBe('3271.88');
  });

  it('waives only import duty when a qualifying tariff code, origin and transport are approved', () => {
    const result = quote({ geChinaOriginPreference: 'approved' });
    expect(result.lines.find(line => line.id === 'importTax')).toMatchObject({ amount: '0.00', method: { key: 'GE.importTaxPreferential' } });
    expect(result.lines.reduce((sum, item) => sum.add(item.amount), new Amount(0)).toFixed(2)).toBe('3147.00');
  });

  it.each([
    ['left', undefined, '0.00'], ['right', undefined, '3000.00'], ['left', 'yes', '3000.00'],
  ] as const)('applies the electric excise for steering %s and conversion %s', (steering, steeringConverted, amount) => {
    const result = quote({ steering, steeringConverted, powertrain: 'bev', displacementCc: '' });
    expect(result.lines.find(line => line.id === 'excise')?.amount).toBe(amount);
  });

  it.each([
    ['2026-04-01', undefined, '1998.00'],
    ['2026-04-02', undefined, '2997.00'],
    ['2026-11-23', 'approved', '1998.00'],
  ] as const)('chooses the effective schedule by date and documented transition', (customsDate, gePriorScheduleEligible, amount) => {
    expect(quote({ customsDate, gePriorScheduleEligible }).lines[0]?.amount).toBe(amount);
  });

  it('prices right-hand EVs separately under the prior schedule', () => {
    expect(quote({ customsDate: '2026-04-01', powertrain: 'bev', steering: 'right' }).lines[0]?.amount).toBe('2000.00');
  });

  it('keeps hybrid age, converted steering and age-based rates distinct', () => {
    expect(quote({ powertrain: 'phev' }).lines[0]?.amount).toBe('1198.80');
    expect(quote({ powertrain: 'phev', steeringConverted: 'yes' }).lines[0]?.amount).toBe('8991.00');
    expect(quote({ manufactureDate: '2019-01', powertrain: 'hev' }).lines[0]?.amount).toBe('8991.00');
  });
});
