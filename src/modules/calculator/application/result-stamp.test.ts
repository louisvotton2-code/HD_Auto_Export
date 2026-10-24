import { describe, expect, it } from 'vitest';
import { calculateImportEstimate } from '../core/calculate';
import type { CalculationInput, CalculationResult, CountryCode } from '../core/types';
import { createDefaultInput } from './defaults';
import { getResultStamp } from './result-stamp';
import { stampMessages } from './stamp-messages';

function stamp(country: CountryCode, overrides: Partial<CalculationInput> = {}) {
  const input = { ...createDefaultInput(country, '2026-10-23'), ...overrides };
  const result = calculateImportEstimate(input);
  expect(result.status).toBe('reference');
  return getResultStamp(input, result);
}

describe('reference result stamp', () => {
  it.each([
    ['2023-11', 'under3'],
    ['2023-10', 'ruMiddle'],
    ['2021-11', 'ruMiddle'],
    ['2021-10', 'fivePlus'],
  ])('RU follows manufacture month %s', (manufactureDate, expected) => {
    const result = stamp('RU', { manufactureDate });
    expect(result.title.key).toBe('personalTariff');
    expect(result.subtitle.key).toBe(expected);
  });

  it('RU identifies the actual assumed personal recycling scenario', () => {
    expect(stamp('RU').condition?.key).toBe('personalRecyclingAssumed');
    expect(stamp('RU', { powerHp: '161' }).condition?.key).toBe('standardRecycling');
    expect(stamp('RU', { displacementCc: '3001' }).condition?.key).toBe('standardRecycling');
  });

  it('RU EV has its own schedule and does not imply personal recycling relief', () => {
    const result = stamp('RU', { powertrain: 'bev', displacementCc: '' });
    expect(result.title.key).toBe('electricSchedule');
    expect(result.condition?.key).toBe('electric');
    expect(result.tone).toBe('blue');
  });

  it.each([
    ['2019-10', 'upTo7'],
    ['2019-09', 'over7'],
  ])('KZ uses the inclusive 84-month boundary at %s', (manufactureDate, expected) => {
    expect(stamp('KZ', { manufactureDate }).subtitle.key).toBe(expected);
  });

  it.each([
    ['petrol', 'fuelSchedule', 'gold'],
    ['bev', 'electric', 'blue'],
    ['erev', 'seriesHybrid', 'blue'],
  ] as const)('KZ changes for %s', (powertrain, expected, tone) => {
    const result = stamp('KZ', { powertrain });
    expect(result.condition?.key).toBe(expected);
    expect(result.tone).toBe(tone);
  });

  it('KZ consumes the selected luxury charge, including its strict threshold', () => {
    expect(stamp('KZ', { price: '77850000', transactionRate: '1' }).title.key).toBe('commonTariff');
    expect(stamp('KZ', { price: '77850001', transactionRate: '1' }).title.key).toBe(
      'luxurySchedule',
    );
  });

  it.each([
    ['new', '2025-10', 'newUnder12', 'green'],
    ['new', '2025-09', 'newOver12', 'green'],
    ['used', '2025-10', 'used', 'gold'],
    ['used', '2025-09', 'used', 'gold'],
  ] as const)(
    'UZ %s / %s uses the correct duty scenario',
    (condition, manufactureDate, expected, tone) => {
      const result = stamp('UZ', { condition, manufactureDate });
      expect(result.title.key).toBe(expected);
      expect(result.tone).toBe(tone);
    },
  );

  it.each([
    ['2023-10', 'recyclingUpTo36'],
    ['2023-09', 'recyclingOver36'],
  ])(
    'UZ recycling boundary at %s remains separate from new/used status',
    (manufactureDate, expected) => {
      const result = stamp('UZ', { manufactureDate, condition: 'new' });
      expect(result.title.key).toBe('newOver12');
      expect(result.subtitle.key).toBe(expected);
    },
  );

  it('UZ electric retains new/used facts and highlights the electric route', () => {
    const result = stamp('UZ', { powertrain: 'bev', condition: 'used' });
    expect(result.title.key).toBe('used');
    expect(result.condition?.key).toBe('electric');
    expect(result.tone).toBe('blue');
  });

  it.each([
    ['2020-12', 'upTo6'],
    ['2019-12', 'over6'],
  ])('GE uses calendar-year age at %s', (manufactureDate, expected) => {
    expect(stamp('GE', { manufactureDate }).subtitle.key).toBe(expected);
  });

  it.each([
    ['hev', '2020-12', 'left', 'hybridRelief', 'green'],
    ['hev', '2019-12', 'left', 'geSchedule', 'gold'],
    ['hev', '2020-12', 'right', 'rightHandSchedule', 'gold'],
    ['petrol', '2020-12', 'right', 'rightHandSchedule', 'gold'],
    ['bev', '2020-12', 'right', 'electricSchedule', 'blue'],
  ] as const)(
    'GE %s / %s / %s shows the active route',
    (powertrain, manufactureDate, steering, expected, tone) => {
      const result = stamp('GE', { powertrain, manufactureDate, steering });
      expect(result.title.key).toBe(expected);
      expect(result.tone).toBe(tone);
      expect(result.condition?.key).toBe(steering === 'left' ? 'leftHand' : 'rightHand');
    },
  );

  it.each([
    ['2024-01', 'under3'],
    ['2023-01', 'amMiddle'],
    ['2020-01', 'amMiddle'],
    ['2019-01', 'sevenPlus'],
  ])('AM tariff age at %s', (manufactureDate, expected) => {
    expect(stamp('AM', { manufactureDate }).subtitle.key).toBe(expected);
  });

  it.each([
    ['2021-01', 'environmentNone'],
    ['2020-01', 'environment2'],
    ['2016-01', 'environment2'],
    ['2015-01', 'environment10'],
    ['2011-01', 'environment10'],
    ['2010-01', 'environment20'],
  ])('AM environmental age at %s', (manufactureDate, expected) => {
    expect(stamp('AM', { manufactureDate }).condition?.key).toBe(expected);
  });

  it('AM hybrid suppresses the fuel-only environmental tier', () => {
    expect(stamp('AM', { powertrain: 'hev', manufactureDate: '2010-01' }).condition?.key).toBe(
      'environmentNone',
    );
  });

  it('AM EV is explicitly an assumed relief scenario', () => {
    const result = stamp('AM', { powertrain: 'bev' });
    expect(result.title.key).toBe('electricReliefAssumed');
    expect(result.condition?.key).toBe('environmentNone');
    expect(result.tone).toBe('blue');
  });

  it.each([
    ['individual', '2023-01', 'upTo3'],
    ['individual', '2022-01', 'kgPersonalMiddle'],
    ['individual', '2021-01', 'kgPersonalMiddle'],
    ['individual', '2020-01', 'over5'],
    ['company', '2023-01', 'upTo3'],
    ['company', '2022-01', 'kgCompanyMiddle'],
    ['company', '2019-01', 'kgCompanyMiddle'],
    ['company', '2018-01', 'over7'],
  ] as const)('KG %s tariff age at %s', (importerType, manufactureDate, expected) => {
    const result = stamp('KG', { importerType, manufactureDate });
    expect(result.subtitle.key).toBe(expected);
    expect(result.title.key).toBe(
      importerType === 'individual' ? 'personalSchedule' : 'companySchedule',
    );
  });

  it.each([
    ['bev', 'individual', '2020-01', 'electricStandard'],
    ['erev', 'individual', '2020-01', 'electricStandard'],
    ['bev', 'company', '2021-01', 'electricStandard'],
    ['bev', 'company', '2020-01', 'electricWithVat'],
    ['erev', 'company', '2020-01', 'electricWithVat'],
  ] as const)(
    'KG %s / %s / %s changes electric VAT scenario',
    (powertrain, importerType, manufactureDate, expected) => {
      const result = stamp('KG', { powertrain, importerType, manufactureDate });
      expect(result.condition?.key).toBe(expected);
      expect(result.tone).toBe('blue');
    },
  );

  it('AL uses the actual luxury charge and does not require a manufacture date', () => {
    const regular = stamp('AL', {
      manufactureDate: '',
      displacementCc: '2999',
      price: '1000',
      transactionRate: '1',
    });
    expect(regular.title.key).toBe('vat20');
    expect(regular.subtitle.key).toBe('minimumValue');
    expect(regular.condition?.key).toBe('registrationIncluded');
    const luxury = stamp('AL', { displacementCc: '3000', price: '1000', transactionRate: '1' });
    expect(luxury.title.key).toBe('luxurySchedule');
    expect(luxury.condition?.key).toBe('annualTaxExtra');
  });

  it('AL EV is exempt from engine minimums but can reach the luxury value threshold', () => {
    expect(
      stamp('AL', { powertrain: 'bev', price: '4999999', transactionRate: '1' }).title.key,
    ).toBe('vat20');
    const result = stamp('AL', { powertrain: 'bev', price: '5000000', transactionRate: '1' });
    expect(result.title.key).toBe('luxurySchedule');
    expect(result.subtitle.key).toBe('electricValue');
  });

  it.each(['RU', 'KZ', 'UZ', 'GE', 'AM', 'KG', 'AL'] as const)(
    '%s always labels completed snapshots as reference 2026',
    (country) => {
      expect(stamp(country).year).toBe('2026');
    },
  );

  it.each([
    [{ powerHp: '' }, 'pending'],
    [{ powerHp: '-1' }, 'invalidInput'],
    [{ customsDate: '2027-10-23' }, 'pending'],
    [{ manufactureDate: '2027-01' }, 'invalidInput'],
    [{ importerType: 'company' }, 'pending'],
  ] as Array<[Partial<CalculationInput>, string]>)(
    'clears active bands for incomplete/invalid/uncovered facts %o',
    (overrides, expected) => {
      const input = { ...createDefaultInput('RU', '2026-10-23'), ...overrides };
      const result = getResultStamp(input, calculateImportEstimate(input));
      expect(result.tone).toBe('muted');
      expect(result.title.key).toBe(expected);
      expect(result.condition).toBeNull();
      expect(result.year).toBeNull();
    },
  );

  it('does not retain a previous active mark if a result has no current total', () => {
    const input = createDefaultInput('RU', '2026-10-23');
    const result: CalculationResult = { ...calculateImportEstimate(input), total: null };
    expect(getResultStamp(input, result).tone).toBe('muted');
  });

  it('three locale message sets have the same keys and interpolation arguments', () => {
    const keys = Object.keys(stampMessages.en).sort();
    for (const locale of ['zh', 'ru'] as const) {
      expect(Object.keys(stampMessages[locale]).sort()).toEqual(keys);
      for (const key of keys as Array<keyof typeof stampMessages.en>) {
        const parameters = (text: string) =>
          [...text.matchAll(/\{([^}]+)\}/g)].map((value) => value[1]).sort();
        expect(parameters(stampMessages[locale][key])).toEqual(parameters(stampMessages.en[key]));
      }
    }
  });
});
