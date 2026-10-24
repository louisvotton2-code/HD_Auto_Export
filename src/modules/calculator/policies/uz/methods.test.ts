import { describe, expect, it } from 'vitest';
import type { CalculationInput } from '../../core/types';
import { uzMethodMessages } from './method-messages';
import { calculateUzReference } from './reference';

const base: CalculationInput = {
  country: 'UZ',
  importerType: 'individual',
  powertrain: 'petrol',
  condition: 'used',
  price: '10000',
  currency: 'USD',
  transactionRate: '1000',
  euroRate: '',
  usdRate: '1000',
  displacementCc: '1998',
  powerHp: '',
  manufactureDate: '2021-01',
  customsDate: '2026-01-01',
  freight: '2000',
  insurance: '100',
  steering: 'left',
};
const quote = (changes: Partial<CalculationInput> = {}, ageMonths = 60) =>
  calculateUzReference({
    input: { ...base, ...changes },
    ageMonths,
    ageYears: Math.floor(ageMonths / 12),
  });
const method = (id: string, changes: Partial<CalculationInput> = {}, ageMonths = 60) =>
  quote(changes, ageMonths).lines.find((line) => line.id === id)!.method!;
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

describe('UZ fee explanations', () => {
  it('passes the supplied transport and insurance through both tax-base explanations', () => {
    expect(method('customsFee')).toEqual({
      key: 'UZ.customsFee',
      params: {
        customsUsd: '12100',
        lower: '10000',
        upper: '20000',
        brv: '412000',
        coefficient: '1.5',
      },
    });
    expect(method('duty')).toEqual({
      key: 'UZ.dutyUsed',
      params: {
        ageMonths: 60,
        customsUsd: '12100',
        percentage: '40',
        cc: '1998',
        perCc: '3',
        usdRate: '1000',
      },
    });
    expect(method('vat')).toEqual({
      key: 'UZ.vat',
      params: {
        value: '12100000',
        duty: '10834000',
        base: '22934000',
        percentage: '12',
      },
    });
  });

  it('selects the actual new/used hybrid branch at each age threshold', () => {
    const changes = { powertrain: 'phev' as const, condition: 'new' as const };
    expect(method('duty', changes, 12)).toEqual({
      key: 'UZ.dutyHybridNewYoung',
      params: {
        ageMonths: 12,
        customsUsd: '12100',
        percentage: '15',
        usdRate: '1000',
      },
    });
    expect(method('duty', changes, 13)).toMatchObject({
      key: 'UZ.dutyHybridNewOld',
      params: { percentage: '30' },
    });
    expect(method('duty', { ...changes, condition: 'used' }, 36)).toMatchObject({
      key: 'UZ.dutyHybridUsedYoung',
      params: { percentage: '30', cc: '1998', perCc: '1' },
    });
    expect(method('duty', { ...changes, condition: 'used' }, 37)).toMatchObject({
      key: 'UZ.dutyHybridUsedOld',
      params: { percentage: '40', perCc: '3' },
    });
    expect(method('duty', { ...changes, powertrain: 'erev' }, 12)).toEqual(
      method('duty', changes, 12),
    );
  });

  it('explains the BEV duty exemption separately from its age-based recycling and registration', () => {
    const changes = { powertrain: 'bev' as const, displacementCc: '' };
    expect(method('duty', changes)).toEqual({ key: 'UZ.dutyElectric', params: {} });
    expect(method('recycling', changes, 36)).toEqual({
      key: 'UZ.recyclingElectricYoung',
      params: { ageMonths: 36, brv: '412000', coefficient: '120' },
    });
    expect(method('recycling', changes, 37)).toEqual({
      key: 'UZ.recyclingElectricOld',
      params: { ageMonths: 37, brv: '412000', coefficient: '210' },
    });
    expect(method('registration', changes)).toEqual({
      key: 'UZ.registrationElectric',
      params: { brv: '412000', coefficient: '7.7' },
    });
  });

  it('has matching three-language operands for every reachable explanation', () => {
    const cases = [
      quote(),
      quote({}, 36),
      quote({ condition: 'new' }, 12),
      quote({ condition: 'new' }, 13),
      quote({ powertrain: 'hev', condition: 'new' }, 12),
      quote({ powertrain: 'hev', condition: 'new' }, 13),
      quote({ powertrain: 'hev' }, 36),
      quote({ powertrain: 'hev' }, 37),
      quote({ powertrain: 'bev', displacementCc: '' }, 36),
      quote({ powertrain: 'bev', displacementCc: '' }, 37),
      quote({ price: '1000001', freight: '', insurance: '' }),
    ];
    const keys = new Set<string>();
    for (const result of cases)
      for (const line of result.lines) {
        const details = line.method!;
        expect(details).toBeDefined();
        const key = details.key.replace('UZ.', '') as keyof typeof uzMethodMessages.zh;
        keys.add(key);
        for (const lang of ['zh', 'en', 'ru'] as const) {
          expect(uzMethodMessages[lang][key]).toBeTruthy();
          expect(placeholders(uzMethodMessages[lang][key])).toEqual(
            Object.keys(details.params).sort(),
          );
        }
        for (const value of Object.values(details.params))
          expect(Number.isFinite(Number(value))).toBe(true);
      }
    expect([...keys].sort()).toEqual(Object.keys(uzMethodMessages.zh).sort());
  });
});
