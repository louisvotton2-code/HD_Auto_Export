import { DESTINATION_COUNTRIES, DESTINATION_COUNTRY_CODES } from '@/shared/lib/destination-country';
import { COUNTRY_CURRENCIES, type CountryCurrency } from '../core/country-currencies';
import type { CountryCode } from '../core/types';

export type { CountryCurrency } from '../core/country-currencies';
export type { CountryCode } from '../core/types';

interface CountryCapabilities {
  /** Matches the calculator's visible choices and may cover only part of the legal regime. */
  hasImporterChoice: boolean;
  personalReference: boolean;
  /** At least one reference scenario is supported. */
  referenceAvailable: boolean;
  needsPrice: boolean;
  needsPower: boolean;
  needsEuroRate: boolean;
  needsUsdRate?: boolean;
  needsManufactureDate: boolean;
  needsFreight: boolean;
  needsSteering: boolean;
}

export interface CountryRecord extends CountryCapabilities {
  code: CountryCode;
  slug: string;
  currency: CountryCurrency;
  flag: string;
}

const defaultCapabilities: CountryCapabilities = {
  hasImporterChoice: false,
  personalReference: false,
  referenceAvailable: true,
  needsPrice: true,
  needsPower: false,
  needsEuroRate: false,
  needsManufactureDate: true,
  needsFreight: false,
  needsSteering: false,
};

const countryCapabilities = {
  KG: { hasImporterChoice: true, needsEuroRate: true, needsFreight: true },
  UZ: { needsUsdRate: true, needsFreight: true },
  KZ: { needsEuroRate: true },
  TJ: { personalReference: true, needsEuroRate: true, needsUsdRate: true },
  TM: { personalReference: true, needsUsdRate: true, needsSteering: true },
  RU: { personalReference: true, needsPower: true, needsEuroRate: true },
  GE: { needsPrice: false, needsSteering: true },
  AM: { personalReference: true, needsEuroRate: true },
  AL: { personalReference: true, needsManufactureDate: false, needsFreight: true },
} satisfies Record<CountryCode, Partial<CountryCapabilities>>;

const countryFlags = {
  KG: '🇰🇬', UZ: '🇺🇿', KZ: '🇰🇿', TJ: '🇹🇯', TM: '🇹🇲',
  RU: '🇷🇺', GE: '🇬🇪', AM: '🇦🇲', AL: '🇦🇱',
} satisfies Record<CountryCode, string>;

export const countries: readonly CountryRecord[] = DESTINATION_COUNTRY_CODES.map(code => ({
  ...defaultCapabilities,
  ...countryCapabilities[code],
  code,
  slug: DESTINATION_COUNTRIES[code],
  currency: COUNTRY_CURRENCIES[code],
  flag: countryFlags[code],
}));

export function getCountryBySlug(slug: string): CountryRecord | undefined {
  return countries.find((country) => country.slug === slug);
}

export function getCountryByCode(code: string): CountryRecord | undefined {
  return countries.find((country) => country.code === code);
}
