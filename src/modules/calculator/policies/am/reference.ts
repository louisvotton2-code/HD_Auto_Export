import { Amount, roundedAmount } from '../../core/decimal';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';

/** 2026 reference snapshot; the common core gates the provisional EV exemption. */
export const AM_REFERENCE_VERSION = 'am-personal-reference-2026.10.22-v1';
export const AM_REFERENCE_SOURCE = 'https://www.kmotors.shop/en/calculator/armenia';

const PETROL_CCT = [
  { limit: '1000', middle: '0.36', old: '1.4' },
  { limit: '1500', middle: '0.4', old: '1.5' },
  { limit: '1800', middle: '0.36', old: '1.6' },
  { limit: '3000', middle: '0.44', old: '2.2' },
  { limit: null, middle: '0.8', old: '3.2' },
] as const;
const DIESEL_CCT = [
  { limit: '1500', middle: '0.32', old: '1.5' },
  { limit: '2500', middle: '0.4', old: '2.2' },
  { limit: null, middle: '0.8', old: '3.2' },
] as const;

export function calculateAmReference({
  input,
  ageYears,
}: ReferencePolicyFacts): ReferencePolicyResult {
  const electric = input.powertrain === 'bev';
  const hybrid = ['hev', 'phev', 'erev'].includes(input.powertrain);
  const cc = electric ? new Amount(0) : new Amount(input.displacementCc);
  const value = new Amount(
    roundedAmount(
      new Amount(input.price)
        .add(input.freight || '0')
        .add(input.insurance || '0')
        .mul(input.transactionRate),
    ),
  );
  const euroRate = new Amount(input.euroRate);
  let duty: InstanceType<typeof Amount>;
  let dutyFormula: string;
  let dutyMethod: NonNullable<CalculationLine['method']>;
  if (electric) {
    // Provisional quota/VAT eligibility is an explicit common-core assumption, not a fact.
    duty = new Amount(0);
    dutyFormula = '0';
    dutyMethod = { key: 'AM.dutyElectric', params: {} };
  } else if (ageYears < 3) {
    const rate = input.powertrain === 'petrol' && cc.gt('2800') ? '0.125' : '0.15';
    duty = value.mul(rate);
    dutyFormula = `${value.toString()} × ${rate}`;
    dutyMethod = {
      key: rate === '0.125' ? 'AM.dutyYoungLargePetrol' : 'AM.dutyYoung',
      params: {
        age: ageYears,
        value: value.toString(),
        cc: cc.toString(),
        rate: new Amount(rate).mul(100).toString(),
      },
    };
  } else {
    const bands = input.powertrain === 'diesel' ? DIESEL_CCT : PETROL_CCT;
    const band = bands.find((item) => item.limit === null || cc.lte(item.limit))!;
    if (ageYears < 7) {
      duty = Amount.max(value.mul('0.2'), cc.mul(band.middle).mul(euroRate));
      dutyFormula = `max(${value.toString()} × 0.2, ${cc.toString()} × ${band.middle} × ${euroRate.toString()})`;
      dutyMethod = {
        key: 'AM.dutyMiddle',
        params: {
          age: ageYears,
          value: value.toString(),
          cc: cc.toString(),
          rate: 20,
          perCc: band.middle,
          euroRate: euroRate.toString(),
          percentage: value.mul('0.2').toString(),
          minimum: cc.mul(band.middle).mul(euroRate).toString(),
          selected: duty.toString(),
        },
      };
    } else {
      duty = cc.mul(band.old).mul(euroRate);
      dutyFormula = `${cc.toString()} × ${band.old} × ${euroRate.toString()}`;
      dutyMethod = {
        key: 'AM.dutyOld',
        params: {
          age: ageYears,
          cc: cc.toString(),
          perCc: band.old,
          euroRate: euroRate.toString(),
        },
      };
    }
  }
  const roundedDuty = roundedAmount(duty);
  const environmentalRate =
    electric || hybrid || ageYears <= 5
      ? '0'
      : ageYears <= 10
        ? '0.02'
        : ageYears <= 15
          ? '0.1'
          : '0.2';
  return {
    lines: [
      { id: 'duty', amount: roundedDuty, formula: `round(${dutyFormula})`, method: dutyMethod },
      { id: 'excise', amount: '0', formula: '0', method: { key: 'AM.excise', params: {} } },
      {
        id: 'vat',
        amount: electric ? '0' : roundedAmount(value.add(roundedDuty).mul('0.2')),
        formula: electric ? '0' : `round((${value.toString()} + ${roundedDuty}) × 0.2)`,
        method: electric
          ? { key: 'AM.vatElectric', params: {} }
          : {
              key: 'AM.vat',
              params: {
                value: value.toString(),
                duty: roundedDuty,
                taxableBase: value.add(roundedDuty).toString(),
                rate: 20,
              },
            },
      },
      {
        id: 'environmental',
        amount: roundedAmount(value.mul(environmentalRate)),
        formula: `round(${value.toString()} × ${environmentalRate})`,
        method: {
          key: electric
            ? 'AM.environmentalElectric'
            : hybrid
              ? 'AM.environmentalHybrid'
              : ageYears <= 5
                ? 'AM.environmentalYoung'
                : 'AM.environmental',
          params: {
            age: ageYears,
            value: value.toString(),
            rate: new Amount(environmentalRate).mul(100).toString(),
          },
        },
      },
    ],
    additionalCosts: [],
  };
}
