import { describe, expect, it } from 'vitest';
import { Amount } from '../../core/decimal';
import type { CalculationInput, ReferencePolicyResult } from '../../core/types';
import { calculateKgReference } from './reference';
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
  customsDate: '2026-01-14',
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
  it('corrects the report cases for private and commercial imports', () => {
    const changes = { price: '8750', transactionRate: '100', euroRate: '100', freight: '', customsDate: '2026-11-23' };
    const run = (manufactureDate: string, ageMonths: number, importerType: CalculationInput['importerType']) =>
      calculateKgReference({ input: { ...INPUT, ...changes, manufactureDate, importerType }, ageMonths, ageYears: Math.floor(ageMonths / 12) });
    expect(amount(run('2021-01', 70, 'individual'), 'duty')).toBe('959040.00');
    for (const [date, months] of [['2022-01', 58], ['2023-01', 46]] as const) {
      const result = run(date, months, 'company');
      expect(result.lines.map(({ amount }) => amount)).toEqual(['175000.00', '0.00', '126000.00', '3500.00']);
      expect(total(result)).toBe('304500.00');
      expect(result.additionalCosts).toEqual([]);
    }
  });
  it('does not increase personal unified duty when separate freight is entered', () => {
    const changes = { price: '10000', displacementCc: '1000', transactionRate: '100', euroRate: '100' };
    expect(amount(quote({ ...changes, freight: '' }, 2), 'duty')).toBe('480000.00');
    expect(amount(quote({ ...changes, freight: '1000' }, 2), 'duty')).toBe('480000.00');
  });
  it.each([['100000', '500.00'], ['62500001', '250000.00']])('bounds the commercial fee for KGS %s', (price, fee) => {
    expect(amount(quote({ price, transactionRate: '1', freight: '', importerType: 'company' }), 'customsFee')).toBe(fee);
  });

  it.each([
    [3, '2500.00'],
    [4, '1500.00'],
    [5, '1500.00'],
    [6, '3000.00'],
  ])('uses personal tariff the day before anniversary %i', (age, expected) => {
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

  it('applies 15% before the third anniversary, then 20% when it beats the cc minimum', () => {
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
      expect(amount(quote({ ...changes, importerType: 'individual' }, 6), 'vat')).toBe('1380.00');
    },
  );

  it.each(['hev', 'phev', 'diesel'] as const)(
    'preserves the personal tariff for %s rather than inferring EV status',
    (powertrain) => {
      expect(amount(quote({ powertrain }), 'duty')).toBe('543613.84');
    },
  );

  it('retains separately invoiced freight and insurance for commercial imports', () => {
    const result = quote({ price: '100', freight: '10', insurance: '5', transactionRate: '3',
      euroRate: '2', powertrain: 'bev', displacementCc: '', importerType: 'company' });
    expect(amount(result, 'duty')).toBe('51.76');
    expect(amount(result, 'customsFee')).toBe('500.00');
  });

  it('changes commercial age band on the third anniversary; private unified duty changes the next day', () => {
    const changes = { price: '10000', transactionRate: '1', euroRate: '1', freight: '', displacementCc: '1000', manufactureDate: '2023-01', customsDate: '2026-01-15' };
    expect(amount(quote({ ...changes, importerType: 'company' }, 3), 'duty')).toBe('2000.00');
    expect(amount(quote(changes, 3), 'duty')).toBe('4800.00');
    expect(amount(quote({ ...changes, customsDate: '2026-01-16' }, 3), 'duty')).toBe('1500.00');
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
