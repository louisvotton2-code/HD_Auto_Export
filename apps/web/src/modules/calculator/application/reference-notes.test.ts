import { expect, it } from 'vitest';
import zh from '../../../messages/zh.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import { countries } from '../config/countries';
import { createDefaultInput } from './defaults';
import { getCountryOfficialSources, getCountryReferenceNotes } from './reference-notes';

it.each(countries)('publishes official evidence and localizes the method limits for $code', ({ code }) => {
  for (const dictionary of [zh, en, ru]) {
    for (const key of getCountryReferenceNotes(createDefaultInput(code, '2026-11-23'))) {
      const [, field] = key.split('.') as [string, 'manual' | 'scope'];
      expect(dictionary.CountryPolicies[code][field]).not.toBe('');
    }
  }
  const sources = getCountryOfficialSources(code);
  expect(sources.length).toBeGreaterThan(1);
  for (const { url } of sources) {
    expect(new URL(url).protocol).toBe('https:');
    expect(url).not.toContain('kmotors.shop');
  }
});
