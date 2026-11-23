import { ageInMonths, parseCustomsDate, parseManufactureMonth } from '../core/dates';
import { applyDocumentedYear } from '../core/documented-facts';
import { throughEaeuAnniversary } from '../policies/eaeu-personal';
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
  rawInput: CalculationInput,
  result: CalculationResult,
): ResultStampDescriptor {
  const input = applyDocumentedYear(rawInput);
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
  const line = (id: string) => result.lines.find(entry => entry.id === id);
  const charged = (id: string) => Number(line(id)?.amount ?? 0) > 0;
  const facts = { input, ageMonths: months, ageYears: years };
  const personalAge = () => text(throughEaeuAnniversary(facts, 3) ? 'upTo3'
    : throughEaeuAnniversary(facts, 5) ? 'kgPersonalMiddle' : 'over5');
  const base = {
    country: input.country,
    tone: 'gold' as const,
    year: String(customs.year),
  };
  switch (input.country) {
    case 'RU':
      return {
        ...base, tone: electric ? 'blue' : 'gold',
        title: text(electric ? 'electricSchedule' : 'personalTariff'), subtitle: personalAge(),
        condition: text(result.assumptions.includes('ru_personal_relief_assumed') ? 'personalRecyclingAssumed'
          : line('recycling')?.method?.key === 'RU.recyclingConcession' ? 'personalRecycling' : 'standardRecycling'),
      };
    case 'KZ': {
      const personal = result.assumptions.includes('kz_personal_declaration');
      return {
        ...base, tone: electric ? 'blue' : 'gold',
        title: text(charged('luxuryExcise') ? 'luxurySchedule' : personal ? 'personalTariff' : 'commonTariff'),
        subtitle: personal ? personalAge() : propulsion,
        condition: personal ? propulsion : text('goodsDeclaration'),
      };
    }
    case 'UZ': {
      const duty = line('duty')?.method?.key;
      const newTitle = duty === 'UZ.dutyHybridNewYoung' || duty === 'UZ.dutyNewYoung' ? 'newUnder12'
        : electric ? 'new' : 'newOver12';
      return {
        ...base, tone: electric ? 'blue' : input.condition === 'new' ? 'green' : 'gold',
        title: text(input.condition === 'new' ? newTitle : 'used'),
        subtitle: text(line('recycling')?.method?.key.endsWith('Old') ? 'recyclingOver36' : 'recyclingUpTo36'),
        condition: propulsion,
      };
    }
    case 'GE': {
      const hybridRelief = line('excise')?.method?.key === 'GE.exciseHybridRelief';
      const converted = input.steeringConverted === 'yes';
      const right = converted || input.steering === 'right';
      return {
        ...base, tone: electric ? 'blue' : hybridRelief ? 'green' : 'gold',
        title: text(electric ? 'electricSchedule' : right ? 'rightHandSchedule' : hybridRelief ? 'hybridRelief' : 'geSchedule'),
        subtitle: text(years > 6 ? 'over6' : 'upTo6'),
        condition: text(converted ? 'convertedSteering' : right ? 'rightHand' : 'leftHand'),
      };
    }
    case 'AM': {
      const rate = line('environmental')?.method?.params.rate;
      return {
        ...base, tone: electric ? 'blue' : hybrid ? 'green' : 'gold',
        title: text(electric ? 'electricSchedule' : 'personalTariff'),
        subtitle: electric ? text(charged('vat') ? 'vat20' : 'vatExempt') : personalAge(),
        condition: rate === undefined ? null : { key: 'environmentRate', params: { rate } },
      };
    }
    case 'KG': {
      const personal = input.importerType === 'individual';
      const electricSchedule = electric || input.powertrain === 'erev';
      const duty = line('duty')?.method?.key;
      const companyAge = duty === 'KG.dutyCompanyMiddle' ? 'kgCompanyMiddle'
        : duty === 'KG.dutyCompanyOld' ? 'over7' : 'companyUnder3';
      return {
        ...base, tone: electricSchedule ? 'blue' : 'gold',
        title: text(personal ? 'personalSchedule' : 'companySchedule'),
        subtitle: electricSchedule ? propulsion : personal ? personalAge() : text(companyAge),
        condition: text(electricSchedule ? (charged('vat') ? 'electricWithVat' : 'electricStandard') : 'fuelSchedule'),
      };
    }
    case 'AL':
      return {
        ...base, tone: electric ? 'blue' : 'gold',
        title: text(charged('luxuryOnce') ? 'luxurySchedule' : line('vat')?.method?.key === 'AL.vatNewElectric' ? 'vatExempt' : 'vat20'),
        subtitle: text('acceptedValue'),
        condition: text(charged('luxuryOnce') ? 'annualTaxExtra' : 'registrationIncluded'),
      };
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
