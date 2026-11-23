import type { CalculationInput, CountryCode } from '../core/types';
import { ageInMonths, parseCustomsDate, parseManufactureMonth } from '../core/dates';
import { applyDocumentedYear } from '../core/documented-facts';
import { throughEaeuAnniversary } from '../policies/eaeu-personal';

const baseNotes: Record<CountryCode, readonly string[]> = {
  RU: ['RU.personalScope', 'RU.excluded'],
  KZ: ['KZ.declaration', 'KZ.serviceEstimate', 'KZ.excluded'],
  UZ: ['UZ.condition', 'UZ.registration', 'UZ.excise', 'UZ.freightBasis', 'UZ.excluded'],
  GE: ['GE.taxBasis', 'GE.origin'],
  AM: ['AM.personalScope', 'AM.environment', 'AM.age', 'AM.excluded'],
  KG: ['KG.exchange', 'KG.excluded'],
  AL: ['AL.personalScope', 'AL.luxury', 'AL.exchange', 'AL.excluded'],
  TJ: ['TJ.scope', 'TJ.value', 'TJ.vat', 'TJ.ev'],
  TM: ['TM.scope', 'TM.value', 'TM.hybrids', 'TM.admission'],
};

const primarySources: Record<CountryCode, string> = {
  RU: 'https://docs.eaeunion.org/documents/317/8824/',
  KZ: 'https://www.gov.kz/org/kgd/activities/10380?lang=ru',
  UZ: 'https://lex.uz/ru/docs/3802363',
  GE: 'https://matsne.gov.ge/ka/document/view/6826443',
  AM: 'https://exim.src.am/ru/transport',
  KG: 'https://docs.eaeunion.org/documents/317/8824/',
  AL: 'https://www.dogana.gov.al/english/c/179/customs-clearance-of-vehicles',
  TJ: 'https://mmih.adlia.tj/Search/DocumentView?DocumentId=169398',
  TM: 'https://www.customs.gov.tm/index.php/ru/customs-info/customs-fees/duties',
};

const additionalSources = {
  TJ: [
    { name: '№ 470', url: 'https://new.edavlat.tj/api/files_storage/3467' },
    { name: '№ 335', url: primarySources.TJ },
    { name: '№ 1844', url: 'https://andoz.tj/docs/kodex/Tax-Code__17_12_2025-RT_ru.pdf' },
    { name: '№ 472', url: 'https://tajtrade.tj/media/%E2%84%96472%20%D0%BE%D1%82%2002.12.2005%D0%B3..pdf' },
    { name: '№ 476', url: 'https://www.andoz.tj/docs/postanovleniya-pravitelstvo/Qaror_476_2025_tj.pdf' },
  ],
  TM: [
    { name: '61', url: primarySources.TM },
    { name: '119', url: 'https://mejlis.gov.tm/single-code/10?lang=ru' },
    { name: '230', url: 'https://mejlis.gov.tm/single-code/11?lang=ru' },
    { name: '0.2%', url: 'https://www.customs.gov.tm/ru/customs-info/customs-fees/fees' },
    { name: '638/197/275', url: 'https://www.customs.gov.tm/index.php/tk/customs-info/customs-control/68' },
  ],
};

export function getCountryOfficialSources(country: CountryCode) {
  return country === 'TJ' || country === 'TM' ? additionalSources[country] : [];
}

export function getCountryReferenceUrl(country: CountryCode): string {
  return primarySources[country];
}

/** Scope and qualifications shown alongside the estimate; the policy owns the monetary result. */
export function getCountryReferenceNotes(rawInput: CalculationInput): string[] {
  const input = applyDocumentedYear(rawInput);
  const notes = [...baseNotes[input.country]];
  const electric = input.powertrain === 'bev';
  const hybrid = ['hev', 'phev', 'erev'].includes(input.powertrain);
  const manufacture = parseManufactureMonth(input.manufactureDate);
  const customs = parseCustomsDate(input.customsDate);
  const validAge = manufacture && customs && ageInMonths(manufacture, customs) >= 0;
  const months = validAge ? ageInMonths(manufacture, customs) : null;
  const years = validAge ? customs.year - manufacture.year : null;
  if (input.country === 'RU') {
    if (electric) notes.push('RU.electric');
    else {
      if (hybrid) notes.push('RU.hybrid');
      if (months !== null && years !== null) {
        const facts = { input, ageMonths: months, ageYears: years };
        if (!throughEaeuAnniversary(facts, 3) && throughEaeuAnniversary(facts, 5)) notes.push('RU.middleAge');
      }
    }
  }
  if (input.country === 'KZ') {
    notes.push('KZ.luxury');
    if (electric) notes.push('KZ.electric');
    else if (input.powertrain === 'erev') notes.push('KZ.erev');
    if (years !== null && years > 2) notes.push('KZ.registration');
  }
  if (input.country === 'UZ') {
    if (electric) notes.push('UZ.electric');
    else if (hybrid) notes.push('UZ.hybrid');
    else notes.push(input.condition === 'new' ? 'UZ.newFuel' : 'UZ.usedFuel');
  }
  if (input.country === 'GE') {
    const convertedOrRight = input.steeringConverted === 'yes' || input.steering === 'right';
    const prior = customs && (input.customsDate < '2026-04-02' || input.gePriorScheduleEligible === 'approved');
    if (prior) notes.push('GE.prior');
    if (electric) notes.push('GE.electric');
    else {
      if (!prior && years !== null && years > 6) notes.push('GE.older');
      if ((input.powertrain === 'hev' || input.powertrain === 'phev') && years !== null) {
        notes.push(years <= 6 && !convertedOrRight ? 'GE.hybridRelief' : 'GE.hybridNoRelief');
      }
      if (convertedOrRight) notes.push('GE.rightHand');
      if (manufacture && manufacture.year < 2013) notes.push('GE.emissions');
    }
  }
  if (input.country === 'AM' && electric) notes.push('AM.electric');
  if (input.country === 'KG') {
    const electricRoute = electric || input.powertrain === 'erev';
    if (electricRoute) notes.push('KG.electricQuota');
    if (input.importerType === 'individual') {
      notes.push('KG.personalFee', 'KG.registration');
      if (!electricRoute) notes.push('KG.personalFuel');
    } else notes.push('KG.companyBroker');
  }
  if (input.country === 'AL') notes.push(electric ? 'AL.electric' : 'AL.minimumValue');
  return notes;
}
