import { daysInMonth } from '../core/dates';
import { Amount } from '../core/decimal';
import type { CalculationLine, ReferencePolicyFacts } from '../core/types';

const valueBands = [
  [8500, '0.54', '2.5'], [16700, '0.48', '3.5'], [42300, '0.48', '5.5'],
  [84500, '0.48', '7.5'], [169000, '0.48', '15'], [Infinity, '0.48', '20'],
] as const;
const displacementBands = [
  [1000, '1.5', '3'], [1500, '1.7', '3.2'], [1800, '2.5', '3.5'],
  [2300, '2.7', '4.8'], [3000, '3', '5'], [Infinity, '3.6', '5.7'],
] as const;

/** Decision 74: an evidenced manufacture month without an exact day uses its 15th. */
export function compareEaeuAnniversary({ input, ageMonths }: ReferencePolicyFacts, years: number) {
  const monthDifference = ageMonths - years * 12;
  if (monthDifference !== 0) return monthDifference;
  const month = input.manufactureDate.slice(0, 7);
  const knownDay = input.manufactureDay?.startsWith(month + '-') ? input.manufactureDay : undefined;
  const productionDay = Number(knownDay?.slice(-2) ?? '15');
  const [year, clearanceMonth, clearanceDay] = input.customsDate.split('-').map(Number);
  const lastDay = daysInMonth(year, clearanceMonth);
  return clearanceDay - Math.min(productionDay, lastDay);
}

export function throughEaeuAnniversary(facts: ReferencePolicyFacts, years: number) {
  return compareEaeuAnniversary(facts, years) <= 0;
}

/** Decision 107, Annex 2 table 2; article 267 excludes separately stated freight/insurance. */
export function personalCombustionDuty(
  country: 'RU' | 'KG' | 'AM' | 'KZ',
  facts: ReferencePolicyFacts,
): CalculationLine {
  const { input } = facts;
  const cc = new Amount(input.displacementCc);
  const euroRate = new Amount(input.euroRate);
  const value = new Amount(input.price).mul(input.transactionRate);
  const decimals = country === 'KG' ? 2 : 0;
  if (throughEaeuAnniversary(facts, 3)) {
    const euroValue = value.div(euroRate);
    const [, rate, minimum] = valueBands.find(([limit]) => euroValue.lte(limit))!;
    const charge = Amount.max(value.mul(rate), cc.mul(minimum).mul(euroRate));
    return {
      id: 'duty', amount: charge.toFixed(decimals),
      formula: `max(${value} × ${rate}, ${cc} × ${minimum} × ${euroRate})`,
      method: { key: `${country}.unifiedYoung`, params: {
        cc: cc.toFixed(), euroRate: euroRate.toFixed(), rate: new Amount(rate).mul(100).toFixed(), minimum,
        euroValue: euroValue.toFixed(), percentageDuty: euroValue.mul(rate).toFixed(), minimumDuty: cc.mul(minimum).toFixed(),
      } },
    };
  }
  const [, middle, old] = displacementBands.find(([limit]) => cc.lte(limit))!;
  const rate = throughEaeuAnniversary(facts, 5) ? middle : old;
  return {
    id: 'duty', amount: cc.mul(rate).mul(euroRate).toFixed(decimals),
    formula: `${cc} × ${rate} × ${euroRate}`,
    method: { key: `${country}.unifiedUsed`, params: { cc: cc.toFixed(), rate, euroRate: euroRate.toFixed() } },
  };
}
