import type { CountryCode } from '../core/types';
export type { CountryCode } from '../core/types';

/** Country capability flags control fields, not legal or production availability. */
export type CountryCurrency = 'RUB' | 'KZT' | 'UZS' | 'GEL' | 'AMD' | 'KGS' | 'ALL';

export interface CountryRecord {
  code: CountryCode;
  slug: string;
  nameKey: CountryCode;
  currency: CountryCurrency;
  flag: string;
  /** Matches the reference tool's visible choices; does not declare legal coverage. */
  hasImporterChoice: boolean;
  personalReference: boolean;
  /** A limited reference scenario exists; this is not official rule verification. */
  referenceAvailable: boolean;
  needsPrice: boolean;
  needsPower: boolean;
  needsEuroRate: boolean;
  needsManufactureDate: boolean;
  needsFreight: boolean;
  needsSteering: boolean;
}

export const countries: readonly CountryRecord[] = [
  {
    code: 'RU',
    slug: 'russia',
    nameKey: 'RU',
    currency: 'RUB',
    flag: '🇷🇺',
    hasImporterChoice: false,
    personalReference: true,
    referenceAvailable: true,
    needsPrice: true,
    needsPower: true,
    needsEuroRate: true,
    needsManufactureDate: true,
    needsFreight: false,
    needsSteering: false,
  },
  {
    code: 'KZ',
    slug: 'kazakhstan',
    nameKey: 'KZ',
    currency: 'KZT',
    flag: '🇰🇿',
    hasImporterChoice: false,
    personalReference: false,
    referenceAvailable: true,
    needsPrice: true,
    needsPower: false,
    needsEuroRate: true,
    needsManufactureDate: true,
    needsFreight: false,
    needsSteering: false,
  },
  {
    code: 'UZ',
    slug: 'uzbekistan',
    nameKey: 'UZ',
    currency: 'UZS',
    flag: '🇺🇿',
    hasImporterChoice: false,
    personalReference: false,
    referenceAvailable: true,
    needsPrice: true,
    needsPower: false,
    needsEuroRate: false,
    needsManufactureDate: true,
    needsFreight: true,
    needsSteering: false,
  },
  {
    code: 'GE',
    slug: 'georgia',
    nameKey: 'GE',
    currency: 'GEL',
    flag: '🇬🇪',
    hasImporterChoice: false,
    personalReference: false,
    referenceAvailable: true,
    needsPrice: false,
    needsPower: false,
    needsEuroRate: false,
    needsManufactureDate: true,
    needsFreight: false,
    needsSteering: true,
  },
  {
    code: 'AM',
    slug: 'armenia',
    nameKey: 'AM',
    currency: 'AMD',
    flag: '🇦🇲',
    hasImporterChoice: false,
    personalReference: true,
    referenceAvailable: true,
    needsPrice: true,
    needsPower: false,
    needsEuroRate: true,
    needsManufactureDate: true,
    needsFreight: true,
    needsSteering: false,
  },
  {
    code: 'KG',
    slug: 'kyrgyzstan',
    nameKey: 'KG',
    currency: 'KGS',
    flag: '🇰🇬',
    hasImporterChoice: true,
    personalReference: false,
    referenceAvailable: true,
    needsPrice: true,
    needsPower: false,
    needsEuroRate: true,
    needsManufactureDate: true,
    needsFreight: true,
    needsSteering: false,
  },
  {
    code: 'AL',
    slug: 'albania',
    nameKey: 'AL',
    currency: 'ALL',
    flag: '🇦🇱',
    hasImporterChoice: false,
    personalReference: true,
    referenceAvailable: true,
    needsPrice: true,
    needsPower: false,
    needsEuroRate: false,
    needsManufactureDate: false,
    needsFreight: true,
    needsSteering: false,
  },
];

export function getCountryBySlug(slug: string): CountryRecord | undefined {
  return countries.find((country) => country.slug === slug);
}

export function getCountryByCode(code: string): CountryRecord | undefined {
  return countries.find((country) => country.code === code);
}
