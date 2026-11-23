import { ageInMonths, parseCustomsDate, parseManufactureDate } from '../core/dates';
import type { CalculationInput, CalculationResult, CountryCode } from '../core/types';
import type { StampMessageKey } from './stamp-messages';

export interface StampText {
  key: StampMessageKey;
  params?: Record<string, string | number>;
}

export interface ResultStampDescriptor {
  country: CountryCode;
  tone: 'gold' | 'green' | 'blue' | 'muted';
  title: StampText;
  subtitle: StampText;
  condition: StampText | null;
  year: string | null;
}

const text = (key: StampMessageKey): StampText => ({ key });

/**
 * Selects receipt labels from the effective inputs and completed reference result.
 * It does not calculate tax, certify an exemption, or make an import eligibility decision.
 */
export function getResultStamp(
  input: CalculationInput,
  result: CalculationResult,
): ResultStampDescriptor {
  const pending: ResultStampDescriptor = {
    country: input.country,
    tone: 'muted',
    title: text(result.status === 'invalid' ? 'invalidInput' : 'pending'),
    subtitle: text(result.status === 'needs_review' ? 'rulesPending' : 'completeInputs'),
    condition: null,
    year: null,
  };
  if (result.status !== 'reference' || result.total === null) return pending;
  const customs = parseCustomsDate(input.customsDate.trim());
  const manufacture = parseManufactureDate(input.manufactureDate.trim());
  if (!customs || (input.country !== 'AL' && !manufacture)) return pending;
  const months = manufacture ? ageInMonths(manufacture, customs) : 0;
  if (input.country !== 'AL' && months < 0) return pending;
  const years = manufacture ? customs.year - manufacture.year : 0;
  const electric = input.powertrain === 'bev';
  const hybrid = ['hev', 'phev', 'erev'].includes(input.powertrain);
  const propulsion = text(electric ? 'electric' : hybrid ? 'hybrid' : 'fuel');
  const base = {
    country: input.country,
    tone: 'gold' as const,
    year: String(customs.year),
  };
  switch (input.country) {
    case 'UZ':
      return {
        ...base,
        tone: electric ? 'blue' : input.condition === 'new' ? 'green' : 'gold',
        title: text(
          input.condition === 'new' ? (months <= 12 ? 'newUnder12' : 'newOver12') : 'used',
        ),
        subtitle: text(months > 36 ? 'recyclingOver36' : 'recyclingUpTo36'),
        condition: propulsion,
      };
    case 'GE': {
      const hybridRelief = hybrid && years <= 6 && input.steering === 'left';
      return {
        ...base,
        tone: electric ? 'blue' : hybridRelief ? 'green' : 'gold',
        title: text(
          electric
            ? 'electricSchedule'
            : input.steering === 'right'
              ? 'rightHandSchedule'
              : hybridRelief
                ? 'hybridRelief'
                : 'geSchedule',
        ),
        subtitle: text(years > 6 ? 'over6' : 'upTo6'),
        condition: text(input.steering === 'right' ? 'rightHand' : 'leftHand'),
      };
    }
    case 'KG':
      return {
        ...base,
        title: text('companySchedule'),
        subtitle: text(months < 84 ? 'kgCompanyMiddle' : 'over7'),
        condition: text('fuelSchedule'),
      };
    case 'RU':
    case 'KZ':
    case 'AM':
    case 'AL':
      return pending;
    case 'TJ':
    case 'TM':
      return {
        ...base,
        tone: electric ? 'blue' : 'gold',
        title: text('personalSchedule'),
        subtitle: text(electric ? 'electricSchedule' : 'fuelSchedule'),
        condition: propulsion,
      };
  }
}
