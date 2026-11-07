import { describe, expect, it } from 'vitest';
import { calculateImportEstimate } from './calculate';
import { Amount } from './decimal';
import type { CalculationInput, CountryCode, Powertrain } from './types';

const BASE: CalculationInput = {
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

/** Frozen independent examples recorded in docs/research, not live FX or today's age. */
const FIXTURES: Record<CountryCode, CalculationInput> = {
  RU: BASE,
  KZ: { ...BASE, country: 'KZ', transactionRate: '468.321957', euroRate: '541.1' },
  UZ: {
    ...BASE,
    country: 'UZ',
    transactionRate: '11851.454593',
    euroRate: '',
    freight: '2250',
    condition: 'used',
  },
  GE: { ...BASE, country: 'GE', price: '', transactionRate: '', euroRate: '' },
  AM: {
    ...BASE,
    country: 'AM',
    price: '9000',
    freight: '1100',
    transactionRate: '366.081469',
    euroRate: '422.7',
  },
  KG: {
    ...BASE,
    country: 'KG',
    price: '9000',
    freight: '1100',
    transactionRate: '87.26067303',
    euroRate: '100.77',
  },
  AL: {
    ...BASE,
    country: 'AL',
    price: '9000',
    freight: '1100',
    manufactureDate: '',
    transactionRate: '80.7859',
    euroRate: '',
  },
};

const COUNTRIES = Object.keys(FIXTURES) as CountryCode[];
const POWERTRAINS: Powertrain[] = ['petrol', 'diesel', 'hev', 'phev', 'erev', 'bev'];

describe('seven-country public core reference integration', () => {
  it.each([
    ['RU', 'RUB', '926952'],
    ['KZ', 'KZT', '7277481'],
    ['UZ', 'UZS', '355921427'],
    ['GE', 'GEL', '3605'],
    ['AM', 'AMD', '1626867'],
    ['KG', 'KGS', '547138.77'],
    ['AL', 'ALL', '171688'],
  ] as const)(
    'returns the frozen %s example through the same public core used by the API',
    (country, currency, total) => {
      const input = { ...FIXTURES[country] };
      const unchanged = { ...input };
      const result = calculateImportEstimate(input);
      expect(result).toMatchObject({
        status: 'reference',
        reason: 'reference_preview_only',
        quality: 'reference_only',
        currency,
        total,
        missingFields: [],
        fieldErrors: {},
      });
      expect(result.ruleVersion).toMatch(/reference-2026\.10\.\d{2}-v\d+$/);
      expect(
        result.lines
          .reduce((sum, line) => sum.add(line.amount), new Amount(0))
          .toFixed(country === 'KG' ? 2 : 0),
      ).toBe(total);
      expect(result.excludedCosts).toEqual(
        expect.arrayContaining(['vehicle_price', 'freight', 'insurance', 'china_export_costs']),
      );
      expect(input).toEqual(unchanged);
    },
  );

  it.each(
    COUNTRIES.flatMap((country) => POWERTRAINS.map((powertrain) => [country, powertrain] as const)),
  )(
    'connects the %s / %s reference branch without an artificial unsupported gate',
    (country, powertrain) => {
      const result = calculateImportEstimate({
        ...FIXTURES[country],
        powertrain,
        displacementCc:
          powertrain === 'bev' || (country === 'KG' && powertrain === 'erev') ? '' : '1998',
      });
      expect(result.status).toBe('reference');
      expect(result.total).not.toBeNull();
      expect(result.lines.length).toBeGreaterThan(0);
      expect(result.lines.every((line) => /^\d+(?:\.\d+)?$/.test(line.amount))).toBe(true);
      if (country === 'AM' && powertrain === 'bev') {
        expect(result.total).toBe('0');
        expect(result.assumptions).toContain('am_electric_relief_assumed');
      }
      if (country === 'KG' && ['bev', 'erev'].includes(powertrain)) {
        expect(result.assumptions).toContain('kg_electric_standard_duty');
      }
    },
  );

  it.each(COUNTRIES.filter((country) => country !== 'KG'))(
    'does not advertise an unimplemented company policy for %s just because the UI hides the switch',
    (country) => {
      const result = calculateImportEstimate({ ...FIXTURES[country], importerType: 'company' });
      expect(result).toMatchObject({
        status: 'needs_review',
        reason: 'company_rules_pending',
        total: null,
        lines: [],
        additionalCosts: [],
      });
    },
  );

  it('keeps KG company totals and personal first-registration estimates separate', () => {
    const personal = calculateImportEstimate(FIXTURES.KG);
    const company = calculateImportEstimate({ ...FIXTURES.KG, importerType: 'company' });
    expect(personal.total).toBe('547138.77');
    expect(personal.additionalCosts).toMatchObject([
      { id: 'registrationEstimate', amount: '44066.72', kind: 'one_time_estimate' },
    ]);
    expect(company).toMatchObject({ status: 'reference', total: '306703.56', additionalCosts: [] });
    expect(personal.lines.some(({ id }) => id === 'registrationEstimate')).toBe(false);
  });

  it('includes AL one-time luxury tax but excludes its annual charge from the import total', () => {
    const result = calculateImportEstimate({ ...FIXTURES.AL, displacementCc: '3000' });
    expect(result).toMatchObject({ status: 'reference', total: '241688' });
    expect(result.lines.find(({ id }) => id === 'luxuryOnce')?.amount).toBe('70000');
    expect(result.additionalCosts).toMatchObject([
      { id: 'annualLuxury', amount: '21000', kind: 'annual' },
    ]);
    expect(result.lines.some(({ id }) => id === 'annualLuxury')).toBe(false);
  });

  it.each(
    (['UZ', 'AM', 'KG', 'AL'] as const).flatMap((country) =>
      ['', '   '].map((empty) => [country, empty] as const),
    ),
  )('handles unknown %s transport (%s) without converting it into known zero', (country, empty) => {
    const input = {
      ...FIXTURES[country],
      freight: empty,
      insurance: empty,
    } as unknown as CalculationInput;
    expect(() => calculateImportEstimate(input)).not.toThrow();
    const result = calculateImportEstimate(input);
    expect(result.status).toBe('reference');
    expect(result.assumptions).toContain('transport_not_in_tax_base');
    expect(result.excludedCosts).toEqual(expect.arrayContaining(['freight', 'insurance']));
  });

  it.each(
    (['UZ', 'AM', 'KG', 'AL'] as const).flatMap((country) =>
      [null, undefined].map((empty) => [country, empty] as const),
    ),
  )(
    'rejects non-string %s transport (%s) without throwing or manufacturing a zero amount',
    (country, empty) => {
      const input = {
        ...FIXTURES[country],
        freight: empty,
        insurance: empty,
      } as unknown as CalculationInput;
      expect(() => calculateImportEstimate(input)).not.toThrow();
      expect(calculateImportEstimate(input)).toMatchObject({
        status: 'invalid',
        total: null,
        lines: [],
        fieldErrors: { freight: 'invalid_decimal', insurance: 'invalid_decimal' },
      });
    },
  );

  it.each(['UZ', 'AM', 'KG', 'AL'] as const)(
    'recognizes explicit zero %s transport without the unknown-transport assumption',
    (country) => {
      const result = calculateImportEstimate({
        ...FIXTURES[country],
        freight: '0',
        insurance: '0',
      });
      expect(result.status).toBe('reference');
      expect(result.assumptions).not.toContain('transport_not_in_tax_base');
    },
  );

  it('preserves the original UZ USD contract when usdRate and condition are omitted', () => {
    const legacyInput = { ...FIXTURES.UZ };
    delete legacyInput.usdRate;
    delete legacyInput.condition;
    expect(calculateImportEstimate(legacyInput)).toMatchObject({
      status: 'reference',
      total: '355921427',
    });
  });

  it('produces the same UZS tax amounts for equal USD/CNY price and transport facts', () => {
    const usd = calculateImportEstimate({
      ...FIXTURES.UZ,
      price: '10000',
      freight: '1000',
      insurance: '100',
      transactionRate: '12000',
    });
    const cny = calculateImportEstimate({
      ...FIXTURES.UZ,
      currency: 'CNY',
      price: '75000',
      freight: '7500',
      insurance: '750',
      transactionRate: '1600',
      usdRate: '12000',
    });
    expect(usd).toMatchObject({ status: 'reference', total: '248727440' });
    expect(cny).toMatchObject({ status: 'reference', total: '248727440' });
    expect(cny.lines.map(({ id, amount }) => [id, amount])).toEqual(
      usd.lines.map(({ id, amount }) => [id, amount]),
    );
  });

  it.each([undefined, '', '   '])(
    'requires UZS per USD for UZ CNY input when it is %s',
    (usdRate) => {
      const result = calculateImportEstimate({
        ...FIXTURES.UZ,
        currency: 'CNY',
        transactionRate: '1600',
        usdRate,
      });
      expect(result).toMatchObject({ status: 'incomplete', total: null, lines: [] });
      expect(result.missingFields).toContain('usdRate');
    },
  );

  it.each(['0', '-1', 'NaN', '1,000', 'Infinity', 'wrong'])(
    'rejects invalid UZ CNY usdRate %s without running the policy',
    (usdRate) => {
      const result = calculateImportEstimate({
        ...FIXTURES.UZ,
        currency: 'CNY',
        transactionRate: '1600',
        usdRate,
      });
      expect(result).toMatchObject({ status: 'invalid', total: null, lines: [] });
      expect(result.fieldErrors.usdRate).toBe(
        usdRate === '0' ? 'must_be_positive' : 'invalid_decimal',
      );
    },
  );

  it.each(['', 'not-a-date', '2100-12', '1900-01'])(
    'ignores AL hidden manufacture date %s',
    (manufactureDate) => {
      expect(calculateImportEstimate({ ...FIXTURES.AL, manufactureDate })).toMatchObject({
        status: 'reference',
        total: '171688',
        fieldErrors: {},
      });
    },
  );

  it.each(COUNTRIES)('ignores hidden displacement for %s BEV', (country) => {
    const valid = calculateImportEstimate({
      ...FIXTURES[country],
      powertrain: 'bev',
      displacementCc: '',
    });
    const staleHidden = calculateImportEstimate({
      ...FIXTURES[country],
      powertrain: 'bev',
      displacementCc: 'not-a-number',
    });
    expect(staleHidden.status).toBe('reference');
    expect(staleHidden.total).toBe(valid.total);
    expect(staleHidden.lines).toEqual(valid.lines);
  });

  it('requires RU BEV horsepower because the recycling amount depends on it', () => {
    const missing = calculateImportEstimate({
      ...FIXTURES.RU,
      powertrain: 'bev',
      displacementCc: '',
      powerHp: '',
    });
    expect(missing).toMatchObject({ status: 'incomplete', total: null });
    expect(missing.missingFields).toContain('powerHp');
    const calculated = calculateImportEstimate({
      ...FIXTURES.RU,
      powertrain: 'bev',
      displacementCc: '',
      powerHp: '150',
    });
    expect(calculated).toMatchObject({ status: 'reference', total: '2548125' });
    expect(calculated.lines.find(({ id }) => id === 'recycling')?.amount).toBe('2227200');
  });
});
