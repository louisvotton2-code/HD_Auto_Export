import type { CalculationInput, CountryCode } from '../core/types';
import { ageInMonths, parseCustomsDate, parseManufactureMonth } from '../core/dates';

const baseNotes: Record<CountryCode, readonly string[]> = {
  RU: ['RU.personalScope', 'RU.excluded'],
  KZ: ['KZ.serviceEstimate', 'KZ.excluded'],
  UZ: ['UZ.condition', 'UZ.excise', 'UZ.freightBasis', 'UZ.excluded'],
  GE: ['GE.taxBasis'],
  AM: ['AM.personalScope', 'AM.environment', 'AM.excise', 'AM.age', 'AM.excluded'],
  KG: ['KG.exchange', 'KG.excluded'],
  AL: ['AL.personalScope', 'AL.luxury', 'AL.exchange', 'AL.excluded'],
};

export function getCountryReferenceUrl(country: CountryCode): string {
  const slugs: Record<CountryCode, string> = {
    RU: '',
    KZ: '/kazakhstan',
    UZ: '/uzbekistan',
    GE: '/georgia',
    AM: '/armenia',
    KG: '/kyrgyzstan',
    AL: '/albania',
  };
  return `https://www.kmotors.shop/en/calculator${slugs[country]}`;
}

/** Presentation notes from the observed reference tool, never eligibility decisions. */
export function getCountryReferenceNotes(input: CalculationInput): string[] {
  const notes = [...baseNotes[input.country]];
  const electric = input.powertrain === 'bev';
  const hybrid = ['hev', 'phev', 'erev'].includes(input.powertrain);
  const manufacture = parseManufactureMonth(input.manufactureDate);
  const customs = parseCustomsDate(input.customsDate);
  const validAge = manufacture && customs && ageInMonths(manufacture, customs) >= 0;
  const months = validAge ? ageInMonths(manufacture, customs) : null;
  const years = validAge ? customs.year - manufacture.year : null;
  // Only used to select explanatory messages; never calculates a payable amount.
  const cc = /^\d+(?:\.\d+)?$/.test(input.displacementCc) ? Number(input.displacementCc) : null;

  if (input.country === 'RU') {
    if (electric) notes.push('RU.electric');
    else {
      if (hybrid) notes.push('RU.hybrid');
      if (months !== null && months >= 36 && months < 60) notes.push('RU.middleAge');
    }
  }
  if (input.country === 'KZ') {
    notes.push('KZ.luxury');
    if (electric) notes.push('KZ.electric');
    else if (input.powertrain === 'erev') notes.push('KZ.erev');
    else if (months !== null && months > 84) notes.push('KZ.older');
    if (years !== null && years > 2) notes.push('KZ.registration');
  }
  if (input.country === 'UZ') {
    if (electric) notes.push('UZ.electric');
    else if (hybrid) notes.push('UZ.hybrid');
    else if (input.condition === 'new') {
      if (months !== null) notes.push(months <= 12 ? 'UZ.newFuelFresh' : 'UZ.newFuelOlder');
    } else notes.push('UZ.usedFuel');
    if (months !== null && months > 36) notes.push('UZ.older');
  }
  if (input.country === 'GE') {
    if (electric) notes.push('GE.electric');
    else {
      if (years !== null && years > 6) notes.push('GE.older');
      if (hybrid && years !== null)
        notes.push(
          years <= 6 && input.steering === 'left' ? 'GE.hybridRelief' : 'GE.hybridNoRelief',
        );
      if (input.steering === 'right') notes.push('GE.rightHand');
      if (manufacture && manufacture.year < 2013) notes.push('GE.emissions');
    }
  }
  if (input.country === 'AM') {
    if (electric) notes.push('AM.electric');
    else if (years !== null && years < 3 && cc !== null && cc > 2800) {
      if (input.powertrain === 'petrol') notes.push('AM.largePetrol');
      else if (hybrid) notes.push('AM.largeHybrid');
    }
  }
  if (input.country === 'KG') {
    const electricRoute = electric || input.powertrain === 'erev';
    if (electricRoute) notes.push('KG.electricQuota');
    if (input.importerType === 'individual') {
      notes.push('KG.personalLimit', 'KG.personalFee', 'KG.registration');
      if (!electricRoute) notes.push('KG.personalFuel');
    } else {
      notes.push('KG.companyBroker');
      if (electricRoute && years !== null)
        notes.push(years <= 5 ? 'KG.companyElectricYoung' : 'KG.companyElectricOld');
    }
  }
  if (input.country === 'AL') notes.push(electric ? 'AL.electric' : 'AL.minimumValue');
  return notes;
}
