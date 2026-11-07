import { describe, expect, it } from 'vitest';
import { getCountryByCode } from '../config/countries';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { createDefaultInput } from './defaults';
import { restoreCalculatorDraft } from './draft';

const date = '2026-10-23';
const rates = createReferenceSnapshot();
const ru = getCountryByCode('RU')!;
const kg = getCountryByCode('KG')!;
const defaults = createDefaultInput('RU', date, rates);
const current = (input: unknown, manualRates: unknown = false) => ({
  current: JSON.stringify({ input, manualRates }),
});

describe('pure calculator draft restoration', () => {
  it.each([null, '', '{', 'null', 'false', '42', '[]', '{}', '{"input":[]}'])(
    'falls back to explicit route defaults for missing or malformed current draft %s',
    (raw) => {
      expect(restoreCalculatorDraft({ current: raw }, ru, date, rates)).toEqual({
        input: defaults,
        manualRates: false,
      });
    },
  );

  it('prefers the current format and never revives an old legacy draft after corruption', () => {
    const legacy = JSON.stringify({ ...defaults, price: '999999' });
    expect(restoreCalculatorDraft({ current: '{', legacy }, ru, date, rates).input).toEqual(
      defaults,
    );
    expect(
      restoreCalculatorDraft(
        { ...current({ ...defaults, price: '250000' }), legacy },
        ru,
        date,
        rates,
      ).input.price,
    ).toBe('250000');
  });

  it('migrates a legacy CNY draft with empty price by converting the USD fallback', () => {
    const restored = restoreCalculatorDraft(
      { current: null, legacy: JSON.stringify({ ...defaults, price: '', currency: 'CNY' }) },
      ru,
      date,
      rates,
    );
    expect(restored.input).toMatchObject({ currency: 'CNY', price: '172500.00' });
  });

  it('preserves deliberately cleared fields and unfinished input in the current format', () => {
    const restored = restoreCalculatorDraft(
      current({ ...defaults, price: '', powerHp: '1,500', freight: '  ', manufactureDate: '' }),
      ru,
      date,
      rates,
    );
    expect(restored.input).toMatchObject({
      price: '',
      powerHp: '1,500',
      freight: '  ',
      manufactureDate: '',
    });
  });

  it('ignores non-string, oversized and unknown option values instead of making them facts', () => {
    const restored = restoreCalculatorDraft(
      current({
        price: 100000,
        displacementCc: null,
        powerHp: {},
        customsDate: [],
        manufactureDate: 'x'.repeat(65),
        currency: 'EUR',
        powertrain: 'hydrogen',
        steering: 'center',
        condition: 'unknown',
      }),
      ru,
      date,
      rates,
    );
    expect(restored).toEqual({ input: defaults, manualRates: false });
  });

  it.each(['RU', 'KZ', 'UZ', 'GE', 'AM', 'AL'] as const)(
    '%s drops a hidden company identity even when its legacy draft requested it',
    (code) => {
      const country = getCountryByCode(code)!;
      expect(
        restoreCalculatorDraft(
          current({ ...defaults, country: code, importerType: 'company' }),
          country,
          date,
          rates,
        ).input.importerType,
      ).toBe('individual');
    },
  );

  it('keeps the same-country KG identity and vehicle facts without mutating the snapshot', () => {
    const before = JSON.stringify(rates);
    const input = { ...defaults, country: 'KG', importerType: 'company', powertrain: 'erev' };
    const restored = restoreCalculatorDraft(current(input), kg, date, rates);
    expect(restored.input).toMatchObject({
      country: 'KG',
      importerType: 'company',
      powertrain: 'erev',
    });
    expect(JSON.stringify(rates)).toBe(before);
    expect(input.country).toBe('KG');
  });

  it('clears company and manual foreign-country FX when reusing vehicle facts on KG', () => {
    const restored = restoreCalculatorDraft(
      current(
        {
          ...defaults,
          importerType: 'company',
          price: '245000',
          transactionRate: '999',
          euroRate: '888',
        },
        true,
      ),
      kg,
      date,
      rates,
    );
    expect(restored.manualRates).toBe(false);
    expect(restored.input).toMatchObject({
      ...createDefaultInput('KG', date, rates),
      price: '245000',
      importerType: 'individual',
    });
  });

  it('restores same-country manual rate text for regular validation, including UZ USD rate', () => {
    const uz = getCountryByCode('UZ')!;
    const restored = restoreCalculatorDraft(
      current(
        { ...defaults, country: 'UZ', transactionRate: '', euroRate: '1,23', usdRate: '12000' },
        true,
      ),
      uz,
      date,
      rates,
    );
    expect(restored).toMatchObject({
      manualRates: true,
      input: { transactionRate: '', euroRate: '1,23', usdRate: '12000' },
    });
  });

  it('requires an explicit boolean manual flag in v2 and recalculates automatic rates', () => {
    const restored = restoreCalculatorDraft(
      current({ ...defaults, transactionRate: '999', euroRate: '888' }, 'true'),
      ru,
      date,
      rates,
    );
    expect(restored).toEqual({ input: defaults, manualRates: false });
  });

  it('infers same-country manual rates only for the legacy schema', () => {
    const restored = restoreCalculatorDraft(
      {
        current: null,
        legacy: JSON.stringify({ ...defaults, transactionRate: '12.5', euroRate: '99' }),
      },
      ru,
      date,
      rates,
    );
    expect(restored).toMatchObject({
      manualRates: true,
      input: { transactionRate: '12.5', euroRate: '99' },
    });
  });

  it('ignores non-string or oversized stored manual rates while keeping valid rates', () => {
    const restored = restoreCalculatorDraft(
      current({ ...defaults, transactionRate: 12, euroRate: '9'.repeat(65), usdRate: '89' }, true),
      ru,
      date,
      rates,
    );
    expect(restored.manualRates).toBe(true);
    expect(restored.input).toMatchObject({
      transactionRate: defaults.transactionRate,
      euroRate: defaults.euroRate,
      usdRate: '89',
    });
  });
});
