import { Amount } from '../core/decimal';
import { tariffLine } from '../core/tariff-line';
import type { ReferencePolicyFacts } from '../core/types';

const valueBands = [
  [8500, '0.54', '2.5'], [16700, '0.48', '3.5'], [42300, '0.48', '5.5'],
  [84500, '0.48', '7.5'], [169000, '0.48', '15'], [Infinity, '0.48', '20'],
] as const;
const displacementBands = [
  [1000, '1.5', '3'], [1500, '1.7', '3.2'], [1800, '2.5', '3.5'],
  [2300, '2.7', '4.8'], [3000, '3', '5'], [Infinity, '3.6', '5.7'],
] as const;

export function ordinaryCombustion({ input }: ReferencePolicyFacts) {
  return input.powertrain === 'petrol' || input.powertrain === 'diesel';
}

export function throughEaeuAnniversary({ input, ageMonths }: ReferencePolicyFacts, years: number) {
  const manufactureDay = input.manufactureDate.length === 10 ? Number(input.manufactureDate.slice(-2)) : 15;
  return ageMonths < years * 12 || ageMonths === years * 12 && Number(input.customsDate.slice(-2)) <= manufactureDay;
}

/** Annex 2 to EEC Council Decision 107, table 2, ordinary personal-use combustion car. */
export function personalCombustionDuty(country: 'RU' | 'KG' | 'AM', { input, ageMonths }: ReferencePolicyFacts) {
  // Decision 74 uses day 15 when the supporting evidence gives a month alone.
  const cc = new Amount(input.displacementCc);
  const euroRate = new Amount(input.euroRate);
  const value = new Amount(input.price).mul(input.transactionRate);
  const euroValue = value.div(euroRate);
  const facts = { input, ageMonths, ageYears: Math.floor(ageMonths / 12) };
  if (throughEaeuAnniversary(facts, 3)) {
    const [, rate, minimum] = valueBands.find(([limit]) => euroValue.lte(limit))!;
    const charge = Amount.max(euroValue.mul(rate), cc.mul(minimum)).mul(euroRate);
    return tariffLine('duty', charge, `max((${value} / ${euroRate}) × ${rate}, ${cc} × ${minimum}) × ${euroRate}`,
      `${country}.unifiedYoung`, { cc: cc.toFixed(), euroRate: euroRate.toFixed(),
        rate: new Amount(rate).mul(100).toFixed(), minimum });
  }
  const [, middle, old] = displacementBands.find(([limit]) => cc.lte(limit))!;
  const rate = throughEaeuAnniversary(facts, 5) ? middle : old;
  return tariffLine('duty', cc.mul(rate).mul(euroRate), `${cc} × ${rate} × ${euroRate}`,
    `${country}.unifiedUsed`, { cc: cc.toFixed(), rate, euroRate: euroRate.toFixed() });
}
