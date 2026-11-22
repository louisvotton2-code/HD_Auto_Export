/** Only these public destination codes may be persisted; vehicle facts never belong here. */
export const DESTINATION_COUNTRIES = {
  KG: 'kyrgyzstan',
  UZ: 'uzbekistan',
  KZ: 'kazakhstan',
  TJ: 'tajikistan',
  TM: 'turkmenistan',
  RU: 'russia',
  GE: 'georgia',
  AM: 'armenia',
  AL: 'albania',
} as const;
export type DestinationCountryCode = keyof typeof DESTINATION_COUNTRIES;
export const DESTINATION_COUNTRY_CODES: readonly DestinationCountryCode[] =
  Object.keys(DESTINATION_COUNTRIES) as DestinationCountryCode[];
export const DESTINATION_COUNTRY_STORAGE_KEY = 'hd-auto.destination-country.v1';
export const DESTINATION_COUNTRY_EVENT = 'hd-auto:destination-country';
export const DESTINATION_COUNTRY_URL_EVENT = 'hd-auto:destination-country-url';

export function isDestinationCountry(value: unknown): value is DestinationCountryCode {
  return typeof value === 'string' && Object.hasOwn(DESTINATION_COUNTRIES, value);
}

export function resolveDestinationCountry(explicit: unknown, stored: unknown): DestinationCountryCode {
  return isDestinationCountry(explicit) ? explicit : isDestinationCountry(stored) ? stored : 'RU';
}

export function destinationCountryFromLocation(pathname: string, search = ''): DestinationCountryCode | undefined {
  const match = /^(?:\/(?:zh|en|ru))?\/calculator\/([^/]+)\/?$/.exec(pathname);
  const code = match && DESTINATION_COUNTRY_CODES
    .find(country => DESTINATION_COUNTRIES[country] === match[1]);
  if (code) return code;
  const selected = new URLSearchParams(search).get('country');
  return isDestinationCountry(selected) ? selected : undefined;
}

export function readDestinationCountry(storage: Pick<Storage, 'getItem'>): DestinationCountryCode | undefined {
  try {
    const value = storage.getItem(DESTINATION_COUNTRY_STORAGE_KEY);
    return isDestinationCountry(value) ? value : undefined;
  } catch { return undefined; }
}

export function writeDestinationCountry(storage: Pick<Storage, 'setItem'>, country: unknown): boolean {
  if (!isDestinationCountry(country)) return false;
  try { storage.setItem(DESTINATION_COUNTRY_STORAGE_KEY, country); return true; }
  catch { return false; }
}

export function destinationCalculatorPath(country: DestinationCountryCode): string {
  return `/calculator/${DESTINATION_COUNTRIES[country]}/`;
}
