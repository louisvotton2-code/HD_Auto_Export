import { personalCombustionDuty, throughEaeuAnniversary } from '../eaeu-personal';
import { Amount, roundedAmount } from '../../core/decimal';
import { compareManufactureAnniversary } from '../../core/dates';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';
import {
  RECYCLING_2_TO_3_L_HIGH_POWER,
  RECYCLING_ELECTRIC,
  RECYCLING_OVER_3500,
  RECYCLING_UP_TO_1000,
  RECYCLING_UP_TO_2000,
  RECYCLING_UP_TO_3000,
  RECYCLING_UP_TO_3500,
} from './recycling-rates';

export const RU_REFERENCE_VERSION = 'ru-personal-2026.11.23-v2';

// Article 193, Tax Code of the Russian Federation, passenger-car rates for 2026 (RUB/hp).
const EXCISE_PER_HP = [
  [90, 0], [150, 64], [200, 613], [300, 1004], [400, 1711], [500, 1771], [Infinity, 1829],
] as const;

const CLEARANCE_BANDS = [
  { limit: '200000', fee: '1231' },
  { limit: '450000', fee: '2462' },
  { limit: '1200000', fee: '4924' },
  { limit: '2700000', fee: '13541' },
  { limit: '4200000', fee: '18465' },
  { limit: '5500000', fee: '21344' },
  { limit: '10000000', fee: '49240' },
] as const;

export function calculateRuReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  const { input } = facts;
  if (input.powertrain === 'erev') {
    return { reason: 'powertrain_rules_pending', lines: [], additionalCosts: [] };
  }
  const value = new Amount(input.price).mul(input.transactionRate);
  const electric = input.powertrain === 'bev';
  const duty: CalculationLine = electric
    ? { id: 'duty', amount: roundedAmount(value.mul('0.15')), formula: `round(${value} × 0.15)`,
        method: { key: 'RU.dutyElectric', params: { value: value.toFixed(), percentage: 15 } } }
    : personalCombustionDuty('RU', facts);

  const clearanceBand = CLEARANCE_BANDS.find((item) => value.lte(item.limit));
  const fee = clearanceBand?.fee ?? '73860';
  const clearanceIndex = clearanceBand
    ? CLEARANCE_BANDS.indexOf(clearanceBand)
    : CLEARANCE_BANDS.length;
  const hp = new Amount(input.powerHp);
  const cc = electric ? new Amount(0) : new Amount(input.displacementCc);
  const concession = input.ruPersonalRelief !== 'ineligible' &&
    (electric ? hp.lte(80) : cc.lte(3000) && hp.lte(160));
  const recyclingTable = electric
    ? RECYCLING_ELECTRIC
    : cc.lte('1000')
      ? RECYCLING_UP_TO_1000
      : cc.lte('2000')
        ? RECYCLING_UP_TO_2000
        : cc.lte('3000')
          ? RECYCLING_UP_TO_3000
          : cc.lte('3500')
            ? RECYCLING_UP_TO_3500
            : RECYCLING_OVER_3500;
  // The public form uses metric hp. Compare the converted power at the table's kW precision.
  const powerKw = hp.div('1.35962').toDecimalPlaces(2);
  const officialHighPower = recyclingTable === RECYCLING_UP_TO_3000 &&
    powerKw.gte(RECYCLING_2_TO_3_L_HIGH_POWER.minimumKw);
  const anniversary = officialHighPower
    ? compareManufactureAnniversary(input, facts.ageMonths, 3)
    : undefined;
  // On the first day of the anniversary month, no manufacture day can be over three years old.
  if (anniversary === null && !input.customsDate.endsWith('-01')) {
    return { reason: 'ru_recycling_age_review', lines: [], additionalCosts: [] };
  }
  const row = officialHighPower
    ? RECYCLING_2_TO_3_L_HIGH_POWER.bands.find((item) => item.maxKw === null || powerKw.lte(item.maxKw))!
    : recyclingTable.find((item) => item.maxHp === null || hp.lte(item.maxHp))!;
  const young = anniversary === undefined ? throughEaeuAnniversary(facts, 3) : anniversary !== 1;
  const recyclingCoefficient = concession ? (young ? '0.17' : '0.26') : (young ? row.fresh : row.aged);
  const assumptions: string[] = [];
  if (officialHighPower) assumptions.push('ru_recycling_payment_date_assumed');
  if (concession && !input.ruPersonalRelief) assumptions.push('ru_personal_relief_assumed');
  if (input.powertrain === 'hev' || input.powertrain === 'phev') assumptions.push('ru_hybrid_certified_power');
  const taxes = [duty];
  if (electric) {
    assumptions.push('ru_certified_electric_power');
    const [, rate] = EXCISE_PER_HP.find(([limit]) => hp.lte(limit))!;
    const excise = roundedAmount(hp.mul(rate));
    const vatBase = value.add(duty.amount).add(excise);
    taxes.push(
      { id: 'excise', amount: excise, formula: `round(${hp} × ${rate})`,
        method: { key: 'RU.electricExcise', params: { hp: hp.toFixed(), rate } } },
      { id: 'vat', amount: roundedAmount(vatBase.mul('0.22')), formula: `round((${value} + ${duty.amount} + ${excise}) × 0.22)`,
        method: { key: 'RU.electricVat', params: { value: value.toFixed(), duty: duty.amount, excise } } },
    );
  }
  return {
    assumptions,
    lines: [
      ...taxes,
      {
        id: 'customsFee',
        amount: fee,
        formula: `clearance_band(${value.toString()}) = ${fee}`,
        method: {
          key: clearanceBand ? 'RU.customsFee' : 'RU.customsFeeTop',
          params: {
            value: value.toString(),
            lower: clearanceIndex === 0 ? '0' : CLEARANCE_BANDS[clearanceIndex - 1].limit,
            ...(clearanceBand ? { upper: clearanceBand.limit } : {}),
            fee,
          },
        },
      },
      {
        id: 'recycling',
        amount: roundedAmount(new Amount('20000').mul(recyclingCoefficient)),
        formula: `20000 × ${recyclingCoefficient}`,
        method: {
          key: officialHighPower ? 'RU.recyclingOfficialHighPower'
            : concession ? 'RU.recyclingConcession' : 'RU.recyclingTable',
          params: {
            hp: hp.toFixed(), coefficient: recyclingCoefficient, base: '20000',
            ...(officialHighPower ? { kw: powerKw.toFixed(2) } : {}),
          },
        },
      },
    ],
    additionalCosts: [],
  };
}
