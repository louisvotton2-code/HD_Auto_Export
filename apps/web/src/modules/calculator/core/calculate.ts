import { applyDocumentedYear, invalidDocumentedFields } from './documented-facts';
import { calculateGeReference, GE_REFERENCE_VERSION } from '../policies/ge/reference';
import { calculateRuReference, RU_REFERENCE_VERSION } from '../policies/ru/reference';
import { calculateKzReference, KZ_REFERENCE_VERSION } from '../policies/kz/reference';
import { calculateUzReference, UZ_REFERENCE_VERSION } from '../policies/uz/reference';
import { calculateKgReference, KG_REFERENCE_VERSION } from '../policies/kg/reference';
import { calculateAmReference, AM_REFERENCE_VERSION } from '../policies/am/reference';
import { calculateAlReference, AL_REFERENCE_VERSION } from '../policies/al/reference';
import { calculateTjReference, TJ_REFERENCE_VERSION } from '../policies/tj/reference';
import { calculateTmReference, TM_REFERENCE_VERSION } from '../policies/tm/reference';
import { ageInMonths, parseCustomsDate, parseManufactureMonth } from './dates';
import { Amount } from './decimal';
import { COUNTRY_CURRENCIES } from './country-currencies';
import { needsTajikTariffInputs, TAJIK_TARIFF_FIELDS, type TajikTariffField } from './tajik-input';
import type {
  CalculationInput,
  CalculationResult,
  CountryCode,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from './types';

const POLICIES = {
  RU: { version: RU_REFERENCE_VERSION, calculate: calculateRuReference },
  KZ: { version: KZ_REFERENCE_VERSION, calculate: calculateKzReference },
  UZ: { version: UZ_REFERENCE_VERSION, calculate: calculateUzReference },
  KG: { version: KG_REFERENCE_VERSION, calculate: calculateKgReference },
  AM: { version: AM_REFERENCE_VERSION, calculate: calculateAmReference },
  AL: { version: AL_REFERENCE_VERSION, calculate: calculateAlReference },
  TJ: { version: TJ_REFERENCE_VERSION, calculate: calculateTjReference },
  TM: { version: TM_REFERENCE_VERSION, calculate: calculateTmReference },
  GE: { version: GE_REFERENCE_VERSION, calculate: calculateGeReference },
} satisfies Record<CountryCode, { version: string; calculate: (facts: ReferencePolicyFacts) => ReferencePolicyResult }>;

const FREIGHT_COUNTRIES = new Set<CountryCode>(['UZ', 'AM', 'KG', 'AL']);
type NumericField =
  | 'price'
  | 'displacementCc'
  | 'powerHp'
  | 'transactionRate'
  | 'euroRate'
  | 'usdRate'
  | 'freight'
  | 'insurance'
  | TajikTariffField;
const zeroAllowed = new Set<NumericField>(['freight', 'insurance', ...TAJIK_TARIFF_FIELDS]);

/** Pure, deterministic 2026 reference preview. Dates and exchange rates are explicit. */
export function calculateImportEstimate(raw: CalculationInput): CalculationResult {
  const input = applyDocumentedYear({
    ...raw,
    manufactureDate: typeof raw.manufactureDate === 'string' ? raw.manufactureDate.trim() : raw.manufactureDate,
    customsDate: typeof raw.customsDate === 'string' ? raw.customsDate.trim() : raw.customsDate,
  });
  // The two new optional fields preserve compatibility with the initial API contract.
  const facts: CalculationInput = {
    ...input,
    condition: input.condition ?? 'used',
    usdRate: input.currency === 'USD' ? input.transactionRate : (input.usdRate ?? ''),
  };
  const result: CalculationResult = {
    status: 'incomplete',
    currency: Object.hasOwn(COUNTRY_CURRENCIES, input.country) ? COUNTRY_CURRENCIES[input.country] : '',
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
  const active = input.importerType === 'individual' || ['KG', 'KZ'].includes(input.country);
  const electric = input.powertrain === 'bev';
  const seriesInKg = input.country === 'KG' && input.powertrain === 'erev';
  const usesFreight = (FREIGHT_COUNTRIES.has(input.country)
    && !(input.country === 'KG' && input.importerType === 'individual')
    && input.country !== 'AM')
    || (input.country === 'KZ' && (electric || input.importerType === 'company' || input.kzDeclaration === 'goods'));
  const numericFields = new Set<NumericField>();
  if (active) {
    if (input.country === 'GE' || input.country === 'TM') required.add('steering');
    if (input.country !== 'GE') {
      required.add('currency');
      numericFields.add('price');
      numericFields.add('transactionRate');
    }
    if (!electric && !seriesInKg) numericFields.add('displacementCc');
    if (input.country === 'RU') {
      numericFields.add('powerHp');
      if (!electric) numericFields.add('euroRate');
    }
    if (input.country === 'KG' || (!electric && ['KZ', 'AM'].includes(input.country))) numericFields.add('euroRate');
    if (needsTajikTariffInputs(input.country, input.powertrain)) {
      numericFields.add('euroRate');
      TAJIK_TARIFF_FIELDS.forEach(field => numericFields.add(field));
    }
    if (['UZ', 'TJ', 'TM'].includes(input.country)) numericFields.add('usdRate');
    if (input.country === 'UZ') required.add('condition');
    for (const field of numericFields) required.add(field);
    if (usesFreight || FREIGHT_COUNTRIES.has(input.country)) {
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
    country: Object.keys(COUNTRY_CURRENCIES),
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
    else if (!zeroAllowed.has(field) && new Amount(value.trim()).isZero())
      result.fieldErrors[field] = 'must_be_positive';
    else if ((field === 'tjDutyPercent' || field === 'tjExcisePercent') && new Amount(value.trim()).gt(100))
      result.fieldErrors[field] = 'invalid_decimal';
    else (facts[field] as string) = value.trim();
  }
  for (const field of invalidDocumentedFields({ ...input })) result.fieldErrors[field] = 'invalid_option';
  if (input.country !== 'AL' && typeof input.manufactureDay === 'string' && input.customsDate && input.manufactureDay > input.customsDate)
    result.fieldErrors.manufactureDate = 'manufacture_after_customs';
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
  if (input.importerType === 'company' && !['KG', 'KZ'].includes(input.country))
    return pending('company_rules_pending');
  if (customs!.year !== 2026) return pending('rule_date_outside_reference');

  const policyFacts = {
    input: facts,
    ageMonths: manufacture ? ageInMonths(manufacture, customs!) : 0,
    ageYears: manufacture ? customs!.year - manufacture.year : 0,
  };
  const { calculate, version } = POLICIES[input.country];
  const policy: ReferencePolicyResult = calculate(policyFacts);
  result.ruleVersion = version;
  result.lines = policy.lines;
  result.additionalCosts = policy.additionalCosts;
  result.assumptions = [...(policy.assumptions ?? [])];
  if (policy.reason) return pending(policy.reason);
  if (input.manufactureYear && input.manufactureDay === input.manufactureYear + '-07-01')
    result.assumptions.push('eaeu_documented_year');
  if (usesFreight && (!facts.freight.trim() || !facts.insurance.trim()))
    result.assumptions.push('transport_not_in_tax_base');
  return {
    ...result,
    status: 'reference',
    reason: 'reference_preview_only',
    total: result.lines
      .reduce((sum, line) => sum.add(line.amount), new Amount(0))
      .toFixed(['GE', 'KG', 'TJ', 'TM'].includes(input.country) ? 2 : 0),
  };
}
