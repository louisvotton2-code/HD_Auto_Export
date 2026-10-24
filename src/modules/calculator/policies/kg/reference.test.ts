import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import type { CalculationInput, ReferencePolicyResult } from '../../core/types';
import { calculateKgReference, KG_REFERENCE_SOURCE, KG_REFERENCE_VERSION } from './reference';
import { kgMethodMessages } from './method-messages';

const INPUT: CalculationInput = {
  country: 'KG',
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
  transactionRate: '87.26067303',
  euroRate: '100.77',
};
function quote(changes: Partial<CalculationInput> = {}, ageYears = 5) {
  return calculateKgReference({
    input: { ...INPUT, ...changes },
    ageYears,
    ageMonths: ageYears * 12,
  });
}
function amount(result: ReferencePolicyResult, id: string) {
  return result.lines.find((line) => line.id === id)?.amount;
}
function total(result: ReferencePolicyResult) {
  return result.lines.reduce((sum, line) => sum.add(line.amount), new Amount(0)).toFixed(2);
}

describe('KG independently implemented reference snapshot', () => {
  it('matches the saved personal sample and keeps the first-registration estimate outside the total', () => {
    const result = quote();
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '543613.84'],
      ['excise', '0.00'],
      ['vat', '0.00'],
      ['customsFee', '3524.93'],
    ]);
    expect(total(result)).toBe('547138.77');
    expect(result.additionalCosts).toMatchObject([
      { id: 'registrationEstimate', amount: '44066.72', kind: 'one_time_estimate' },
    ]);
    expect(result.lines.some(({ id }) => id === 'registrationEstimate')).toBe(false);
    expect(KG_REFERENCE_VERSION).toBe('kg-reference-2026.10.22-v1');
    expect(KG_REFERENCE_SOURCE).toBe('https://www.kmotors.shop/en/calculator/kyrgyzstan');
  });

  it('matches the saved company sample including VAT and has no personal registration estimate', () => {
    const result = quote({ importerType: 'company' });
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '176266.88'],
      ['excise', '0.00'],
      ['vat', '126911.75'],
      ['customsFee', '3524.93'],
    ]);
    expect(total(result)).toBe('306703.56');
    expect(result.additionalCosts).toEqual([]);
  });

  it.each([
    [3, '2500.00'],
    [4, '1500.00'],
    [5, '1500.00'],
    [6, '3000.00'],
  ])('uses KG calendar-year personal boundaries at age %i', (age, expected) => {
    expect(
      amount(
        quote(
          {
            price: '2500',
            freight: '',
            displacementCc: '1000',
            transactionRate: '1',
            euroRate: '1',
          },
          age,
        ),
        'duty',
      ),
    ).toBe(expected);
  });

  it.each([
    ['8500', '25000.00'],
    ['8500.01', '35000.00'],
    ['16700.01', '55000.00'],
    ['42300.01', '75000.00'],
    ['84500.01', '150000.00'],
    ['169000.01', '200000.00'],
  ])('selects the six new-car minimum bands at EUR %s', (price, expected) => {
    expect(
      amount(
        quote(
          { price, freight: '', displacementCc: '10000', transactionRate: '1', euroRate: '1' },
          3,
        ),
        'duty',
      ),
    ).toBe(expected);
  });

  it.each([
    ['8500', '4590.00'],
    ['8500.01', '4080.00'],
    ['16700', '8016.00'],
    ['42300', '20304.00'],
    ['84500', '40560.00'],
    ['169000', '81120.00'],
  ])('takes the percentage when it beats the new-car cc minimum at EUR %s', (price, expected) => {
    expect(
      amount(
        quote({ price, freight: '', displacementCc: '1', transactionRate: '1', euroRate: '1' }, 3),
        'duty',
      ),
    ).toBe(expected);
  });

  it.each([
    ['1000', '1500.00', '3000.00'],
    ['1001', '1701.70', '3203.20'],
    ['1500', '2550.00', '4800.00'],
    ['1501', '3752.50', '5253.50'],
    ['1800', '4500.00', '6300.00'],
    ['1801', '4862.70', '8644.80'],
    ['2300', '6210.00', '11040.00'],
    ['2301', '6903.00', '11505.00'],
    ['3000', '9000.00', '15000.00'],
    ['3001', '10803.60', '17105.70'],
  ])('keeps personal displacement bounds inclusive at %s cc', (displacementCc, middle, old) => {
    const changes = { displacementCc, transactionRate: '1', euroRate: '1' };
    expect(amount(quote(changes, 5), 'duty')).toBe(middle);
    expect(amount(quote(changes, 6), 'duty')).toBe(old);
  });

  it.each([
    ['petrol', '1000', '360.00', '1400.00'],
    ['petrol', '1001', '400.40', '1501.50'],
    ['petrol', '1500', '600.00', '2250.00'],
    ['petrol', '1501', '540.36', '2401.60'],
    ['petrol', '1800', '648.00', '2880.00'],
    ['petrol', '1801', '792.44', '3962.20'],
    ['petrol', '3000', '1320.00', '6600.00'],
    ['petrol', '3001', '2400.80', '9603.20'],
    ['diesel', '1500', '480.00', '2250.00'],
    ['diesel', '1501', '600.40', '3302.20'],
    ['diesel', '2500', '1000.00', '5500.00'],
    ['diesel', '2501', '2000.80', '8003.20'],
  ] as const)(
    'uses company %s cc %s tariff minimum and old rate',
    (powertrain, displacementCc, middle, old) => {
      const changes = {
        importerType: 'company' as const,
        powertrain,
        displacementCc,
        price: '100',
        freight: '',
        transactionRate: '1',
        euroRate: '1',
      };
      expect(amount(quote(changes, 7), 'duty')).toBe(middle);
      expect(amount(quote(changes, 8), 'duty')).toBe(old);
    },
  );

  it('keeps company age 3 on 15%, then applies 20% at age 4 when it beats the cc minimum', () => {
    const changes = {
      importerType: 'company' as const,
      price: '10000',
      freight: '',
      transactionRate: '1',
      euroRate: '1',
    };
    expect(amount(quote(changes, 3), 'duty')).toBe('1500.00');
    expect(amount(quote(changes, 4), 'duty')).toBe('2000.00');
    expect(amount(quote(changes, 4), 'vat')).toBe('1440.00');
  });

  it.each(['bev', 'erev'] as const)(
    'accepts empty displacement for %s and distinguishes company VAT at age 5/6',
    (powertrain) => {
      const changes = {
        importerType: 'company' as const,
        powertrain,
        displacementCc: '',
        price: '10000',
        freight: '',
        transactionRate: '1',
        euroRate: '1',
      };
      expect(amount(quote(changes, 5), 'duty')).toBe('1500.00');
      expect(amount(quote(changes, 5), 'vat')).toBe('0.00');
      expect(amount(quote(changes, 6), 'vat')).toBe('1380.00');
      expect(amount(quote({ ...changes, importerType: 'individual' }, 6), 'vat')).toBe('0.00');
    },
  );

  it.each(['hev', 'phev', 'diesel'] as const)(
    'preserves the personal tariff for %s rather than inferring EV status',
    (powertrain) => {
      expect(amount(quote({ powertrain }), 'duty')).toBe('543613.84');
    },
  );

  it('includes supplied insurance and freight in the EUR customs value and rounds EUR before KGS conversion', () => {
    const result = quote({
      price: '100',
      freight: '10',
      insurance: '5',
      transactionRate: '3',
      euroRate: '2',
      powertrain: 'bev',
      displacementCc: '',
    });
    expect(amount(result, 'duty')).toBe('51.76');
    expect(amount(result, 'customsFee')).toBe('1.38');
    expect(result.additionalCosts[0].amount).toBe('17.26');
  });

  it('does not mutate the caller facts or depend on the current month', () => {
    const input = { ...INPUT };
    const before = { ...input };
    const a = calculateKgReference({ input, ageYears: 5, ageMonths: 60 });
    const b = calculateKgReference({ input, ageYears: 5, ageMonths: 71 });
    expect(a).toEqual(b);
    expect(input).toEqual(before);
  });

  it('explains both personal minimum comparison operands and the EUR-first rounding stage', () => {
    const result = quote(
      { price: '2500', freight: '', displacementCc: '1000', transactionRate: '1', euroRate: '2' },
      3,
    );
    expect(result.lines[0].method).toEqual({
      key: 'KG.dutyPersonalYoung',
      params: {
        age: 3,
        value: '1250',
        rate: '54',
        cc: '1000',
        perCc: '2.5',
        percentage: '675',
        minimum: '2500',
        selected: '2500',
        eurAmount: '2500.00',
        euroRate: '2',
      },
    });
    expect(result.additionalCosts[0].method).toMatchObject({
      key: 'KG.registrationEstimate',
      params: { value: '1250', rate: 5, eurAmount: '62.50', euroRate: '2' },
    });
  });

  it('explains company VAT from the rounded EUR duty and distinguishes the exemption scenarios', () => {
    const changes = {
      price: '100',
      freight: '10',
      insurance: '5',
      transactionRate: '3',
      euroRate: '2',
      powertrain: 'bev' as const,
      displacementCc: '',
    };
    expect(quote(changes).lines.find((line) => line.id === 'vat')?.method?.key).toBe(
      'KG.vatPersonal',
    );
    expect(
      quote({ ...changes, importerType: 'company' }, 5).lines.find((line) => line.id === 'vat')
        ?.method?.key,
    ).toBe('KG.vatElectricExempt');
    expect(
      quote({ ...changes, importerType: 'company' }, 6).lines.find((line) => line.id === 'vat')
        ?.method,
    ).toEqual({
      key: 'KG.vat',
      params: {
        age: 6,
        value: '172.5',
        duty: '25.88',
        taxableBase: '198.38',
        rate: 12,
        eurAmount: '23.81',
        euroRate: '2',
      },
    });
  });

  it('provides translated explanations and every placeholder for all policy branches', () => {
    const results = [
      quote({}, 3),
      quote({}, 5),
      quote({}, 6),
      quote({ powertrain: 'bev' }),
      ...[3, 4, 8].map((age) => quote({ importerType: 'company' }, age)),
      ...[5, 6].map((age) => quote({ importerType: 'company', powertrain: 'bev' }, age)),
    ];
    for (const result of results)
      for (const line of [...result.lines, ...result.additionalCosts]) {
        expect(line.method).toBeDefined();
        const key = line.method!.key.replace('KG.', '') as keyof typeof kgMethodMessages.zh;
        const placeholders = (text: string) =>
          [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
        const expected = placeholders(kgMethodMessages.zh[key]);
        for (const locale of ['zh', 'en', 'ru'] as const) {
          expect(kgMethodMessages[locale][key]).toBeTruthy();
          expect(placeholders(kgMethodMessages[locale][key])).toEqual(expected);
        }
        for (const parameter of expected) expect(line.method!.params).toHaveProperty(parameter);
      }
  });
});
