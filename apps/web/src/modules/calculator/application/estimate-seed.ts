import { getCountryByCode } from '../config/countries';
import { CALCULATOR_POWERTRAINS } from './draft';
import type { VehicleEstimateDraft } from './vehicle-estimate';
import { EXCHANGE_CURRENCIES, type ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { parseCustomsDate, parseManufactureMonth } from '../core/dates';

const key = 'hd-estimate';
const maxLength = 6000;
const inputKeys = [
  'country', 'importerType', 'powertrain', 'price', 'currency', 'displacementCc', 'powerHp',
  'manufactureDate', 'customsDate', 'freight', 'insurance', 'steering',
  'transactionRate', 'euroRate', 'usdRate', 'condition',
] as const;

export type VehicleEstimateSeed = {
  version: 1;
  sourceId: string;
  input: VehicleEstimateDraft;
  rates: ExchangeRateSnapshot;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((name) => Object.hasOwn(value, name));
}
function decimal(value: unknown, positive = false): boolean {
  return typeof value === 'string' && /^\d{1,18}(?:\.\d{1,12})?$/.test(value)
    && (!positive || Number(value) > 0);
}

export function parseEstimateRates(value: unknown): ExchangeRateSnapshot | null {
  if (!record(value) || !exactKeys(value, ['status', 'source', 'asOf', 'rates'])
    || !(value.status === 'reference' && value.source === 'reference_snapshot'
      || value.status === 'live' && value.source === 'open.er-api.com')
    || typeof value.asOf !== 'string' || !parseCustomsDate(value.asOf)
    || !record(value.rates) || !exactKeys(value.rates, EXCHANGE_CURRENCIES)
    || value.rates.USD !== '1') return null;
  for (const currency of EXCHANGE_CURRENCIES) {
    const rate = value.rates[currency];
    // The existing reference cross-rate keeps Decimal's 40 significant digits.
    if (typeof rate !== 'string' || !/^\d{1,18}(?:\.\d{1,40})?$/.test(rate)
      || Number(rate) <= 0) return null;
  }
  return value as ExchangeRateSnapshot;
}

/** A same-country saved draft retains its display/conversion snapshot, including GE/USD. */
export function readStoredEstimateRates(raw: string | null, country: string): ExchangeRateSnapshot | null {
  if (!raw || raw.length > 12_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return record(value) && record(value.input) && value.input.country === country
      ? parseEstimateRates(value.rates) : null;
  } catch { return null; }
}

/** Untrusted fragment data is validated independently of stored calculator drafts. */
export function parseVehicleEstimateSeed(value: unknown): VehicleEstimateSeed | null {
  if (!record(value) || !exactKeys(value, ['version', 'sourceId', 'input', 'rates'])
    || value.version !== 1 || typeof value.sourceId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value.sourceId)
    || !record(value.input) || !exactKeys(value.input, inputKeys)
    || !record(value.rates)) return null;
  const input = value.input;
  for (const field of inputKeys) if (typeof input[field] !== 'string' || input[field].length > 64) return null;
  if (!getCountryByCode(String(input.country))
    || !['individual', 'company'].includes(String(input.importerType))
    || !['', ...CALCULATOR_POWERTRAINS].includes(String(input.powertrain))
    || !['USD', 'CNY'].includes(String(input.currency))
    || !['', 'left', 'right'].includes(String(input.steering))
    || !['', 'new', 'used'].includes(String(input.condition))) return null;
  for (const field of ['price', 'displacementCc', 'powerHp', 'freight', 'insurance'] as const)
    if (input[field] !== '' && !decimal(input[field])) return null;
  for (const field of ['transactionRate', 'euroRate', 'usdRate'] as const)
    if (!decimal(input[field], true)) return null;
  if ((input.manufactureDate !== '' && !parseManufactureMonth(input.manufactureDate as string))
    || !parseCustomsDate(input.customsDate as string)) return null;
  if (!parseEstimateRates(value.rates)) return null;
  return value as unknown as VehicleEstimateSeed;
}

export function createVehicleEstimateFragment(seed: VehicleEstimateSeed): string | null {
  if (!parseVehicleEstimateSeed(seed)) return null;
  const fragment = `#${key}=${encodeURIComponent(JSON.stringify(seed))}`;
  return fragment.length <= maxLength ? fragment : null;
}

/** Preserve unrelated fragment parameters; malformed or wrong-country seeds are never consumed. */
export function readVehicleEstimateFragment(hash: string, country: string): {
  seed: VehicleEstimateSeed;
  remainingHash: string;
} | null {
  if (!hash.startsWith('#') || hash.length > maxLength) return null;
  const parts = hash.slice(1).split('&');
  const entries = parts.filter((part) => part.startsWith(`${key}=`));
  if (entries.length !== 1) return null;
  try {
    const seed = parseVehicleEstimateSeed(JSON.parse(decodeURIComponent(entries[0].slice(key.length + 1))));
    if (!seed || seed.input.country !== country) return null;
    const rest = parts.filter((part) => part !== entries[0]).join('&');
    return { seed, remainingHash: rest ? `#${rest}` : '' };
  } catch {
    return null;
  }
}
