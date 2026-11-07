import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import type { CalculationInput, ReferencePolicyFacts } from '../../core/types';
import { calculateKzReference, KZ_REFERENCE_VERSION } from './reference';

const SAMPLE: CalculationInput = {
  country: 'KZ',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '25000',
  currency: 'USD',
  displacementCc: '1998',
  powerHp: '150',
  manufactureDate: '2021-01',
  customsDate: '2026-01-01',
  freight: '',
  insurance: '',
  steering: 'left',
  transactionRate: '468.321957',
  euroRate: '541.1',
};
function result(changes: Partial<CalculationInput> = {}, ages: Partial<ReferencePolicyFacts> = {}) {
  return calculateKzReference({
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

describe('KZ 2026 research reference', () => {
  it('reproduces the independently recorded nine-fee default sample', () => {
    const quote = result();
    expect(KZ_REFERENCE_VERSION).toBe('kz-reference-2026.10.22-v1');
    expect(quote.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['customsFee', '25950'],
      ['duty', '1756207'],
      ['excise', '0'],
      ['luxuryExcise', '0'],
      ['vat', '2158433'],
      ['registration', '2162500'],
      ['plates', '17516'],
      ['recycling', '756875'],
      ['relatedCosts', '400000'],
    ]);
    expect(quote.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toFixed(0)).toBe(
      '7277481',
    );
    expect(quote.additionalCosts).toEqual([]);
  });

  it('uses the engine minimum only after 84 months', () => {
    const changes = {
      price: '1000',
      transactionRate: '500',
      euroRate: '500',
      displacementCc: '1000',
    };
    expect(amount('duty', changes, { ageMonths: 84 })).toBe('75000');
    expect(amount('duty', changes, { ageMonths: 85 })).toBe('180000');
  });

  it.each([
    ['1000', '180000'],
    ['1001', '200200'],
    ['1500', '300000'],
    ['1501', '450300'],
    ['3001', '900300'],
  ])('applies the old-car minimum for %s cc', (displacementCc, expected) => {
    expect(
      amount(
        'duty',
        { price: '1', transactionRate: '500', euroRate: '500', displacementCc },
        { ageMonths: 85 },
      ),
    ).toBe(expected);
  });

  it('keeps the higher value-based duty for an expensive old car', () => {
    expect(amount('duty', {}, { ageMonths: 85 })).toBe('1756207');
  });

  it('uses unrounded duty inside the VAT base', () => {
    expect(amount('duty', { price: '2.72', transactionRate: '1' })).toBe('0');
    expect(amount('vat', { price: '2.72', transactionRate: '1' })).toBe('4153');
  });

  it('charges displacement excise on the entire engine only above 3000 cc', () => {
    expect(amount('excise', { displacementCc: '3000' })).toBe('0');
    expect(amount('excise', { displacementCc: '3001' })).toBe('300100');
  });

  it('charges and rounds luxury excise only above the strict value threshold', () => {
    expect(amount('luxuryExcise', { price: '77850000', transactionRate: '1' })).toBe('0');
    expect(amount('luxuryExcise', { price: '77850005', transactionRate: '1' })).toBe('7785001');
    expect(amount('vat', { price: '77850005', transactionRate: '1' })).toBe('15574153');
  });

  it.each([
    ['petrol', 1, '1081'],
    ['petrol', 2, '216250'],
    ['petrol', 3, '2162500'],
    ['bev', 1, '1081'],
    ['bev', 2, '108125'],
    ['bev', 3, '1081250'],
  ] as const)(
    'uses the %s registration schedule at calendar age %s',
    (powertrain, ageYears, expected) => {
      expect(amount('registration', { powertrain }, { ageYears })).toBe(expected);
    },
  );

  it.each([
    ['1000', '324375'],
    ['1001', '756875'],
    ['2000', '756875'],
    ['2001', '1081250'],
    ['3000', '1081250'],
    ['3001', '2486875'],
  ])('applies the recycling band at %s cc', (displacementCc, expected) => {
    expect(amount('recycling', { displacementCc })).toBe(expected);
  });

  it('supports a BEV without hidden displacement and retains its VAT/administrative fees', () => {
    const quote = result({ powertrain: 'bev', displacementCc: '' });
    expect(quote.lines.find((line) => line.id === 'duty')!.amount).toBe('0');
    expect(quote.lines.find((line) => line.id === 'vat')!.amount).toBe('1877440');
    expect(quote.lines.find((line) => line.id === 'recycling')!.amount).toBe('0');
    expect(quote.lines.find((line) => line.id === 'registration')!.amount).toBe('1081250');
  });

  it('distinguishes EREV from ordinary hybrid and retains EREV engine excise', () => {
    expect(amount('duty', { powertrain: 'hev' })).toBe('1756207');
    expect(amount('duty', { powertrain: 'erev', displacementCc: '3500' })).toBe('0');
    expect(amount('excise', { powertrain: 'erev', displacementCc: '3500' })).toBe('350000');
    expect(amount('registration', { powertrain: 'erev' })).toBe('1081250');
    expect(amount('recycling', { powertrain: 'erev' })).toBe('0');
  });

  it('ignores freight principal and is stable for equivalent currency facts without mutation', () => {
    const input = Object.freeze({ ...SAMPLE, freight: '1000', insurance: '50' });
    expect(calculateKzReference({ input, ageMonths: 60, ageYears: 5 })).toEqual(result());
    expect(
      result({ currency: 'CNY', price: '125000', transactionRate: '93.6643914' }).lines,
    ).toEqual(result().lines);
    expect(input.freight).toBe('1000');
  });
});
