import { describe, expect, it } from 'vitest';
import type { CalculationInput } from '../../core/types';
import { ruMethodMessages } from './method-messages';
import { calculateRuReference } from './reference';

const base: CalculationInput = {
  country: 'RU',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '25000',
  currency: 'USD',
  transactionRate: '81.969182',
  euroRate: '94.7',
  displacementCc: '1998',
  powerHp: '150',
  manufactureDate: '2021-01',
  customsDate: '2026-01-16',
  freight: '',
  insurance: '',
  steering: 'left',
};
const quote = (changes: Partial<CalculationInput> = {}, ageMonths = 60) =>
  calculateRuReference({
    input: { ...base, ...changes },
    ageMonths,
    ageYears: Math.floor(ageMonths / 12),
  });
const method = (id: string, changes: Partial<CalculationInput> = {}, ageMonths = 60) =>
  quote(changes, ageMonths).lines.find((line) => line.id === id)!.method!;
const placeholders = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

// These assertions check policy-selected explanations as well as the numeric
// operands that distinguish tariff branches; numerical compatibility stays in reference.test.ts.
describe('RU fee explanations', () => {
  it('explains both competing duties for a young car, with the actual EUR price band', () => {
    const details = method(
      'duty',
      { price: '10000', transactionRate: '1', euroRate: '2', displacementCc: '1000' },
      24,
    );
    expect(details).toMatchObject({
      key: 'RU.unifiedYoung',
      params: { euroRate: '2', euroValue: '5000', rate: '54', percentageDuty: '2700',
        cc: '1000', minimum: '2.5', minimumDuty: '2500' },
    });
    expect(method('duty', { price: '20000', transactionRate: '1', euroRate: '2' }, 24).params.rate).toBe('48');
  });

  it('explains the actual age-band rate and electric value-based duty', () => {
    expect(method('duty', {}, 59)).toMatchObject({ key: 'RU.unifiedUsed', params: { cc: '1998', rate: '2.7' } });
    expect(method('duty', {}, 60)).toMatchObject({ key: 'RU.unifiedUsed', params: { cc: '1998', rate: '4.8' } });
    expect(method('duty', { powertrain: 'bev', displacementCc: '', euroRate: '' })).toEqual({
      key: 'RU.dutyElectric', params: { value: '2049229.55', percentage: 15 },
    });
  });

  it('explains the selected personal concession and standard recycling coefficients', () => {
    expect(method('recycling', {}, 35)).toEqual({ key: 'RU.recyclingConcession',
      params: { hp: '150', coefficient: '0.17', base: '20000' } });
    expect(method('recycling', {}, 36).params.coefficient).toBe('0.26');
    expect(method('recycling', { powertrain: 'bev', displacementCc: '' }, 36)).toMatchObject({
      key: 'RU.recyclingTable', params: { hp: '150', coefficient: '111.36', base: '20000' },
    });
    expect(method('recycling', { powerHp: '160.01' }, 36)).toMatchObject({
      key: 'RU.recyclingTable', params: { hp: '160.01', coefficient: '74.64' },
    });
  });

  it('has concrete, matching three-language templates for every reachable explanation', () => {
    const cases = [
      quote(),
      quote({}, 24),
      quote({}, 36),
      quote({ powerHp: '161' }, 24),
      quote({ powerHp: '161' }),
      quote({ powertrain: 'bev', displacementCc: '' }, 24),
      quote({ powertrain: 'bev', displacementCc: '' }),
      quote({ price: '200000', transactionRate: '1', euroRate: '1' }, 24),
      quote({ displacementCc: '4000', powerHp: '161' }, 36),
      quote({ displacementCc: '4000', powerHp: '161' }),
      quote({ displacementCc: '2500', powerHp: '510' }, 24),
      quote({ price: '10000001', transactionRate: '1' }),
    ];
    const keys = new Set<string>();
    for (const result of cases)
      for (const line of result.lines) {
        const details = line.method!;
        expect(details).toBeDefined();
        const key = details.key.replace('RU.', '') as keyof typeof ruMethodMessages.zh;
        keys.add(key);
        for (const lang of ['zh', 'en', 'ru'] as const) {
          expect(ruMethodMessages[lang][key]).toBeTruthy();
          expect([...new Set(placeholders(ruMethodMessages[lang][key]))].sort()).toEqual(
            Object.keys(details.params).sort(),
          );
        }
        for (const value of Object.values(details.params))
          expect(Number.isFinite(Number(value))).toBe(true);
      }
    expect([...keys].sort()).toEqual(Object.keys(ruMethodMessages.zh).sort());
  });
});
