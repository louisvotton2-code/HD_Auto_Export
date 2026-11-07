import { describe, expect, it } from 'vitest';
import zh from '../../../messages/zh.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import { countries } from '../config/countries';
import type { CalculationInput, CountryCode } from '../core/types';
import { createDefaultInput } from './defaults';
import { getCountryReferenceNotes } from './reference-notes';

function input(country: CountryCode, changes: Partial<CalculationInput> = {}): CalculationInput {
  return { ...createDefaultInput(country, '2026-10-22'), ...changes };
}

function notes(country: CountryCode, changes: Partial<CalculationInput> = {}) {
  return getCountryReferenceNotes(input(country, changes));
}

describe('policy explanations track the actual reference conditions', () => {
  it.each([
    ['2023-11', false], // 35 months
    ['2023-10', true], // exactly 3 years
    ['2021-11', true], // 59 months
    ['2021-10', false], // exactly 5 years
  ] as const)(
    'RU middle-age explanation at manufacture %s matches the 3–5 year window',
    (date, expected) => {
      expect(notes('RU', { manufactureDate: date }).includes('RU.middleAge')).toBe(expected);
    },
  );

  it('KZ only adds the older-car duty explanation after 84 months', () => {
    expect(notes('KZ', { manufactureDate: '2019-10' })).not.toContain('KZ.older');
    expect(notes('KZ', { manufactureDate: '2019-09' })).toContain('KZ.older');
  });

  it('KZ registration uses the calendar year difference rather than the duty month threshold', () => {
    const twoYears = notes('KZ', { manufactureDate: '2024-01' });
    const threeYears = notes('KZ', { manufactureDate: '2023-12' });
    expect(twoYears).not.toContain('KZ.registration');
    expect(threeYears).toContain('KZ.registration');
    expect(threeYears).not.toContain('KZ.older');
  });

  it('GE gives the hybrid relief through year 6 only for left-hand drive', () => {
    const sixYears = notes('GE', { manufactureDate: '2020-01', powertrain: 'hev' });
    expect(sixYears).toContain('GE.hybridRelief');
    expect(sixYears).not.toContain('GE.hybridNoRelief');
    expect(sixYears).not.toContain('GE.older');

    const sevenYears = notes('GE', { manufactureDate: '2019-01', powertrain: 'hev' });
    expect(sevenYears).toContain('GE.older');
    expect(sevenYears).toContain('GE.hybridNoRelief');
    expect(sevenYears).not.toContain('GE.hybridRelief');

    const rightHand = notes('GE', {
      manufactureDate: '2020-01',
      powertrain: 'hev',
      steering: 'right',
    });
    expect(rightHand).toContain('GE.rightHand');
    expect(rightHand).toContain('GE.hybridNoRelief');
    expect(rightHand).not.toContain('GE.hybridRelief');
  });

  it('switching GE from an old right-hand hybrid to BEV removes conflicting fuel explanations', () => {
    const oldHybrid = input('GE', {
      manufactureDate: '2012-01',
      powertrain: 'hev',
      steering: 'right',
    });
    expect(getCountryReferenceNotes(oldHybrid)).toEqual(
      expect.arrayContaining(['GE.older', 'GE.hybridNoRelief', 'GE.rightHand', 'GE.emissions']),
    );
    const electric = getCountryReferenceNotes({ ...oldHybrid, powertrain: 'bev' });
    expect(electric).toContain('GE.electric');
    for (const key of [
      'GE.older',
      'GE.hybridNoRelief',
      'GE.hybridRelief',
      'GE.rightHand',
      'GE.emissions',
    ])
      expect(electric).not.toContain(key);
    expect(getCountryReferenceNotes(oldHybrid)).not.toContain('GE.electric');
  });

  it.each([
    { manufactureDate: '', customsDate: '2026-10-22' },
    { manufactureDate: '2020-13', customsDate: '2026-10-22' },
    { manufactureDate: '2020-01', customsDate: '2026-02-30' },
    { manufactureDate: '2027-01', customsDate: '2026-10-22' },
    { manufactureDate: '2026-11', customsDate: '2026-10-22' },
  ])('invalid or future dates do not produce age-based policy claims: %j', (dates) => {
    const ageNotes = new Set([
      'RU.middleAge',
      'KZ.older',
      'KZ.registration',
      'UZ.older',
      'GE.older',
      'GE.hybridRelief',
      'GE.hybridNoRelief',
      'AM.largePetrol',
      'AM.largeHybrid',
      'KG.companyElectricYoung',
      'KG.companyElectricOld',
    ]);
    for (const { code } of countries) {
      for (const powertrain of ['petrol', 'hev', 'bev'] as const) {
        const selected = notes(code, {
          ...dates,
          powertrain,
          importerType: 'company',
          displacementCc: '3001',
        });
        expect(selected.filter((key) => ageNotes.has(key))).toEqual([]);
      }
    }
  });

  it('KG identity changes replace personal advice with company advice without changing the input', () => {
    const personal = input('KG', { powertrain: 'bev', manufactureDate: '2021-01' });
    const personalNotes = getCountryReferenceNotes(personal);
    expect(personalNotes).toEqual(
      expect.arrayContaining([
        'KG.electricQuota',
        'KG.personalLimit',
        'KG.personalFee',
        'KG.registration',
      ]),
    );
    expect(personalNotes).not.toContain('KG.companyBroker');
    expect(personalNotes).not.toContain('KG.companyElectricYoung');

    const companyNotes = getCountryReferenceNotes({ ...personal, importerType: 'company' });
    expect(companyNotes).toEqual(
      expect.arrayContaining(['KG.electricQuota', 'KG.companyBroker', 'KG.companyElectricYoung']),
    );
    for (const key of ['KG.personalLimit', 'KG.personalFee', 'KG.registration', 'KG.personalFuel'])
      expect(companyNotes).not.toContain(key);
    expect(
      notes('KG', { powertrain: 'bev', importerType: 'company', manufactureDate: '2020-01' }),
    ).toContain('KG.companyElectricOld');
    expect(getCountryReferenceNotes(personal)).toEqual(personalNotes);
    expect(personal.importerType).toBe('individual');
  });
});

function flattenStrings(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === 'string') return [[path, entry]];
      return Object.entries(flattenStrings(entry as Record<string, unknown>, path));
    }),
  );
}

function placeholders(value: string): string[] {
  return [...new Set([...value.matchAll(/\{(\w+)(?:\s*,|\})/g)].map((match) => match[1]))].sort();
}

describe('country policy translation contract', () => {
  it('all policy keys and interpolation parameters agree across Chinese, English and Russian', () => {
    const baseline = flattenStrings(zh.CountryPolicies);
    for (const translation of [en.CountryPolicies, ru.CountryPolicies]) {
      const translated = flattenStrings(translation);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(baseline).sort());
      for (const [key, value] of Object.entries(baseline)) {
        expect(translated[key].trim(), key).not.toBe('');
        expect(placeholders(translated[key]), key).toEqual(placeholders(value));
      }
    }
    for (const { code } of countries)
      expect(Object.keys(baseline).some((key) => key.startsWith(`${code}.`))).toBe(true);
  });

  it('every selectable policy message resolves in all three languages', () => {
    const translations = [zh, en, ru].map((messages) => flattenStrings(messages.CountryPolicies));
    const emitted = new Set<string>();
    for (const { code } of countries) {
      for (const powertrain of ['petrol', 'diesel', 'hev', 'phev', 'erev', 'bev'] as const) {
        for (const importerType of ['individual', 'company'] as const) {
          for (const manufactureDate of ['2012-01', '2020-01', '2022-01', '2025-01']) {
            for (const steering of ['left', 'right'] as const) {
              for (const key of notes(code, {
                powertrain,
                importerType,
                manufactureDate,
                steering,
                displacementCc: '3001',
              }))
                emitted.add(key);
            }
          }
        }
      }
    }
    for (const manufactureDate of ['2026-03', '2025-01'])
      for (const key of notes('UZ', { condition: 'new', manufactureDate })) emitted.add(key);
    for (const key of emitted) {
      for (const translation of translations) expect(translation[key], key).toBeTypeOf('string');
    }
    // Ensures the scenario matrix reaches every country note, not just common defaults.
    const countryKeys = Object.keys(translations[0]).filter((key) => /^[A-Z]{2}\./.test(key));
    expect([...emitted].sort()).toEqual(countryKeys.sort());
  });
});
