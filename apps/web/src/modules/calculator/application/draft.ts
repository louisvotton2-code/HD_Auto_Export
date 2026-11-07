import type { CountryRecord } from '../config/countries';
import type { CalculationInput, Powertrain } from '../core/types';
import { deriveRates, type ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { convertTransactionPrice, createDefaultInput } from './defaults';

export const CALCULATOR_DRAFT_STORAGE_KEY = 'hd-auto.calculator.draft.v2';
export const LEGACY_CALCULATOR_DRAFT_STORAGE_KEY = 'aurex.calculator.draft.v1';
export const CALCULATOR_POWERTRAINS: readonly Powertrain[] = [
  'petrol',
  'diesel',
  'hev',
  'phev',
  'erev',
  'bev',
];

export interface StoredCalculatorDraft {
  current: string | null;
  legacy?: string | null;
}

export interface RestoredCalculatorDraft {
  input: CalculationInput;
  manualRates: boolean;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Restores editable facts from untrusted stored JSON without browser or clock access.
 * The caller supplies storage contents, current route, date and exchange snapshot.
 * Invalid field text remains editable for normal input validation; invalid shapes do
 * not become facts. Only same-country drafts can restore identity or manual rates.
 */
export function restoreCalculatorDraft(
  raw: StoredCalculatorDraft,
  country: CountryRecord,
  date: string,
  rates: ExchangeRateSnapshot,
): RestoredCalculatorDraft {
  const fallback = createDefaultInput(country.code, date, rates);
  try {
    const current = Boolean(raw.current);
    const record: unknown = JSON.parse(raw.current || raw.legacy || 'null');
    if (!object(record)) return { input: fallback, manualRates: false };
    const draft = current ? record.input : record;
    if (!object(draft)) return { input: fallback, manualRates: false };
    const next = { ...fallback };
    let restoredPrice = false;
    for (const key of [
      'price',
      'displacementCc',
      'powerHp',
      'manufactureDate',
      'customsDate',
      'freight',
      'insurance',
    ] as const) {
      if (
        typeof draft[key] === 'string' &&
        draft[key].length <= 64 &&
        (current || draft[key].trim())
      ) {
        next[key] = draft[key];
        if (key === 'price') restoredPrice = true;
      }
    }
    if (draft.currency === 'CNY' || draft.currency === 'USD') next.currency = draft.currency;
    if (!restoredPrice && next.currency !== fallback.currency) {
      next.price = convertTransactionPrice(fallback.price, fallback.currency, next.currency, rates);
    }
    if (
      country.hasImporterChoice &&
      draft.country === country.code &&
      (draft.importerType === 'individual' || draft.importerType === 'company')
    )
      next.importerType = draft.importerType;
    if (draft.steering === 'left' || draft.steering === 'right') next.steering = draft.steering;
    if (draft.condition === 'new' || draft.condition === 'used') next.condition = draft.condition;
    if (CALCULATOR_POWERTRAINS.includes(draft.powertrain as Powertrain))
      next.powertrain = draft.powertrain as Powertrain;
    const manualRates =
      draft.country === country.code &&
      (current ? record.manualRates === true : Boolean(draft.transactionRate));
    Object.assign(next, deriveRates(rates, country.code, next.currency));
    if (manualRates) {
      for (const key of ['transactionRate', 'euroRate', 'usdRate'] as const)
        if (typeof draft[key] === 'string' && draft[key].length <= 64) next[key] = draft[key];
    }
    return { input: next, manualRates };
  } catch {
    return { input: fallback, manualRates: false };
  }
}
