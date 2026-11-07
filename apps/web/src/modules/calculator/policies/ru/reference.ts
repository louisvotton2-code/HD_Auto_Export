import { Amount, roundedAmount } from '../../core/decimal';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';
import {
  RECYCLING_ELECTRIC,
  RECYCLING_OVER_3500,
  RECYCLING_UP_TO_1000,
  RECYCLING_UP_TO_2000,
  RECYCLING_UP_TO_3000,
  RECYCLING_UP_TO_3500,
} from './recycling-rates';

/** Research snapshot only. No claim that personal concession eligibility is met. */
export const RU_REFERENCE_VERSION = 'ru-personal-reference-2026.10.23-v2';

const NEW_CAR_BANDS = [
  { limit: '8500', percentage: '0.54', minimum: '2.5' },
  { limit: '16700', percentage: '0.48', minimum: '3.5' },
  { limit: '42300', percentage: '0.48', minimum: '5.5' },
  { limit: '84500', percentage: '0.48', minimum: '7.5' },
  { limit: '169000', percentage: '0.48', minimum: '15' },
  { limit: null, percentage: '0.48', minimum: '20' },
] as const;

const DISPLACEMENT_BANDS = [
  { limit: '1000', middle: '1.5', old: '3' },
  { limit: '1500', middle: '1.7', old: '3.2' },
  { limit: '1800', middle: '2.5', old: '3.5' },
  { limit: '2300', middle: '2.7', old: '4.8' },
  { limit: '3000', middle: '3', old: '5' },
  { limit: null, middle: '3.6', old: '5.7' },
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

export function calculateRuReference({
  input,
  ageMonths,
}: ReferencePolicyFacts): ReferencePolicyResult {
  const value = new Amount(input.price).mul(input.transactionRate);
  const electric = input.powertrain === 'bev';
  // The reference has no separate EREV class: HEV, PHEV and EREV follow its
  // hybrid/combustion branch. Classification needs confirmation for real imports.
  let duty = new Amount(0);
  let formula: string;
  let dutyMethod: NonNullable<CalculationLine['method']>;

  if (electric) {
    duty = value.mul('0.15');
    formula = `round(${value.toString()} × 0.15)`;
    dutyMethod = { key: 'RU.dutyElectric', params: { value: value.toString(), percentage: '15' } };
  } else {
    const euroRate = new Amount(input.euroRate);
    const cc = new Amount(input.displacementCc);
    if (ageMonths < 36) {
      const euroValue = value.div(euroRate);
      const band = NEW_CAR_BANDS.find((item) => item.limit === null || euroValue.lte(item.limit))!;
      duty = Amount.max(euroValue.mul(band.percentage), cc.mul(band.minimum)).mul(euroRate);
      formula = `round(max((${value.toString()} / ${euroRate.toString()}) × ${band.percentage}, ${cc.toString()} × ${band.minimum}) × ${euroRate.toString()})`;
      const bandIndex = NEW_CAR_BANDS.indexOf(band);
      dutyMethod = {
        key: band.limit === null ? 'RU.dutyYoungTop' : 'RU.dutyYoung',
        params: {
          ageMonths,
          value: value.toString(),
          euroRate: euroRate.toString(),
          euroValue: euroValue.toString(),
          lower: bandIndex === 0 ? '0' : NEW_CAR_BANDS[bandIndex - 1].limit!,
          ...(band.limit === null ? {} : { upper: band.limit }),
          percentage: new Amount(band.percentage).mul(100).toString(),
          percentageDuty: euroValue.mul(band.percentage).toString(),
          cc: cc.toString(),
          perCc: band.minimum,
          minimumDuty: cc.mul(band.minimum).toString(),
        },
      };
    } else {
      const band = DISPLACEMENT_BANDS.find((item) => item.limit === null || cc.lte(item.limit))!;
      const rate = ageMonths < 60 ? band.middle : band.old;
      duty = cc.mul(rate).mul(euroRate);
      formula = `round(${cc.toString()} × ${rate} × ${euroRate.toString()})`;
      const bandIndex = DISPLACEMENT_BANDS.indexOf(band);
      dutyMethod = {
        key: `RU.duty${ageMonths < 60 ? 'Middle' : 'Old'}${band.limit === null ? 'Top' : ''}`,
        params: {
          ageMonths,
          cc: cc.toString(),
          lower: bandIndex === 0 ? '0' : DISPLACEMENT_BANDS[bandIndex - 1].limit!,
          ...(band.limit === null ? {} : { upper: band.limit }),
          perCc: rate,
          euroRate: euroRate.toString(),
        },
      };
    }
  }

  const clearanceBand = CLEARANCE_BANDS.find((item) => value.lte(item.limit));
  const fee = clearanceBand?.fee ?? '73860';
  const clearanceIndex = clearanceBand
    ? CLEARANCE_BANDS.indexOf(clearanceBand)
    : CLEARANCE_BANDS.length;
  const hp = new Amount(input.powerHp);
  const cc = electric ? new Amount(0) : new Amount(input.displacementCc);
  const concession = !electric && cc.lte('3000') && hp.lte('160');
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
  const row = recyclingTable.find((item) => item.maxHp === null || hp.lte(item.maxHp))!;
  const recyclingCoefficient = concession
    ? ageMonths < 36
      ? '0.17'
      : '0.26'
    : ageMonths < 36
      ? row.fresh
      : row.aged;

  return {
    lines: [
      { id: 'duty', amount: roundedAmount(duty), formula, method: dutyMethod },
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
          key: `RU.recycling${concession ? 'Personal' : electric ? 'Electric' : 'Standard'}${ageMonths < 36 ? 'Young' : 'Aged'}`,
          params: {
            ageMonths,
            hp: hp.toString(),
            ...(electric ? {} : { cc: cc.toString() }),
            coefficient: recyclingCoefficient,
            base: '20000',
          },
        },
      },
    ],
    additionalCosts: [],
  };
}
