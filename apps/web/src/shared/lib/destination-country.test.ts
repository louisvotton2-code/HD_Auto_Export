import { describe, expect, it } from 'vitest';
import { DESTINATION_COUNTRY_STORAGE_KEY, destinationCalculatorPath, destinationCountryFromLocation, isDestinationCountry,
  readDestinationCountry, resolveDestinationCountry, writeDestinationCountry } from './destination-country';

describe('destination country preference boundary', () => {
  it('accepts only whitelisted scalar country codes', () => {
    for (const value of ['CN', 'russia', 'ru', '{"country":"KZ","price":123}', { country: 'RU' }, null, '__proto__']) expect(isDestinationCountry(value)).toBe(false);
    expect(isDestinationCountry('KG')).toBe(true);
  });
  it('uses current/explicit country before stored preference and falls back without requiring a write', () => {
    expect(resolveDestinationCountry('UZ', 'KZ')).toBe('UZ');
    expect(resolveDestinationCountry(undefined, 'KZ')).toBe('KZ');
    expect(resolveDestinationCountry(undefined, 'invalid')).toBe('RU');
  });
  it('recognizes only supported explicit destination URLs', () => {
    expect(destinationCountryFromLocation('/en/calculator/kyrgyzstan/', '?country=KZ')).toBe('KG');
    expect(destinationCountryFromLocation('/ru/cars/id/', '?country=UZ')).toBe('UZ');
    expect(destinationCountryFromLocation('/zh/calculator/', '?country=CN')).toBeUndefined();
    expect(destinationCalculatorPath('AL')).toBe('/calculator/albania/');
  });
  it('reads and writes only the isolated code key, preserving no vehicle draft data', () => {
    const writes: [string, string][] = [];
    const storage = { getItem: (key: string) => key === DESTINATION_COUNTRY_STORAGE_KEY ? 'AM' : null, setItem: (key: string, value: string) => writes.push([key, value]) };
    expect(readDestinationCountry(storage)).toBe('AM');
    expect(writes).toEqual([]);
    expect(writeDestinationCountry(storage, 'KZ')).toBe(true);
    expect(writeDestinationCountry(storage, { country: 'RU', price: '100' })).toBe(false);
    expect(writes).toEqual([[DESTINATION_COUNTRY_STORAGE_KEY, 'KZ']]);
  });
  it('remains usable when browser storage is disabled', () => {
    const unavailable = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readDestinationCountry(unavailable)).toBeUndefined();
    expect(writeDestinationCountry(unavailable, 'GE')).toBe(false);
    expect(resolveDestinationCountry(undefined, readDestinationCountry(unavailable))).toBe('RU');
  });
});
