import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import type { CalculationInput, ReferencePolicyFacts } from '../../core/types';
import { calculateUzReference, UZ_REFERENCE_VERSION } from './reference';

const SAMPLE: CalculationInput = {
  country: 'UZ',
  importerType: 'individual',
  powertrain: 'petrol',
  condition: 'used',
  price: '25000',
  currency: 'USD',
  displacementCc: '1998',
  powerHp: '',
  manufactureDate: '2021-01',
  customsDate: '2026-01-01',
  freight: '2250',
  insurance: '0',
  steering: 'left',
  transactionRate: '11851.454593',
  euroRate: '',
  usdRate: '11851.454593',
};
function result(changes: Partial<CalculationInput> = {}, ages: Partial<ReferencePolicyFacts> = {}) {
  return calculateUzReference({
    input: { ...SAMPLE, ...changes },
    ageMonths: 60,
    ageYears: 5,
    ...ages,
  });
}
function amount(
  id: string,
  changes: Partial<CalculationInput> = {},
  ages: Partial<ReferencePolicyFacts> = {},
) {
  return result(changes, ages).lines.find((line) => line.id === id)!.amount;
}
const SIMPLE = {
  price: '10000',
  freight: '0',
  insurance: '0',
  transactionRate: '1000',
  usdRate: '1000',
};

describe('UZ 2026 research reference', () => {
  it('reproduces the independently recorded five-fee default sample', () => {
    const quote = result();
    expect(UZ_REFERENCE_VERSION).toBe('uz-reference-2026.10.22-v1');
    expect(quote.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['customsFee', '1030000'],
      ['duty', '200218474'],
      ['vat', '62780473'],
      ['recycling', '86520000'],
      ['registration', '5372480'],
    ]);
    expect(quote.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toFixed(0)).toBe(
      '355921427',
    );
    expect(quote.additionalCosts).toEqual([]);
  });

  it('adds freight and insurance to tax base without adding their principal as a fee', () => {
    const quote = result({ ...SIMPLE, freight: '2000', insurance: '100' });
    expect(quote.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['customsFee', '618000'],
      ['duty', '10834000'],
      ['vat', '2752080'],
      ['recycling', '86520000'],
      ['registration', '5372480'],
    ]);
  });

  it('preserves exact CNY/USD equivalence using explicit target-currency rates', () => {
    const usd = result({ ...SIMPLE, freight: '2000', insurance: '100' });
    const equivalent = result({
      ...SIMPLE,
      currency: 'CNY',
      price: '50000',
      freight: '10000',
      insurance: '500',
      transactionRate: '200',
      usdRate: '1000',
    });
    expect(equivalent).toEqual(usd);
  });

  it.each([
    ['petrol', 12, '1000', '1900000'],
    ['petrol', 13, '1000', '4800000'],
    ['petrol', 12, '1500', '2400000'],
    ['petrol', 12, '1800', '2940000'],
    ['petrol', 12, '3000', '4500000'],
    ['petrol', 12, '3001', '5251250'],
    ['diesel', 12, '1500', '2400000'],
    ['diesel', 12, '2500', '3500000'],
    ['diesel', 12, '2501', '4626250'],
    ['diesel', 13, '1500', '6000000'],
    ['diesel', 13, '2500', '9250000'],
    ['diesel', 13, '2501', '10503000'],
  ] as const)(
    'calculates new %s at %s months / %s cc',
    (powertrain, ageMonths, displacementCc, expected) => {
      expect(
        amount('duty', { ...SIMPLE, powertrain, condition: 'new', displacementCc }, { ageMonths }),
      ).toBe(expected);
    },
  );

  it('does not classify a young registered vehicle as new', () => {
    expect(
      amount('duty', { ...SIMPLE, condition: 'used', displacementCc: '1000' }, { ageMonths: 1 }),
    ).toBe('7000000');
    expect(
      amount('duty', { ...SIMPLE, condition: undefined, displacementCc: '1000' }, { ageMonths: 1 }),
    ).toBe('7000000');
  });

  it.each(['hev', 'phev', 'erev'] as const)('uses the hybrid tariff for %s', (powertrain) => {
    const changes = { ...SIMPLE, powertrain, displacementCc: '1500' };
    expect(amount('duty', { ...changes, condition: 'new' }, { ageMonths: 12 })).toBe('1500000');
    expect(amount('duty', { ...changes, condition: 'new' }, { ageMonths: 13 })).toBe('3000000');
    expect(amount('duty', changes, { ageMonths: 36 })).toBe('3900000');
    expect(amount('duty', changes, { ageMonths: 37 })).toBe('8500000');
  });

  it.each([
    ['1000', '12360000', '37080000'],
    ['2000', '49440000', '86520000'],
    ['3000', '74160000', '135960000'],
    ['3500', '74160000', '160680000'],
    ['3501', '123600000', '197760000'],
  ])('uses the recycling age boundary for %s cc', (displacementCc, young, old) => {
    expect(amount('recycling', { ...SIMPLE, displacementCc }, { ageMonths: 36 })).toBe(young);
    expect(amount('recycling', { ...SIMPLE, displacementCc }, { ageMonths: 37 })).toBe(old);
  });

  it('calculates BEV duty, VAT, recycling and registration without displacement', () => {
    const changes = { ...SIMPLE, powertrain: 'bev' as const, displacementCc: '' };
    expect(result(changes, { ageMonths: 36 }).lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['customsFee', '412000'],
      ['duty', '0'],
      ['vat', '1200000'],
      ['recycling', '49440000'],
      ['registration', '3172400'],
    ]);
    expect(amount('recycling', changes, { ageMonths: 37 })).toBe('86520000');
  });

  it.each([
    ['10000', '412000'],
    ['10000.01', '618000'],
    ['20000', '618000'],
    ['40000', '1030000'],
    ['60000', '1648000'],
    ['100000', '2884000'],
    ['200000', '4120000'],
    ['500000', '6180000'],
    ['1000000', '8240000'],
    ['1000000.01', '10300000'],
  ])('uses the USD customs value band at %s', (price, expected) => {
    expect(amount('customsFee', { ...SIMPLE, price })).toBe(expected);
  });

  it('keeps omitted optional freight at the explicitly assumed no-added-cost basis', () => {
    expect(result({ ...SIMPLE, freight: '', insurance: '' })).toEqual(result(SIMPLE));
  });
});
