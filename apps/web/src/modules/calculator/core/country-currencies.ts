import type { CountryCode } from './types';

export const COUNTRY_CURRENCIES = {
  RU: 'RUB', KZ: 'KZT', UZ: 'UZS', GE: 'GEL', AM: 'AMD', KG: 'KGS', AL: 'ALL',
  TJ: 'TJS', TM: 'TMT',
} as const satisfies Record<CountryCode, string>;

export type CountryCurrency = (typeof COUNTRY_CURRENCIES)[CountryCode];
