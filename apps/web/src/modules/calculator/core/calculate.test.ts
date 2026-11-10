import { describe, expect, it } from 'vitest';
import { calculateImportEstimate } from './calculate';
import type { CalculationInput, CountryCode } from './types';

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

const GE_SAMPLE: CalculationInput = {
  ...RU_SAMPLE,
  country: 'GE',
  price: '',
  powerHp: '',
  transactionRate: '',
  euroRate: '',
};

function calculate(changes: Partial<CalculationInput> = {}) {
  return calculateImportEstimate({ ...RU_SAMPLE, ...changes });
}

function amount(input: CalculationInput, id: string) {
  return calculateImportEstimate(input).lines.find((line) => line.id === id)?.amount;
}

describe('reference snapshots and result contract', () => {
  it.each(['manufactureDate', 'customsDate'] as const)(
    'a non-string %s from a direct caller returns diagnostics instead of throwing',
    (field) => {
      for (const value of [2026, {}, [], true]) {
        const result = calculateImportEstimate({
          ...RU_SAMPLE,
          [field]: value,
        } as unknown as CalculationInput);
        expect(result.status).toBe('invalid');
        expect(result.total).toBeNull();
        expect(result.fieldErrors[field]).toBe(
          field === 'manufactureDate' ? 'invalid_month' : 'invalid_date',
        );
      }
    },
  );

  it('reproduces the documented RU sample without adding the vehicle or freight principal', () => {
    const input = { ...RU_SAMPLE, freight: '1200', insurance: '100' };
    const result = calculateImportEstimate(input);
    expect(result).toMatchObject({
      status: 'reference',
      quality: 'reference_only',
      reason: 'reference_preview_only',
      currency: 'RUB',
      total: '926952',
      ruleVersion: 'ru-personal-reference-2026.10.23-v2',
    });
    expect(result.lines.map(({ id, amount }) => [id, amount])).toEqual([
      ['duty', '908211'],
      ['customsFee', '13541'],
      ['recycling', '5200'],
    ]);
    expect(result.excludedCosts).toEqual(
      expect.arrayContaining(['vehicle_price', 'freight', 'insurance']),
    );
    expect(input).toEqual({ ...RU_SAMPLE, freight: '1200', insurance: '100' });
  });

  it('reproduces GE without requiring a vehicle price or exchange rate', () => {
    expect(calculateImportEstimate(GE_SAMPLE)).toMatchObject({
      status: 'reference',
      currency: 'GEL',
      total: '3605',
      ruleVersion: 'ge-personal-reference-2026.10.22-v1',
      missingFields: [],
      fieldErrors: {},
    });
  });

  it('is deterministic and does not mutate the input', () => {
    const input = Object.freeze({ ...RU_SAMPLE });
    expect(calculateImportEstimate(input)).toEqual(calculateImportEstimate(input));
    expect(input).toEqual(RU_SAMPLE);
  });

  it('uses the explicit transaction rate for CNY rather than a currency-specific hidden rate', () => {
    const usd = calculate();
    const cny = calculate({ currency: 'CNY', price: '250000', transactionRate: '8.1969182' });
    expect(cny.lines).toEqual(usd.lines);
    expect(cny.total).toBe(usd.total);
  });
});

describe('RU reference boundaries', () => {
  it('changes duty and recycling at 36 months and duty again at 60 months', () => {
    expect(calculate({ manufactureDate: '2023-02' }).lines.map((line) => line.amount)).toEqual([
      '1040658',
      '13541',
      '3400',
    ]);
    expect(calculate({ manufactureDate: '2023-01' }).lines.map((line) => line.amount)).toEqual([
      '510869',
      '13541',
      '5200',
    ]);
    expect(calculate({ manufactureDate: '2021-02' }).lines[0].amount).toBe('510869');
    expect(calculate({ manufactureDate: '2021-01' }).lines[0].amount).toBe('908211');
  });

  it('uses the percentage when it exceeds the per-cc minimum for a new car', () => {
    const result = calculate({
      manufactureDate: '2025-01',
      price: '100000',
      transactionRate: '1',
      euroRate: '1',
      displacementCc: '1000',
    });
    expect(result.lines[0].amount).toBe('48000');
  });

  it('includes the upper customs fee threshold and moves only above it', () => {
    expect(calculate({ price: '200000', transactionRate: '1' }).lines[1].amount).toBe('1231');
    expect(calculate({ price: '200000.01', transactionRate: '1' }).lines[1].amount).toBe('2462');
  });

  it('accepts the exact 3000cc and 160hp reference scope limit', () => {
    expect(calculate({ displacementCc: '3000', powerHp: '160' }).status).toBe('reference');
  });

  it.each([
    [{ displacementCc: '3000.01' }, '3956200'],
    [{ powerHp: '160.01' }, '1492800'],
  ] as const)('uses the complete recycling matrix for %s', (changes, recycling) => {
    const result = calculate(changes);
    expect(result.status).toBe('reference');
    expect(result.lines.find((line) => line.id === 'recycling')?.amount).toBe(recycling);
    expect(result.assumptions).not.toContain('ru_personal_relief_assumed');
  });
});

describe('GE reference boundaries', () => {
  it('rounds displacement upwards to the next 100cc', () => {
    expect(amount({ ...GE_SAMPLE, displacementCc: '2000' }, 'excise')).toBe('3000');
    expect(amount({ ...GE_SAMPLE, displacementCc: '2001' }, 'excise')).toBe('3150');
  });

  it.each(['hev', 'phev', 'erev'] as const)(
    'applies the left-steering discount to the %s preview through age six',
    (powertrain) => {
      expect(
        calculateImportEstimate({ ...GE_SAMPLE, powertrain, manufactureDate: '2020-12' }).total,
      ).toBe('1810');
      expect(
        calculateImportEstimate({ ...GE_SAMPLE, powertrain, manufactureDate: '2019-12' }).total,
      ).toBe('9615');
    },
  );

  it('does not stack the left-steering hybrid discount onto a right-steering vehicle', () => {
    expect(
      calculateImportEstimate({
        ...GE_SAMPLE,
        powertrain: 'hev',
        steering: 'right',
        manufactureDate: '2020-12',
      }).total,
    ).toBe('9610');
  });

  it('retains fixed fees for BEV and does not require displacement or power', () => {
    expect(
      calculateImportEstimate({
        ...GE_SAMPLE,
        powertrain: 'bev',
        displacementCc: '',
        steering: 'right',
      }),
    ).toMatchObject({ status: 'reference', total: '480', missingFields: [] });
  });

  it('keeps the fixed service breakdown in the policy and ignores hidden input from another country', () => {
    const result = calculateImportEstimate({
      ...GE_SAMPLE,
      price: '-50',
      transactionRate: 'NaN',
      euroRate: '0',
      powerHp: 'bad',
      freight: '-1',
    });
    expect(result).toMatchObject({ status: 'reference', total: '3605', fieldErrors: {} });
    expect(result.lines.find((line) => line.id === 'service')).toEqual({
      id: 'service',
      amount: '480',
      formula: '150 + 200 + 30 + 50 + 50',
      method: { key: 'GE.service', params: {} },
    });
    expect(
      calculateImportEstimate({ ...GE_SAMPLE, powertrain: 'bev', displacementCc: 'not applicable' })
        .total,
    ).toBe('480');
  });
});

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

  it('allows explicit zero freight/insurance and surrounding whitespace in decimal inputs', () => {
    expect(
      calculate({
        price: ' 25000 ',
        displacementCc: ' 1998 ',
        powerHp: ' 150 ',
        freight: '0',
        insurance: '0',
      }).total,
    ).toBe('926952');
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
      'reference',
    );
    expect(calculate({ manufactureDate: '2021-13' }).fieldErrors.manufactureDate).toBe(
      'invalid_month',
    );
  });
});

describe('reference coverage and unsupported combinations', () => {
  it.each(['KZ', 'UZ', 'AM', 'KG', 'AL'] as CountryCode[])(
    'dispatches %s to its own reference policy',
    (country) => {
      const result = calculate({ country });
      expect(result.status).toBe('reference');
      expect(result.total).not.toBeNull();
      expect(result.ruleVersion).toContain(`${country.toLowerCase()}-`);
    },
  );

  it.each(['RU', 'GE'] as CountryCode[])(
    'does not reuse personal rules for %s companies',
    (country) => {
      expect(calculate({ country, importerType: 'company' })).toMatchObject({
        status: 'needs_review',
        reason: 'company_rules_pending',
        total: null,
        lines: [],
      });
    },
  );

  it.each([
    ['bev', '2548125'],
    ['erev', '926952'],
  ] as const)('provides RU %s reference amounts', (powertrain, total) => {
    expect(calculate({ powertrain })).toMatchObject({ status: 'reference', total });
  });

  it.each(['2025-12-31', '2027-01-01'])(
    'does not silently extend the rule snapshot to %s',
    (customsDate) => {
      expect(calculate({ customsDate })).toMatchObject({
        status: 'needs_review',
        reason: 'rule_date_outside_reference',
        total: null,
      });
    },
  );
});
