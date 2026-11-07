import { describe, expect, it } from 'vitest';
import { getCountryByCode } from '../config/countries';
import { calculateImportEstimate } from '../core/calculate';
import type { CalculationInput } from '../core/types';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { createDefaultInput } from './defaults';
import { getCopyQuoteFacts } from './copy-quote';

const rates = createReferenceSnapshot();
function facts(input: CalculationInput, manual = false) {
  return Object.fromEntries(
    getCopyQuoteFacts(
      input,
      calculateImportEstimate(input),
      getCountryByCode(input.country)!,
      rates,
      manual,
    ).map((fact) => [fact.label.key, 'text' in fact.value ? fact.value.text : fact.value.key]),
  );
}

describe('copied quote input facts', () => {
  it('keeps exact price, power, dates, currencies, exchange rates and rule version for reproduction', () => {
    const input = {
      ...createDefaultInput('RU', '2026-10-23', rates),
      price: '25001.25',
      currency: 'USD' as const,
      transactionRate: '81.969182',
      euroRate: '94.7',
    };
    expect(facts(input, true)).toEqual({
      price: '25001.25 USD',
      powertrain: 'petrol',
      displacement: '1998',
      power: '150',
      manufactureDate: '2021-01',
      customsDate: '2026-10-23',
      transactionRate: '81.969182 RUB/USD',
      euroRate: '94.7 RUB/EUR',
      fxStatus: 'manualFx',
      fxSnapshotDate: rates.asOf,
      ruleVersion: 'ru-personal-reference-2026.10.23-v2',
    });
  });

  it('omits inactive price, transport, power and tax FX for Georgia while preserving steering and display FX', () => {
    const input = { ...createDefaultInput('GE', '2026-10-23', rates), steering: 'right' as const };
    expect(facts(input, true)).toEqual({
      powertrain: 'petrol',
      displacement: '1998',
      manufactureDate: '2021-01',
      customsDate: '2026-10-23',
      steering: 'right',
      usdRate: `${rates.rates.GEL} GEL/USD`,
      fxStatus: 'fallbackFx',
      fxSnapshotDate: rates.asOf,
      ruleVersion: 'ge-personal-reference-2026.10.22-v1',
    });
  });

  it('omits displacement and inactive euro rate on RU BEV while keeping declared electric horsepower', () => {
    const result = facts({ ...createDefaultInput('RU', '2026-10-23', rates), powertrain: 'bev' });
    expect(result).not.toHaveProperty('displacement');
    expect(result).not.toHaveProperty('euroRate');
    expect(result).toHaveProperty('electricPower', '150');
    expect(result).not.toHaveProperty('power');
  });

  it('omits hidden manufacture date in Albania and distinguishes unknown freight from explicit zero insurance', () => {
    const result = facts({
      ...createDefaultInput('AL', '2026-10-23', rates),
      insurance: '0',
      currency: 'CNY',
    });
    expect(result).not.toHaveProperty('manufactureDate');
    expect(result).not.toHaveProperty('condition');
    expect(result).not.toHaveProperty('steering');
    expect(result).toHaveProperty('freight', 'notProvided');
    expect(result).toHaveProperty('insurance', '0 CNY');
  });

  it('records UZ registration condition and the separate USD tariff rate for a CNY transaction', () => {
    const result = facts({
      ...createDefaultInput('UZ', '2026-10-23', rates),
      currency: 'CNY',
      condition: 'new',
      usdRate: '12001.125',
      freight: '15000.50',
    });
    expect(result).toHaveProperty('condition', 'newVehicle');
    expect(result).toHaveProperty('usdRate', '12001.125 UZS/USD');
    expect(result).toHaveProperty('freight', '15000.50 CNY');
    expect(result).not.toHaveProperty('marketCrossRate');
    expect(result).not.toHaveProperty('euroRate');
  });

  it('does not copy a stale optional USD rate when UZ calculates from a USD transaction rate', () => {
    const result = facts({
      ...createDefaultInput('UZ', '2026-10-23', rates),
      currency: 'USD',
      transactionRate: '12002',
      usdRate: '1',
    });
    expect(result).toHaveProperty('transactionRate', '12002 UZS/USD');
    expect(result).not.toHaveProperty('usdRate');
  });

  it('includes the actual market leg used to display a CNY-based local fee in USD', () => {
    const result = facts(
      { ...createDefaultInput('KG', '2026-10-23', rates), currency: 'CNY', powertrain: 'erev' },
      true,
    );
    expect(result).toHaveProperty('marketCrossRate', `${rates.rates.CNY} CNY/USD`);
    expect(result).not.toHaveProperty('displacement');
    expect(result).not.toHaveProperty('power');
  });

  it('labels a live supplied snapshot without changing any copied input precision', () => {
    const live = {
      ...rates,
      status: 'live' as const,
      source: 'open.er-api.com' as const,
      asOf: '2026-10-23',
    };
    const input = createDefaultInput('AM', '2026-10-23', live);
    const result = getCopyQuoteFacts(
      input,
      calculateImportEstimate(input),
      getCountryByCode('AM')!,
      live,
      false,
    );
    expect(result.find((fact) => fact.label.key === 'fxStatus')?.value).toEqual({
      namespace: 'CopyQuote',
      key: 'automaticFx',
    });
    expect(result.find((fact) => fact.label.key === 'fxSnapshotDate')?.value).toEqual({
      text: '2026-10-23',
    });
  });
});
