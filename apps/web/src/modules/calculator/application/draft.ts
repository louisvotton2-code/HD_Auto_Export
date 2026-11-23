import type { CountryRecord } from '../config/countries';
import type { CalculationInput, Powertrain } from '../core/types';
import { TAJIK_TARIFF_FIELDS } from '../core/tajik-input';
import { deriveRates, type ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import { convertTransactionPrice, createDefaultInput } from './defaults';
import { documentedFields, invalidDocumentedFields } from '../core/documented-facts';
import { parseCustomsDate } from '../core/dates';
import { powerBasis } from './power-basis';
import { readManufactureEstimate } from './manufacture-estimate';

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

export function isEnginePowerPrefill(marker: unknown, powertrain: unknown, powerHp: unknown): boolean {
  return marker === true && powertrain !== 'bev'
    && CALCULATOR_POWERTRAINS.includes(powertrain as Powertrain)
    && typeof powerHp === 'string' && /^\d{1,18}(?:\.\d{1,12})?$/.test(powerHp) && Number(powerHp) > 0;
}

export function createCalculatorFormInput(country: CountryRecord, date: string, rates: ExchangeRateSnapshot): CalculationInput {
  const defaults = createDefaultInput(country.code, date, rates);
  // Standalone examples have admissible sample dates. Vehicle-detail seeds keep unknown dates blank.
  if (country.code === 'TM') return defaults;
  if (country.code === 'TJ') return { ...defaults, manufactureDate: `${date.slice(0, 4)}-01` };
  return { ...defaults, manufactureDate: '' };
}

export interface StoredCalculatorDraft {
  current: string | null;
  legacy?: string | null;
}

export interface RestoredCalculatorDraft {
  input: CalculationInput;
  manualRates: boolean;
  enginePowerPrefill?: true;
  customsDateEdited?: true;
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
  const fallback = createCalculatorFormInput(country, date, rates);
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
      'freight',
      'insurance',
    ] as const) {
      // The TJ price field is an assessed customs value and is specific to that route.
      if (key === 'price' && draft.country === 'TJ' && country.code !== 'TJ') continue;
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
    // Current UI drafts can explicitly leave missing vehicle facts unselected.
    // The core's required-field validation accepts empty text; do not invent a fact on refresh.
    if (draft.steering === 'left' || draft.steering === 'right' || current && draft.steering === '')
      next.steering = draft.steering as CalculationInput['steering'];
    if (draft.condition === 'new' || draft.condition === 'used' || current && draft.condition === '')
      next.condition = draft.condition as CalculationInput['condition'];
    if (CALCULATOR_POWERTRAINS.includes(draft.powertrain as Powertrain) || current && draft.powertrain === '')
      next.powertrain = draft.powertrain as Powertrain;
    const manualRates =
      draft.country === country.code &&
      (current ? record.manualRates === true : Boolean(draft.transactionRate));
    Object.assign(next, deriveRates(rates, country.code, next.currency));
    if (manualRates) {
      for (const key of ['transactionRate', 'euroRate', 'usdRate'] as const)
        if (typeof draft[key] === 'string' && draft[key].length <= 64) next[key] = draft[key];
    }
    if (country.code === 'TJ' && draft.country === country.code) {
      for (const key of TAJIK_TARIFF_FIELDS)
        if (typeof draft[key] === 'string' && draft[key].length <= 64) next[key] = draft[key];
    }
    if (current && readManufactureEstimate(record.manufactureEstimate, draft.manufactureDate)) next.manufactureDate = '';
    const invalid = invalidDocumentedFields(draft);
    for (const field of documentedFields) {
      const transfer = ['manufactureDay', 'manufactureYear', 'vehicleRegistration', 'mileageKm', 'seatCount', 'steeringConverted'].includes(field);
      if (draft[field] !== undefined && !invalid.includes(field) && (transfer || draft.country === country.code)
        && (field !== 'manufactureDay' || next.manufactureDate === draft.manufactureDate))
        Object.assign(next, { [field]: draft[field] });
    }
    if (country.code === 'AL' && draft.country !== 'AL')
      next.condition = next.vehicleRegistration === 'never_registered' ? 'new' : 'used';
    if (country.code === 'RU' && powerBasis(next.powertrain) !== 'power' && next.ruPowerBasis !== 'declared')
      next.powerHp = '';
    const customsDateEdited = current && record.customsDateEdited === true
      && typeof draft.customsDate === 'string' && (draft.customsDate === '' || !!parseCustomsDate(draft.customsDate));
    if (customsDateEdited) next.customsDate = draft.customsDate as string;
    const enginePowerPrefill = current && draft.powerHp === next.powerHp
      && isEnginePowerPrefill(record.enginePowerPrefill, next.powertrain, next.powerHp);
    return { input: next, manualRates, ...(customsDateEdited ? { customsDateEdited: true } : {}), ...(enginePowerPrefill ? { enginePowerPrefill: true } : {}) };
  } catch {
    return { input: fallback, manualRates: false };
  }
}
