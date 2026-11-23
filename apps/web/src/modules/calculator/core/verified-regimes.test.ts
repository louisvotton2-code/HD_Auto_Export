import { describe, expect, it } from 'vitest';
import { createDefaultInput } from '../application/defaults';
import { calculateImportEstimate } from './calculate';
import type { CalculationInput, CountryCode } from './types';

const date = '2026-11-23';
function quote(country: CountryCode, changes: Partial<CalculationInput> = {}) {
  return calculateImportEstimate({ ...createDefaultInput(country, date), manufactureDate: '2022-11',
    currency: 'USD', price: '20000', displacementCc: '1998', ...changes });
}
const amount = (result: ReturnType<typeof quote>, id: string) => result.lines.find(line => line.id === id)?.amount;

describe('current supported passenger import methods', () => {
  it.each([
    ['RU', '90', '100', '539460.00'], ['AM', '200', '420', '2265732.00'], ['KG', '87.5', '100', '539460.00'],
  ] as const)('%s uses the EAEU personal rate without a separate VAT charge or an unverified total', (country, transactionRate, euroRate, expected) => {
    const scenario = { transactionRate, euroRate, freight: '1000', insurance: '100' };
    const result = quote(country, scenario);
    expect(result).toMatchObject({ status: 'needs_review', total: null });
    expect(amount(result, 'duty')).toBe(expected);
    expect(amount(result, 'vat')).toBeUndefined();
    expect(quote(country, { ...scenario, freight: '', insurance: '' }).lines).toEqual(result.lines);
  });

  it.each([
    ['2023-11', '2026-11-15', '1098900.00'], ['2023-11', '2026-11-16', '539460.00'],
    ['2021-11', '2026-11-15', '539460.00'], ['2021-11', '2026-11-16', '959040.00'],
  ])('uses day 15 for month-only EAEU manufacture %s at declaration %s', (manufactureDate, customsDate, expected) => {
    const result = quote('RU', { transactionRate: '100', euroRate: '100', manufactureDate, customsDate });
    expect(amount(result, 'duty')).toBe(expected);
  });

  it('uses the actual documented manufacture day when a known vehicle crosses five years', () => {
    const facts = { transactionRate: '100', euroRate: '100', manufactureDate: '2021-11-28' };
    expect(amount(quote('RU', facts), 'duty')).toBe('539460.00');
    expect(amount(quote('RU', { ...facts, customsDate: '2026-11-28' }), 'duty')).toBe('539460.00');
    expect(amount(quote('RU', { ...facts, customsDate: '2026-11-29' }), 'duty')).toBe('959040.00');
    expect(quote('RU', { ...facts, manufactureDate: '2026-11-24' }).fieldErrors.manufactureDate).toBe('manufacture_after_customs');
  });

  it('uses the applicable Russian customs operation band inclusive of the upper bound', () => {
    expect(amount(quote('RU', { price: '2700000', transactionRate: '1', euroRate: '100' }), 'customsFee')).toBe('13541.00');
    expect(amount(quote('RU', { price: '2700000.01', transactionRate: '1', euroRate: '100' }), 'customsFee')).toBe('18465.00');
    expect(quote('RU', { powertrain: 'bev' })).toMatchObject({ status: 'needs_review', total: null, lines: [] });
  });

  it.each([
    ['2023-11', '2026-11-15', '80000.00'], ['2023-11', '2026-11-16', '160000.00'],
    ['2021-11', '2026-11-15', '160000.00'], ['2021-11', '2026-11-16', '240000.00'],
    ['2016-11', '2026-11-15', '240000.00'], ['2016-11', '2026-11-16', '480000.00'],
    ['2011-11', '2026-11-15', '480000.00'], ['2011-11', '2026-11-16', '960000.00'],
  ])('uses current Armenian environmental bands for %s with declaration %s', (manufactureDate, customsDate, expected) => {
    expect(amount(quote('AM', { transactionRate: '200', euroRate: '420', manufactureDate, customsDate }), 'environmental')).toBe(expected);
  });

  it('scopes Kazakhstan recycling to direct-China verified vehicle types and exact displacement boundaries', () => {
    expect(amount(quote('KZ'), 'recycling')).toBe('756875.00');
    expect(amount(quote('KZ', { displacementCc: '2000.01' }), 'recycling')).toBe('1081250.00');
    expect(amount(quote('KZ', { powertrain: 'bev' }), 'recycling')).toBe('0.00');
    expect(quote('KZ', { powertrain: 'erev' })).toMatchObject({ total: null, lines: [] });
  });

  it('quotes Kyrgyz company border components separately from unverified registration', () => {
    const scenario = { importerType: 'company' as const, price: '10000', transactionRate: '87.5', euroRate: '100',
      freight: '0', insurance: '0' };
    const result = quote('KG', scenario);
    expect(result.total).toBe('304500.00');
    expect(result.lines.map(line => line.amount)).toEqual(['175000.00', '126000.00', '3500.00']);
    expect(amount(quote('KG', { ...scenario, manufactureDate: '2019-10' }), 'duty')).toBe('439560.00');
    expect(quote('KG', { ...scenario, manufactureDate: '2019-11' })).toMatchObject({ reason: 'age_boundary_manual', total: null });
    expect(amount(quote('KG', { ...scenario, price: '100' }), 'customsFee')).toBe('500.00');
    expect(amount(quote('KG', { ...scenario, price: '1000000' }), 'customsFee')).toBe('250000.00');
  });

  it.each([['petrol', '326516000'], ['hev', '213200000'], ['bev', '85400000']] as const)(
    'uses the current Uzbekistan border total for %s, excluding registration', (powertrain, total) => {
      const result = quote('UZ', { powertrain, transactionRate: '12500', freight: '1000', insurance: '0',
        manufactureDate: powertrain === 'bev' ? '2026-01' : '2023-01' });
      expect(result.total).toBe(total);
      expect(result.lines.some(line => line.id === 'registration')).toBe(false);
      expect(result.additionalCosts[0]?.amount).toBe(powertrain === 'petrol' ? '3009600' : '660000');
    });
  it('switches the UZ BRV on 1 September and withholds ambiguous age and EREV', () => {
    expect(amount(quote('UZ', { customsDate: '2026-08-31' }), 'recycling')).toBe('86520000');
    expect(amount(quote('UZ', { customsDate: '2026-09-01' }), 'recycling')).toBe('92400000');
    expect(quote('UZ', { manufactureDate: '2023-11' }).reason).toBe('age_boundary_manual');
    expect(quote('UZ', { manufactureDate: '2025-11', condition: 'new' }).reason).toBe('age_boundary_manual');
    expect(quote('UZ', { powertrain: 'erev' }).total).toBeNull();
  });

  it('uses Georgia exact cubic centimetres and both April and six-year boundaries', () => {
    expect(quote('GE', { manufactureDate: '2021-03', customsDate: ' 2026-04-02 ' }).total).toBe('3271.88');
    expect(quote('GE', { customsDate: '2026-04-01' }).total).toBeNull();
    expect(amount(quote('GE', { powertrain: 'hev', manufactureDate: '2020-01' }), 'excise')).toBe('1198.80');
    expect(amount(quote('GE', { powertrain: 'hev', manufactureDate: '2019-01' }), 'excise')).toBe('8991.00');
    expect(quote('GE', { manufactureDate: '1995-01' }).total).toBeNull();
    expect(quote('GE', { powertrain: 'bev', steering: 'right' }).total).toBe('3150.00');
    expect(quote('GE', { powertrain: 'bev', steering: 'left' }).total).toBe('150.00');
  });

  it('separates Albania assessed VAT and registration from manual items and tests the new BEV exemption', () => {
    const result = quote('AL', { price: '9000', freight: '1100', insurance: '0', transactionRate: '81.16' });
    expect(result).toMatchObject({ status: 'needs_review', total: null });
    expect(result.lines.map(line => line.amount)).toEqual(['163943.20', '8500.00']);
    expect(amount(quote('AL', { price: '1000', transactionRate: '81.16' }), 'vat')).toBe('16232.00');
    expect(amount(quote('AL', { powertrain: 'bev', condition: 'new' }), 'vat')).toBe('0.00');
    expect(Number(amount(quote('AL', { powertrain: 'bev', condition: 'used' }), 'vat'))).toBeGreaterThan(0);
  });

  it.each(['RU', 'KZ', 'AM', 'KG'] as const)('%s does not publish a BEV quota or HEV customs total by inference', country => {
    for (const powertrain of ['bev', 'hev', 'erev'] as const) {
      expect(quote(country, { powertrain })).toMatchObject({ status: 'needs_review', total: null });
    }
  });
});
