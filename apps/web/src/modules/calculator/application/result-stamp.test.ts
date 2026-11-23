import { describe, expect, it } from 'vitest';
import { calculateImportEstimate } from '../core/calculate';
import type { CalculationInput, CountryCode } from '../core/types';
import { createDefaultInput } from './defaults';
import { getResultStamp } from './result-stamp';

function stamp(country: CountryCode, changes: Partial<CalculationInput> = {}) {
  const input = { ...createDefaultInput(country, '2026-11-23'), ...changes };
  return getResultStamp(input, calculateImportEstimate(input));
}
describe('verified reference stamps', () => {
  it.each(['RU', 'KZ', 'KG', 'AM', 'AL'] as const)('keeps the %s partial result in manual status', country => {
    expect(stamp(country)).toMatchObject({ tone: 'muted', subtitle: { key: 'rulesPending' }, year: null });
  });
  it('shows the actual left-hybrid and older age states in Georgia', () => {
    expect(stamp('GE', { powertrain: 'hev', manufactureDate: '2020-01' })).toMatchObject({
      tone: 'green', title: { key: 'hybridRelief' }, condition: { key: 'leftHand' }, year: '2026',
    });
    expect(stamp('GE', { powertrain: 'hev', manufactureDate: '2019-01' })).toMatchObject({ subtitle: { key: 'over6' } });
    expect(stamp('GE', { powertrain: 'bev', steering: 'right' })).toMatchObject({
      condition: { key: 'rightHand' }, title: { key: 'electricSchedule' },
    });
  });
  it('distinguishes the verified Kyrgyz business tariff age band and manual boundary', () => {
    expect(stamp('KG', { importerType: 'company', manufactureDate: '2022-11' })).toMatchObject({
      title: { key: 'companySchedule' }, subtitle: { key: 'kgCompanyMiddle' },
    });
    expect(stamp('KG', { importerType: 'company', manufactureDate: '2019-11' }).tone).toBe('muted');
    expect(stamp('KG', { importerType: 'company', manufactureDate: '2019-10' }).subtitle.key).toBe('over7');
  });
  it('keeps Uzbek registration and tariff age separate', () => {
    expect(stamp('UZ', { condition: 'used', manufactureDate: '2024-01' })).toMatchObject({
      title: { key: 'used' }, subtitle: { key: 'recyclingUpTo36' },
    });
    expect(stamp('UZ', { condition: 'new', manufactureDate: '2026-01' }).title.key).toBe('newUnder12');
    expect(stamp('UZ', { manufactureDate: '2023-11' }).tone).toBe('muted');
  });
  it.each(['TJ', 'TM'] as const)('labels the eligible %s electric estimate', country => {
    expect(stamp(country, { powertrain: 'bev', manufactureDate: '2026-01' })).toMatchObject({
      tone: 'blue', year: '2026', subtitle: { key: 'electricSchedule' },
    });
  });
});
