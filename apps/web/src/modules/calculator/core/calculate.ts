import { calculateGeReference, GE_REFERENCE_VERSION } from '../policies/ge/reference';
import { calculateRuReference, RU_REFERENCE_VERSION } from '../policies/ru/reference';
import { calculateKzReference, KZ_REFERENCE_VERSION } from '../policies/kz/reference';
import { calculateUzReference, UZ_REFERENCE_VERSION } from '../policies/uz/reference';
import { calculateKgReference, KG_REFERENCE_VERSION } from '../policies/kg/reference';
import { calculateAmReference, AM_REFERENCE_VERSION } from '../policies/am/reference';
import { calculateAlReference, AL_REFERENCE_VERSION } from '../policies/al/reference';
import { ageInMonths, parseCustomsDate, parseManufactureMonth } from './dates';
import { Amount } from './decimal';
import type {
  CalculationInput,
  CalculationResult,
  CountryCode,
  ReferencePolicyResult,
} from './types';

const CURRENCIES: Record<CountryCode, string> = {
  RU: 'RUB',
  KZ: 'KZT',
  UZ: 'UZS',
  GE: 'GEL',
  AM: 'AMD',
  KG: 'KGS',
  AL: 'ALL',
};
const FREIGHT_COUNTRIES = new Set<CountryCode>(['UZ', 'AM', 'KG', 'AL']);
type NumericField =
  | 'price'
  | 'displacementCc'
  | 'powerHp'
  | 'transactionRate'
  | 'euroRate'
  | 'usdRate'
  | 'freight'
  | 'insurance';

/** Pure, deterministic 2026 reference preview. Dates and exchange rates are explicit. */
export function calculateImportEstimate(input: CalculationInput): CalculationResult {
  // The two new optional fields preserve compatibility with the initial API contract.
  const facts: CalculationInput = {
    ...input,
    condition: input.condition ?? 'used',
    usdRate: input.currency === 'USD' ? input.transactionRate : (input.usdRate ?? ''),
  };
  const result: CalculationResult = {
    status: 'incomplete',
    currency: CURRENCIES[input.country] ?? '',
    lines: [],
    total: null,
    missingFields: [],
    fieldErrors: {},
    reason: null,
    ruleVersion: null,
    quality: 'reference_only',
    excludedCosts: [
      'vehicle_price',
      'freight',
      'insurance',
      'china_export_costs',
      'unlisted_destination_services',
    ],
    additionalCosts: [],
    assumptions: [],
  };
  if (!['KZ', 'UZ', 'AL'].includes(input.country)) result.excludedCosts.push('registration');
  const required = new Set<keyof CalculationInput>([
    'country',
    'importerType',
    'powertrain',
    'customsDate',
  ]);
  if (input.country !== 'AL') required.add('manufactureDate');
  const active = input.importerType === 'individual' || input.country === 'KG';
  const electric = input.powertrain === 'bev';
  const seriesInKg = input.country === 'KG' && input.powertrain === 'erev';
  const numericFields = new Set<NumericField>();
  if (active) {
    if (input.country === 'GE') {
      required.add('steering');
    } else {
      required.add('currency');
      numericFields.add('price');
      numericFields.add('transactionRate');
    }
    if (!electric && !seriesInKg) numericFields.add('displacementCc');
    if (input.country === 'RU') {
      numericFields.add('powerHp');
      if (!electric) numericFields.add('euroRate');
    }
    if (['KZ', 'KG', 'AM'].includes(input.country)) numericFields.add('euroRate');
    if (input.country === 'UZ') {
      numericFields.add('usdRate');
      required.add('condition');
    }
    for (const field of numericFields) required.add(field);
    if (FREIGHT_COUNTRIES.has(input.country)) {
      // Unknown transport is an explicit estimate assumption, never a complete cost quote.
      for (const field of ['freight', 'insurance'] as const) {
        if (typeof facts[field] === 'string') facts[field] = facts[field].trim();
        if (typeof facts[field] === 'string' && facts[field]) numericFields.add(field);
        else if (facts[field] !== '' && typeof facts[field] !== 'string') numericFields.add(field);
      }
    }
  }
  for (const field of required) {
    if (typeof facts[field] !== 'string' || facts[field]!.trim() === '')
      result.missingFields.push(field);
  }
  const enums: Partial<Record<keyof CalculationInput, readonly string[]>> = {
    country: Object.keys(CURRENCIES),
    importerType: ['individual', 'company'],
    powertrain: ['petrol', 'diesel', 'hev', 'phev', 'erev', 'bev'],
    currency: ['CNY', 'USD'],
    steering: ['left', 'right'],
    condition: ['new', 'used'],
  };
  for (const [field, values] of Object.entries(enums)) {
    if (!required.has(field as keyof CalculationInput)) continue;
    const value = facts[field as keyof CalculationInput];
    if (typeof value === 'string' && value.trim() && !values.includes(value))
      result.fieldErrors[field] = 'invalid_option';
  }
  for (const field of numericFields) {
    const value = facts[field];
    if (typeof value !== 'string') {
      if (['freight', 'insurance'].includes(field) || (value !== undefined && value !== null))
        result.fieldErrors[field] = 'invalid_decimal';
      continue;
    }
    if (!value.trim()) continue;
    if (!/^\d{1,18}(?:\.\d{1,12})?$/.test(value.trim()))
      result.fieldErrors[field] = 'invalid_decimal';
    else if (!['freight', 'insurance'].includes(field) && new Amount(value.trim()).isZero())
      result.fieldErrors[field] = 'must_be_positive';
    else (facts[field] as string) = value.trim();
  }
  const manufactureText =
    typeof input.manufactureDate === 'string' ? input.manufactureDate.trim() : '';
  const customsText = typeof input.customsDate === 'string' ? input.customsDate.trim() : '';
  const manufacture = input.country === 'AL' ? null : parseManufactureMonth(manufactureText);
  const customs = parseCustomsDate(customsText);
  if (
    input.country !== 'AL' &&
    ((manufactureText && !manufacture) ||
      (input.manufactureDate != null && typeof input.manufactureDate !== 'string'))
  )
    result.fieldErrors.manufactureDate = 'invalid_month';
  if (
    (customsText && !customs) ||
    (input.customsDate != null && typeof input.customsDate !== 'string')
  )
    result.fieldErrors.customsDate = 'invalid_date';
  if (manufacture && customs && ageInMonths(manufacture, customs) < 0)
    result.fieldErrors.manufactureDate = 'manufacture_after_customs';
  if (Object.keys(result.fieldErrors).length) return { ...result, status: 'invalid' };
  if (result.missingFields.length) return result;
  const pending = (reason: string): CalculationResult => ({
    ...result,
    status: 'needs_review',
    reason,
  });
  if (input.importerType === 'company' && input.country !== 'KG')
    return pending('company_rules_pending');
  if (customs!.year !== 2026) return pending('rule_date_outside_reference');

  const policyFacts = {
    input: facts,
    ageMonths: manufacture ? ageInMonths(manufacture, customs!) : 0,
    ageYears: manufacture ? customs!.year - manufacture.year : 0,
  };
  let policy: ReferencePolicyResult;
  switch (input.country) {
    case 'RU':
      policy = calculateRuReference(policyFacts);
      result.ruleVersion = RU_REFERENCE_VERSION;
      break;
    case 'KZ':
      policy = calculateKzReference(policyFacts);
      result.ruleVersion = KZ_REFERENCE_VERSION;
      break;
    case 'UZ':
      policy = calculateUzReference(policyFacts);
      result.ruleVersion = UZ_REFERENCE_VERSION;
      break;
    case 'KG':
      policy = calculateKgReference(policyFacts);
      result.ruleVersion = KG_REFERENCE_VERSION;
      break;
    case 'AM':
      policy = calculateAmReference(policyFacts);
      result.ruleVersion = AM_REFERENCE_VERSION;
      break;
    case 'AL':
      policy = calculateAlReference(policyFacts);
      result.ruleVersion = AL_REFERENCE_VERSION;
      break;
    case 'GE':
      policy = {
        lines: calculateGeReference({
          powertrain: input.powertrain,
          displacementCc: facts.displacementCc,
          ageYears: policyFacts.ageYears,
          steering: input.steering,
        }),
        additionalCosts: [],
      };
      result.ruleVersion = GE_REFERENCE_VERSION;
      break;
  }
  result.lines = policy!.lines;
  result.additionalCosts = policy!.additionalCosts;
  if (FREIGHT_COUNTRIES.has(input.country) && (!facts.freight.trim() || !facts.insurance.trim()))
    result.assumptions.push('transport_not_in_tax_base');
  if (input.country === 'AM' && electric) result.assumptions.push('am_electric_relief_assumed');
  if (input.country === 'KG' && (electric || seriesInKg))
    result.assumptions.push('kg_electric_standard_duty');
  if (
    input.country === 'RU' &&
    !electric &&
    new Amount(facts.displacementCc).lte(3000) &&
    new Amount(facts.powerHp).lte(160)
  )
    result.assumptions.push('ru_personal_relief_assumed');
  if (input.country === 'RU' && input.powertrain === 'erev')
    result.assumptions.push('ru_erev_hybrid_assumed');
  return {
    ...result,
    status: 'reference',
    reason: 'reference_preview_only',
    total: result.lines
      .reduce((sum, line) => sum.add(line.amount), new Amount(0))
      .toFixed(input.country === 'KG' ? 2 : 0),
  };
}
