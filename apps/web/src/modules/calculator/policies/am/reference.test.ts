import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import type { CalculationInput } from '../../core/types';
import { AM_REFERENCE_SOURCE, AM_REFERENCE_VERSION, calculateAmReference } from './reference';
import { amMethodMessages } from './method-messages';

const INPUT: CalculationInput = {
  country: 'AM',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '9000',
  currency: 'USD',
  displacementCc: '1998',
  powerHp: '',
  manufactureDate: '2021-01',
  customsDate: '2026-10-23',
  freight: '1100',
  insurance: '',
  steering: 'left',
  transactionRate: '366.081469',
  euroRate: '422.7',
};
function quote(changes: Partial<CalculationInput> = {}, ageYears = 5) {
  return calculateAmReference({
    input: { ...INPUT, ...changes },
    ageYears,
    ageMonths: ageYears * 12,
  });
}
function amount(changes: Partial<CalculationInput>, ageYears: number, id: string) {
  return quote(changes, ageYears).lines.find((line) => line.id === id)?.amount;
}

describe('AM independently implemented reference snapshot', () => {
  it('matches the saved AMD sample including customs-value and duty rounding before VAT', () => {
    const result = quote();
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '739485'],
      ['excise', '0'],
      ['vat', '887382'],
      ['environmental', '0'],
    ]);
    expect(result.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toFixed(0)).toBe(
      '1626867',
    );
    expect(result.additionalCosts).toEqual([]);
    expect(AM_REFERENCE_VERSION).toBe('am-personal-reference-2026.10.22-v1');
    expect(AM_REFERENCE_SOURCE).toBe('https://www.kmotors.shop/en/calculator/armenia');
  });

  it.each([
    [2, '1500'],
    [3, '2000'],
    [6, '2000'],
    [7, '4396'],
  ])('keeps AM calendar-year CCT boundaries at age %i', (age, expected) => {
    expect(
      amount({ price: '10000', freight: '', transactionRate: '1', euroRate: '1' }, age, 'duty'),
    ).toBe(expected);
  });

  it.each([
    ['petrol', '2800', '1500'],
    ['petrol', '2801', '1250'],
    ['diesel', '2801', '1500'],
    ['hev', '2801', '1500'],
    ['phev', '2801', '1500'],
    ['erev', '2801', '1500'],
  ] as const)(
    'applies the new-car large-petrol reduction only to %s at %s cc',
    (powertrain, displacementCc, expected) => {
      expect(
        amount(
          {
            powertrain,
            displacementCc,
            price: '10000',
            freight: '',
            transactionRate: '1',
            euroRate: '1',
          },
          2,
          'duty',
        ),
      ).toBe(expected);
    },
  );

  it.each([
    ['petrol', '1000', '360', '1400'],
    ['petrol', '1001', '400', '1502'],
    ['petrol', '1500', '600', '2250'],
    ['petrol', '1501', '540', '2402'],
    ['petrol', '1800', '648', '2880'],
    ['petrol', '1801', '792', '3962'],
    ['petrol', '3000', '1320', '6600'],
    ['petrol', '3001', '2401', '9603'],
    ['diesel', '1500', '480', '2250'],
    ['diesel', '1501', '600', '3302'],
    ['diesel', '2500', '1000', '5500'],
    ['diesel', '2501', '2001', '8003'],
  ] as const)(
    'uses %s tariff bands inclusively at %s cc',
    (powertrain, displacementCc, middle, old) => {
      const changes = {
        powertrain,
        displacementCc,
        price: '100',
        freight: '',
        transactionRate: '1',
        euroRate: '1',
      };
      expect(amount(changes, 6, 'duty')).toBe(middle);
      expect(amount(changes, 7, 'duty')).toBe(old);
    },
  );

  it.each([
    [5, '0'],
    [6, '200'],
    [10, '200'],
    [11, '1000'],
    [15, '1000'],
    [16, '2000'],
  ])('uses environmental tax age band %i independently from duty', (age, expected) => {
    expect(
      amount(
        { price: '10000', freight: '', transactionRate: '1', euroRate: '1' },
        age,
        'environmental',
      ),
    ).toBe(expected);
  });

  it.each(['hev', 'phev', 'erev'] as const)(
    'exempts %s from environmental tax without granting BEV duty or VAT exemption',
    (powertrain) => {
      const result = quote(
        { powertrain, price: '10000', freight: '', transactionRate: '1', euroRate: '1' },
        16,
      );
      expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
        ['duty', '4396'],
        ['excise', '0'],
        ['vat', '2879'],
        ['environmental', '0'],
      ]);
    },
  );

  it('accepts BEV without cc and represents only the explicit 2026 quota/VAT assumption', () => {
    const result = quote({ powertrain: 'bev', displacementCc: '' }, 6);
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '0'],
      ['excise', '0'],
      ['vat', '0'],
      ['environmental', '0'],
    ]);
    expect(result.additionalCosts).toEqual([]);
  });

  it('taxes the supplied price, freight and insurance after rounding customs value, then rounds duty before VAT', () => {
    const result = quote(
      {
        price: '100',
        freight: '10',
        insurance: '5',
        transactionRate: '1.004',
        euroRate: '1',
        displacementCc: '1000',
      },
      2,
    );
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '17'],
      ['excise', '0'],
      ['vat', '26'],
      ['environmental', '0'],
    ]);
  });

  it('does not mutate source facts and does not use manufacture-month age', () => {
    const input = { ...INPUT };
    const before = { ...input };
    expect(calculateAmReference({ input, ageYears: 5, ageMonths: 60 })).toEqual(
      calculateAmReference({ input, ageYears: 5, ageMonths: 71 }),
    );
    expect(input).toEqual(before);
  });

  it('exposes the actual middle-age comparison and rounded-duty VAT base', () => {
    const result = quote({ price: '10000', freight: '', transactionRate: '1', euroRate: '1' }, 6);
    expect(result.lines[0].method).toEqual({
      key: 'AM.dutyMiddle',
      params: {
        age: 6,
        value: '10000',
        cc: '1998',
        rate: 20,
        perCc: '0.44',
        euroRate: '1',
        percentage: '2000',
        minimum: '879.12',
        selected: '2000',
      },
    });
    expect(result.lines.find((line) => line.id === 'vat')?.method).toEqual({
      key: 'AM.vat',
      params: { value: '10000', duty: '2000', taxableBase: '12000', rate: 20 },
    });
  });

  it('separates the BEV assumption, hybrid environmental relief and young-car environmental zero', () => {
    expect(quote({ powertrain: 'bev' }).lines[0].method?.key).toBe('AM.dutyElectric');
    expect(quote({ powertrain: 'bev' }).lines.find((line) => line.id === 'vat')?.method?.key).toBe(
      'AM.vatElectric',
    );
    expect(
      quote({ powertrain: 'hev' }, 16).lines.find((line) => line.id === 'environmental')?.method
        ?.key,
    ).toBe('AM.environmentalHybrid');
    expect(quote({}, 5).lines.find((line) => line.id === 'environmental')?.method?.key).toBe(
      'AM.environmentalYoung',
    );
    expect(
      quote({}, 16).lines.find((line) => line.id === 'environmental')?.method?.params.rate,
    ).toBe('20');
  });

  it('provides translated explanations and every placeholder for all policy branches', () => {
    const results = [
      quote({}, 2),
      quote({ displacementCc: '2801' }, 2),
      quote({}, 3),
      quote({}, 7),
      quote({ powertrain: 'bev' }),
      quote({ powertrain: 'hev' }, 16),
      ...[5, 6, 11, 16].map((age) => quote({}, age)),
    ];
    for (const result of results)
      for (const line of result.lines) {
        expect(line.method).toBeDefined();
        const key = line.method!.key.replace('AM.', '') as keyof typeof amMethodMessages.zh;
        const placeholders = (text: string) =>
          [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
        const expected = placeholders(amMethodMessages.zh[key]);
        for (const locale of ['zh', 'en', 'ru'] as const) {
          expect(amMethodMessages[locale][key]).toBeTruthy();
          expect(placeholders(amMethodMessages[locale][key])).toEqual(expected);
        }
        for (const parameter of expected) expect(line.method!.params).toHaveProperty(parameter);
      }
  });
});
