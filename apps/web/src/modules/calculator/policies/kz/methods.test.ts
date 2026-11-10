import { describe, expect, it } from 'vitest';
import type { CalculationInput } from '../../core/types';
import { kzMethodMessages } from './method-messages';
import { calculateKzReference } from './reference';

const base: CalculationInput = {
  country: 'KZ',
  importerType: 'individual',
  powertrain: 'petrol',
  price: '25000',
  currency: 'USD',
  transactionRate: '468.321957',
  euroRate: '541.1',
  displacementCc: '1998',
  powerHp: '150',
  manufactureDate: '2021-01',
  customsDate: '2026-01-01',
  freight: '',
  insurance: '',
  steering: 'left',
};
const quote = (
  changes: Partial<CalculationInput> = {},
  ageMonths = 60,
  ageYears = Math.floor(ageMonths / 12),
) => calculateKzReference({ input: { ...base, ...changes }, ageMonths, ageYears });
const method = (
  id: string,
  changes: Partial<CalculationInput> = {},
  ageMonths = 60,
  ageYears = Math.floor(ageMonths / 12),
) => quote(changes, ageMonths, ageYears).lines.find((line) => line.id === id)!.method!;
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

describe('KZ fee explanations', () => {
  it('shows the seven-year comparison, both monetary candidates and the exact cc boundary', () => {
    const changes = {
      price: '1000',
      transactionRate: '500',
      euroRate: '500',
      displacementCc: '1000',
    };
    expect(method('duty', changes, 84).key).toBe('KZ.dutyYoung');
    expect(method('duty', changes, 85)).toEqual({
      key: 'KZ.dutyOld',
      params: {
        ageMonths: 85,
        value: '500000',
        percentage: '15',
        valueDuty: '75000',
        cc: '1000',
        perCc: '0.36',
        euroRate: '500',
        minimumDuty: '180000',
        lower: '0',
        upper: '1000',
      },
    });
  });

  it('names every VAT operand and preserves the unrounded duty used by the calculation', () => {
    expect(method('vat', { price: '2.72', transactionRate: '1' })).toEqual({
      key: 'KZ.vat',
      params: {
        value: '2.72',
        duty: '0.408',
        engineExcise: '0',
        luxuryExcise: '0',
        customsFee: '25950',
        base: '25953.128',
        percentage: '16',
      },
    });
  });

  it('explains zero duties and recycling for EREV while keeping its engine excise', () => {
    const changes = { powertrain: 'erev' as const, displacementCc: '3500' };
    expect(method('duty', changes).key).toBe('KZ.dutyElectric');
    expect(method('excise', changes)).toEqual({
      key: 'KZ.excise',
      params: { cc: '3500', perCc: '100' },
    });
    expect(method('recycling', changes).key).toBe('KZ.recyclingElectric');
    expect(method('registration', changes, 24, 2)).toEqual({
      key: 'KZ.registrationElectricMiddle',
      params: { ageYears: 2, mci: '4325', coefficient: '25' },
    });
    expect(method('relatedCosts').params.amount).toBe('400000');
  });

  it('has matching localized templates for every fee and age/powertrain branch', () => {
    const cases = [
      quote(),
      quote({}, 12, 1),
      quote({}, 24, 2),
      quote({}, 85),
      quote({ displacementCc: '1000' }, 85),
      quote({ displacementCc: '3500' }, 85),
      quote({ price: '100000000', transactionRate: '1' }),
      quote({ powertrain: 'bev', displacementCc: '' }, 12, 1),
      quote({ powertrain: 'bev', displacementCc: '' }, 24, 2),
      quote({ powertrain: 'bev', displacementCc: '' }),
      quote({ powertrain: 'erev', displacementCc: '3500' }),
    ];
    const keys = new Set<string>();
    for (const result of cases)
      for (const line of result.lines) {
        const details = line.method!;
        expect(details).toBeDefined();
        const key = details.key.replace('KZ.', '') as keyof typeof kzMethodMessages.zh;
        keys.add(key);
        for (const lang of ['zh', 'en', 'ru'] as const) {
          expect(kzMethodMessages[lang][key]).toBeTruthy();
          expect(placeholders(kzMethodMessages[lang][key])).toEqual(
            Object.keys(details.params).sort(),
          );
        }
        for (const value of Object.values(details.params))
          expect(Number.isFinite(Number(value))).toBe(true);
      }
    expect([...keys].sort()).toEqual(Object.keys(kzMethodMessages.zh).sort());
  });
});
