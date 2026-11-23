import { describe, expect, it } from 'vitest';
import { calculateImportEstimate } from './calculate';
import type { CalculationInput } from './types';

const RU_SAMPLE: CalculationInput = {
  country: 'RU',
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
  transactionRate: '81.969182',
  euroRate: '94.7',
};

function calculate(changes: Partial<CalculationInput> = {}) {
  return calculateImportEstimate({ ...RU_SAMPLE, ...changes });
}

describe('input validation and incomplete states', () => {
  it('keeps missing inputs distinct from zero', () => {
    expect(
      calculate({
        price: '',
        displacementCc: '',
        powerHp: '',
        manufactureDate: '',
        transactionRate: '',
        euroRate: '',
      }),
    ).toMatchObject({ status: 'incomplete', total: null, lines: [], fieldErrors: {} });
    expect(calculate({ price: '' }).missingFields).toContain('price');
    expect(calculate({ price: '0' })).toMatchObject({
      status: 'invalid',
      total: null,
      fieldErrors: { price: 'must_be_positive' },
    });
  });

  it.each(['NaN', 'Infinity', '-1', '1e5', '1,000', '.5', '12x', '1000000000000000000'])(
    'rejects invalid decimal input %s',
    (price) => {
      expect(calculate({ price })).toMatchObject({
        status: 'invalid',
        total: null,
        fieldErrors: { price: 'invalid_decimal' },
      });
    },
  );

  it.each(['price', 'displacementCc', 'powerHp', 'transactionRate', 'euroRate'] as const)(
    'rejects a zero %s',
    (field) => {
      expect(calculate({ [field]: '0' }).fieldErrors[field]).toBe('must_be_positive');
    },
  );

  it('normalizes decimal input without mutating caller facts', () => {
    const input = Object.freeze({ ...RU_SAMPLE, price: ' 25000 ', displacementCc: ' 1998 ', freight: '0', insurance: '0' });
    expect(calculateImportEstimate(input).lines).toEqual(calculate().lines);
    expect(input.price).toBe(' 25000 ');
  });

  it.each(['2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '0000-01-01', '2026-1-01'])(
    'rejects the invalid calendar date %s',
    (customsDate) => {
      expect(calculate({ customsDate }).fieldErrors.customsDate).toBe('invalid_date');
    },
  );

  it('accepts a leap date as a calendar date but still enforces the 2026 reference window', () => {
    expect(calculate({ customsDate: '2028-02-29' })).toMatchObject({
      status: 'needs_review',
      reason: 'rule_date_outside_reference',
      fieldErrors: {},
      total: null,
    });
    expect(calculate({ customsDate: '2100-02-29' }).fieldErrors.customsDate).toBe('invalid_date');
  });

  it('rejects future manufacturing months without inventing day precision', () => {
    expect(calculate({ manufactureDate: '2026-02' }).fieldErrors.manufactureDate).toBe(
      'manufacture_after_customs',
    );
    expect(calculate({ manufactureDate: '2026-01', customsDate: '2026-01-01' }).status).toBe(
      'needs_review',
    );
    expect(calculate({ manufactureDate: '2021-13' }).fieldErrors.manufactureDate).toBe(
      'invalid_month',
    );
  });
});


it.each(['manufactureDate', 'customsDate'] as const)('rejects a non-string %s directly', field => {
  for (const value of [2026, {}, [], true]) {
    expect(calculate({ [field]: value } as unknown as Partial<CalculationInput>)).toMatchObject({ status: 'invalid', total: null });
  }
});
