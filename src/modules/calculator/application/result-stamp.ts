import { ageInMonths, parseCustomsDate, parseManufactureMonth } from '../core/dates';
import { Amount } from '../core/decimal';
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
  const manufacture = parseManufactureMonth(input.manufactureDate.trim());
  if (!customs || (input.country !== 'AL' && !manufacture)) return pending;
  const months = manufacture ? ageInMonths(manufacture, customs) : 0;
  if (input.country !== 'AL' && months < 0) return pending;
  const years = manufacture ? customs.year - manufacture.year : 0;
  const electric = input.powertrain === 'bev';
  const hybrid = ['hev', 'phev', 'erev'].includes(input.powertrain);
  const propulsion = text(electric ? 'electric' : hybrid ? 'hybrid' : 'fuel');
  // Consume the policy's selected charge instead of recreating its luxury thresholds.
  const charged = (id: string) => {
    const amount = result.lines.find((line) => line.id === id)?.amount;
    return amount !== undefined && new Amount(amount).gt(0);
  };
  const base = {
    country: input.country,
    tone: 'gold' as const,
    year: String(customs.year),
  };
  switch (input.country) {
    case 'RU':
      return {
        ...base,
        tone: electric ? 'blue' : 'gold',
        title: text(electric ? 'electricSchedule' : 'personalTariff'),
        subtitle: text(months < 36 ? 'under3' : months < 60 ? 'ruMiddle' : 'fivePlus'),
        condition: electric
          ? propulsion
          : result.assumptions.includes('ru_personal_relief_assumed')
            ? text('personalRecyclingAssumed')
            : text('standardRecycling'),
      };
    case 'KZ':
      return {
        ...base,
        tone: electric || input.powertrain === 'erev' ? 'blue' : 'gold',
        title: text(charged('luxuryExcise') ? 'luxurySchedule' : 'commonTariff'),
        subtitle: text(months > 84 ? 'over7' : 'upTo7'),
        condition: text(
          electric ? 'electric' : input.powertrain === 'erev' ? 'seriesHybrid' : 'fuelSchedule',
        ),
      };
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
    case 'AM':
      return {
        ...base,
        tone: electric ? 'blue' : hybrid ? 'green' : 'gold',
        title: text(electric ? 'electricReliefAssumed' : 'commonTariff'),
        subtitle: text(years < 3 ? 'under3' : years < 7 ? 'amMiddle' : 'sevenPlus'),
        condition: text(
          electric || hybrid || years <= 5
            ? 'environmentNone'
            : years <= 10
              ? 'environment2'
              : years <= 15
                ? 'environment10'
                : 'environment20',
        ),
      };
    case 'KG': {
      const personal = input.importerType === 'individual';
      const electricSchedule = electric || input.powertrain === 'erev';
      return {
        ...base,
        tone: electricSchedule ? 'blue' : 'gold',
        title: text(personal ? 'personalSchedule' : 'companySchedule'),
        subtitle: text(
          years <= 3
            ? 'upTo3'
            : personal
              ? years <= 5
                ? 'kgPersonalMiddle'
                : 'over5'
              : years <= 7
                ? 'kgCompanyMiddle'
                : 'over7',
        ),
        condition: text(
          electricSchedule
            ? personal || years <= 5
              ? 'electricStandard'
              : 'electricWithVat'
            : 'fuelSchedule',
        ),
      };
    }
    case 'AL':
      return {
        ...base,
        tone: electric ? 'blue' : 'gold',
        title: text(charged('luxuryOnce') ? 'luxurySchedule' : 'vat20'),
        subtitle: text(electric ? 'electricValue' : 'minimumValue'),
        condition: text(charged('luxuryOnce') ? 'annualTaxExtra' : 'registrationIncluded'),
      };
  }
}
