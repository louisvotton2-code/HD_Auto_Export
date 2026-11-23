import { describe, expect, it } from 'vitest';
import { createDefaultInput } from '../../application/defaults';
import type { CalculationInput } from '../../core/types';
import { calculateAlReference } from './reference';

function quote(overrides: Partial<CalculationInput> = {}) {
  const input = {
    ...createDefaultInput('AL', '2026-11-23'), customsDate: '2026-11-23', price: '3000', transactionRate: '100',
    displacementCc: '1998', freight: '0', insurance: '0', ...overrides,
  };
  return calculateAlReference({ input, ageMonths: 0, ageYears: 0 });
}

describe('Albania ordinary passenger cars', () => {
  it('uses the accepted transaction value instead of imposing a displacement floor', () => {
    expect(quote().lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vat', amount: '60000' }),
      expect.objectContaining({ id: 'registration', amount: '8500' }),
    ]));
    const result = quote({ price: '9000', freight: '1100', transactionRate: '80.7859' });
    expect(result.lines.reduce((sum, line) => sum + Number(line.amount), 0)).toBe(171688);
  });

  it.each([
    ['new', '0', '0'],
    ['used', '0', '200000'],
    ['new', undefined, '200000'],
    ['new', '12', '200000'],
    ['used', '35000', '200000'],
  ] as const)('considers both registration and verified mileage (%s, %s) for EV VAT', (condition, mileageKm, amount) => {
    const result = quote({ price: '10000', powertrain: 'bev', condition, mileageKm });
    expect(result.lines.find(line => line.id === 'vat')?.amount).toBe(amount);
  });

  it('keeps the registration value and seat count independent of the customs value', () => {
    const charged = quote({ seatCount: '7', alRegistrationValueAll: '5000000' });
    expect(charged.lines.find(line => line.id === 'luxuryOnce')?.amount).toBe('70000');
    expect(charged.additionalCosts).toMatchObject([{ id: 'annualLuxury', amount: '21000', kind: 'annual' }]);
    expect(quote({ seatCount: '8', displacementCc: '3500', alRegistrationValueAll: '6000000' }).additionalCosts).toEqual([]);
    expect(quote({ seatCount: '8', displacementCc: '3500', alRegistrationValueAll: '6000000' }).lines.some(line => line.id === 'luxuryOnce')).toBe(false);
    const differentAuthorities = quote({ price: '70000', seatCount: '5', alRegistrationValueAll: '4999999' });
    expect(differentAuthorities.lines.some(line => line.id === 'luxuryOnce')).toBe(false);
    expect(differentAuthorities.additionalCosts).toEqual([]);
  });

  it('distinguishes possible luxury fees from proven, one-time fees', () => {
    const unknown = quote({ price: '50000' });
    expect(unknown.lines.some(line => line.id === 'luxuryOnce')).toBe(false);
    expect(unknown.additionalCosts).toMatchObject([
      { id: 'luxuryOnce', kind: 'one_time_estimate' }, { id: 'annualLuxury', kind: 'annual' },
    ]);
    expect(quote({ displacementCc: '3000', seatCount: '5' }).lines.find(line => line.id === 'luxuryOnce')?.amount).toBe('70000');
  });
});
