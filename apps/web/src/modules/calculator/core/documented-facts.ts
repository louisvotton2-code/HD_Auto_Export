import { parseCustomsDate } from './dates';
import type { CalculationInput } from './types';

type Validator = (value: string, input: Record<string, unknown>) => boolean;
const checks = {
  manufactureDay: (s, i) => Boolean(parseCustomsDate(s)) && s.slice(0, 7) === i.manufactureDate,
  manufactureYear: s => /^[1-9]\d{3}$/.test(s),
  vehicleRegistration: s => s === 'never_registered' || s === 'registered',
  mileageKm: s => /^\d{1,10}$/.test(s),
  seatCount: s => /^[1-9]\d?$/.test(s),
  alRegistrationValueAll: s => /^\d{1,18}(?:\.\d{1,2})?$/.test(s) && Number(s) > 0,
  geChinaOriginPreference: s => s === 'approved',
  gePriorScheduleEligible: s => s === 'approved',
  steeringConverted: s => s === 'yes',
  kzDeclaration: s => ['personal', 'goods', 'wto'].includes(s),
  ruPowerBasis: s => s === 'declared',
  ruPersonalRelief: s => s === 'eligible' || s === 'ineligible',
} satisfies Partial<Record<keyof CalculationInput, Validator>>;

export const documentedFields = Object.keys(checks) as Array<keyof typeof checks>;
export function invalidDocumentedFields(input: Record<string, unknown>) {
  return documentedFields.filter(key => {
    const value = input[key];
    return value !== undefined && (typeof value !== 'string' || !checks[key](value, input));
  });
}

/** Decision 74: a verified year with no month is July 1 on a personal EAEU declaration. */
export function applyDocumentedYear(input: CalculationInput): CalculationInput {
  if (input.manufactureDate || input.manufactureDay !== undefined || !input.manufactureYear || !/^[1-9]\d{3}$/.test(input.manufactureYear)
    || input.importerType !== 'individual' || !['KG', 'KZ', 'RU', 'AM'].includes(input.country)
    || !['petrol', 'diesel', 'hev', 'phev'].includes(input.powertrain) || (input.country === 'KZ' && input.kzDeclaration && input.kzDeclaration !== 'personal'))
    return input;
  return { ...input, manufactureDate: input.manufactureYear + '-07', manufactureDay: input.manufactureYear + '-07-01' };
}
