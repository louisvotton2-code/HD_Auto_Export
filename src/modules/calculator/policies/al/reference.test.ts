import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import type { CalculationInput } from '../../core/types';
import { AL_REFERENCE_SOURCE, AL_REFERENCE_VERSION, calculateAlReference } from './reference';
import { alMethodMessages } from './method-messages';

const INPUT: CalculationInput = {
  country: 'AL',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '9000',
  currency: 'USD',
  displacementCc: '1998',
  powerHp: '',
  manufactureDate: '',
  customsDate: '2026-10-23',
  freight: '1100',
  insurance: '',
  steering: 'left',
  transactionRate: '80.7859',
  euroRate: '',
};
function quote(changes: Partial<CalculationInput> = {}) {
  return calculateAlReference({ input: { ...INPUT, ...changes }, ageYears: 0, ageMonths: 0 });
}
function amount(changes: Partial<CalculationInput>, id: string) {
  return quote(changes).lines.find((line) => line.id === id)?.amount;
}

describe('AL independently implemented reference snapshot', () => {
  it('matches the saved personal sample without adding freight principal or inventing age dependence', () => {
    const result = quote();
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '0'],
      ['excise', '0'],
      ['vat', '163188'],
      ['registration', '8500'],
      ['luxuryOnce', '0'],
    ]);
    expect(result.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toFixed(0)).toBe(
      '171688',
    );
    expect(result.additionalCosts).toEqual([]);
    expect(AL_REFERENCE_VERSION).toBe('al-personal-reference-2026.10.22-v1');
    expect(AL_REFERENCE_SOURCE).toBe('https://www.kmotors.shop/en/calculator/albania');
  });

  it.each([
    ['1400', '32500'],
    ['1401', '50000'],
    ['1900', '50000'],
    ['1901', '81200'],
    ['2500', '81200'],
    ['2501', '100000'],
    ['3000', '100000'],
    ['3001', '125000'],
    ['4500', '125000'],
    ['4501', '200000'],
  ])('keeps minimum customs values inclusive at %s cc', (displacementCc, vat) => {
    expect(amount({ displacementCc, price: '100', freight: '', transactionRate: '1' }, 'vat')).toBe(
      vat,
    );
  });

  it('uses the declared customs value when greater than the minimum', () => {
    expect(
      amount({ displacementCc: '1400', price: '200000', freight: '', transactionRate: '1' }, 'vat'),
    ).toBe('40000');
  });

  it.each(['hev', 'phev', 'erev', 'diesel'] as const)(
    'applies the combustion minimum to %s',
    (powertrain) => {
      expect(amount({ powertrain, price: '100', freight: '', transactionRate: '1' }, 'vat')).toBe(
        '81200',
      );
    },
  );

  it('accepts BEV without cc, dates or EUR rate and does not apply a combustion minimum', () => {
    const result = quote({
      powertrain: 'bev',
      displacementCc: '',
      manufactureDate: '',
      euroRate: '',
      price: '100',
      freight: '',
      transactionRate: '1',
    });
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '0'],
      ['excise', '0'],
      ['vat', '20'],
      ['registration', '8500'],
      ['luxuryOnce', '0'],
    ]);
    expect(result.additionalCosts).toEqual([]);
  });

  it.each([
    ['2999', '4999999', '0'],
    ['3000', '4999999', '70000'],
    ['2999', '5000000', '70000'],
    ['3000', '5000000', '70000'],
  ])('applies luxury OR thresholds at cc %s and ALL %s', (displacementCc, price, once) => {
    const result = quote({ displacementCc, price, freight: '', transactionRate: '1' });
    expect(result.lines.find((line) => line.id === 'luxuryOnce')?.amount).toBe(once);
    expect(result.additionalCosts).toMatchObject(
      once === '0'
        ? []
        : [{ id: 'annualLuxury', amount: '21000', formula: '21000', kind: 'annual' }],
    );
  });

  it('applies luxury to a high-value BEV, while ignoring its hidden combustion cc', () => {
    expect(
      amount(
        {
          powertrain: 'bev',
          displacementCc: '4000',
          price: '4999999',
          freight: '',
          transactionRate: '1',
        },
        'luxuryOnce',
      ),
    ).toBe('0');
    const result = quote({
      powertrain: 'bev',
      displacementCc: '',
      price: '5000000',
      freight: '',
      transactionRate: '1',
    });
    expect(result.lines.find((line) => line.id === 'luxuryOnce')?.amount).toBe('70000');
    expect(result.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toFixed(0)).toBe(
      '1078500',
    );
    expect(result.additionalCosts[0]).toMatchObject({
      id: 'annualLuxury',
      amount: '21000',
      kind: 'annual',
    });
  });

  it('includes explicitly supplied freight and insurance in rounded customs value', () => {
    const changes = {
      powertrain: 'bev' as const,
      displacementCc: '',
      price: '100',
      freight: '10',
      insurance: '5',
      transactionRate: '1.005',
    };
    expect(amount(changes, 'vat')).toBe('23');
  });

  it('does not mutate facts and ignores calendar-age arguments', () => {
    const input = { ...INPUT };
    const before = { ...input };
    expect(calculateAlReference({ input, ageYears: 0, ageMonths: 0 })).toEqual(
      calculateAlReference({ input, ageYears: 50, ageMonths: 600 }),
    );
    expect(input).toEqual(before);
  });

  it('explains declared value versus the displacement minimum and keeps the chosen base', () => {
    const result = quote({ price: '100', freight: '', transactionRate: '1' });
    expect(result.lines.find((line) => line.id === 'vat')?.method).toEqual({
      key: 'AL.vatMinimum',
      params: { declared: '100', minimum: '406000', taxableBase: '406000', cc: '1998', rate: 20 },
    });
    expect(
      quote({ price: '500000', freight: '', transactionRate: '1' }).lines.find(
        (line) => line.id === 'vat',
      )?.method?.key,
    ).toBe('AL.vatDeclared');
    expect(quote({ powertrain: 'bev' }).lines.find((line) => line.id === 'vat')?.method?.key).toBe(
      'AL.vatElectric',
    );
  });

  it('reports the actual luxury trigger and explains the excluded recurring expense', () => {
    expect(
      quote({ displacementCc: '3000' }).lines.find((line) => line.id === 'luxuryOnce')?.method?.key,
    ).toBe('AL.luxuryDisplacement');
    const result = quote({
      powertrain: 'bev',
      price: '5000000',
      freight: '',
      transactionRate: '1',
    });
    expect(result.lines.find((line) => line.id === 'luxuryOnce')?.method?.key).toBe(
      'AL.luxuryValue',
    );
    expect(result.additionalCosts[0].method).toEqual({
      key: 'AL.annualLuxury',
      params: { fee: 21000 },
    });
  });

  it('provides translated explanations and every placeholder for all policy branches', () => {
    const results = [
      quote(),
      quote({ powertrain: 'bev' }),
      quote({ price: '100', freight: '', transactionRate: '1' }),
      quote({ displacementCc: '3000' }),
      quote({ powertrain: 'bev', price: '5000000', freight: '', transactionRate: '1' }),
    ];
    for (const result of results)
      for (const line of [...result.lines, ...result.additionalCosts]) {
        expect(line.method).toBeDefined();
        const key = line.method!.key.replace('AL.', '') as keyof typeof alMethodMessages.zh;
        const placeholders = (text: string) =>
          [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
        const expected = placeholders(alMethodMessages.zh[key]);
        for (const locale of ['zh', 'en', 'ru'] as const) {
          expect(alMethodMessages[locale][key]).toBeTruthy();
          expect(placeholders(alMethodMessages[locale][key])).toEqual(expected);
        }
        for (const parameter of expected) expect(line.method!.params).toHaveProperty(parameter);
      }
  });
});
