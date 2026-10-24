import { Amount } from '../../core/decimal';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';

/** Competitor research snapshot; not an official eligibility or customs ruling. */
export const KG_REFERENCE_VERSION = 'kg-reference-2026.10.22-v1';
export const KG_REFERENCE_SOURCE = 'https://www.kmotors.shop/en/calculator/kyrgyzstan';

const PERSONAL_NEW = [
  { limit: '8500', rate: '0.54', minimum: '2.5' },
  { limit: '16700', rate: '0.48', minimum: '3.5' },
  { limit: '42300', rate: '0.48', minimum: '5.5' },
  { limit: '84500', rate: '0.48', minimum: '7.5' },
  { limit: '169000', rate: '0.48', minimum: '15' },
  { limit: null, rate: '0.48', minimum: '20' },
] as const;

const PERSONAL_CC = [
  { limit: '1000', middle: '1.5', old: '3' },
  { limit: '1500', middle: '1.7', old: '3.2' },
  { limit: '1800', middle: '2.5', old: '3.5' },
  { limit: '2300', middle: '2.7', old: '4.8' },
  { limit: '3000', middle: '3', old: '5' },
  { limit: null, middle: '3.6', old: '5.7' },
] as const;

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

/** All facts and validation come from the common core; no implicit date or FX lookup. */
export function calculateKgReference({
  input,
  ageYears,
}: ReferencePolicyFacts): ReferencePolicyResult {
  const electric = input.powertrain === 'bev' || input.powertrain === 'erev';
  const personal = input.importerType === 'individual';
  const cc = electric ? new Amount(0) : new Amount(input.displacementCc);
  const euroRate = new Amount(input.euroRate);
  const transactionValue = new Amount(input.price)
    .add(input.freight || '0')
    .add(input.insurance || '0');
  // Missing transport is an explicit estimate assumption added by the common core.
  const value = transactionValue.mul(input.transactionRate).div(euroRate).toDecimalPlaces(2);
  let duty: InstanceType<typeof Amount>;
  let dutyFormula: string;
  let dutyMethod: NonNullable<CalculationLine['method']>;

  if (electric || (!personal && ageYears <= 3)) {
    duty = value.mul('0.15');
    dutyFormula = `${value.toString()} × 0.15`;
    dutyMethod = {
      key: electric ? 'KG.dutyElectric' : 'KG.dutyCompanyYoung',
      params: { value: value.toString(), age: ageYears, rate: 15 },
    };
  } else if (personal && ageYears <= 3) {
    const band = PERSONAL_NEW.find((item) => item.limit === null || value.lte(item.limit))!;
    duty = Amount.max(value.mul(band.rate), cc.mul(band.minimum));
    dutyFormula = `max(${value.toString()} × ${band.rate}, ${cc.toString()} × ${band.minimum})`;
    dutyMethod = {
      key: 'KG.dutyPersonalYoung',
      params: {
        age: ageYears,
        value: value.toString(),
        rate: new Amount(band.rate).mul(100).toString(),
        cc: cc.toString(),
        perCc: band.minimum,
        percentage: value.mul(band.rate).toString(),
        minimum: cc.mul(band.minimum).toString(),
        selected: duty.toString(),
      },
    };
  } else if (personal) {
    const band = PERSONAL_CC.find((item) => item.limit === null || cc.lte(item.limit))!;
    const perCc = ageYears <= 5 ? band.middle : band.old;
    duty = cc.mul(perCc);
    dutyFormula = `${cc.toString()} × ${perCc}`;
    dutyMethod = {
      key: ageYears <= 5 ? 'KG.dutyPersonalMiddle' : 'KG.dutyPersonalOld',
      params: { age: ageYears, cc: cc.toString(), perCc },
    };
  } else {
    const bands = input.powertrain === 'diesel' ? DIESEL_CCT : PETROL_CCT;
    const band = bands.find((item) => item.limit === null || cc.lte(item.limit))!;
    if (ageYears <= 7) {
      duty = Amount.max(value.mul('0.2'), cc.mul(band.middle));
      dutyFormula = `max(${value.toString()} × 0.2, ${cc.toString()} × ${band.middle})`;
      dutyMethod = {
        key: 'KG.dutyCompanyMiddle',
        params: {
          age: ageYears,
          value: value.toString(),
          rate: 20,
          cc: cc.toString(),
          perCc: band.middle,
          percentage: value.mul('0.2').toString(),
          minimum: cc.mul(band.middle).toString(),
          selected: duty.toString(),
        },
      };
    } else {
      duty = cc.mul(band.old);
      dutyFormula = `${cc.toString()} × ${band.old}`;
      dutyMethod = {
        key: 'KG.dutyCompanyOld',
        params: { age: ageYears, cc: cc.toString(), perCc: band.old },
      };
    }
  }

  const dutyEur = duty.toDecimalPlaces(2);
  const vatExempt = personal || (electric && ageYears <= 5);
  const vatEur = vatExempt ? new Amount(0) : value.add(dutyEur).mul('0.12').toDecimalPlaces(2);
  const feeEur = value.mul('0.004').toDecimalPlaces(2);
  const line = (
    id: string,
    eur: InstanceType<typeof Amount>,
    formula: string,
    method: NonNullable<CalculationLine['method']>,
  ): CalculationLine => ({
    id,
    amount: eur.mul(euroRate).toFixed(2),
    formula: `round2(round2(${formula}) × ${euroRate.toString()})`,
    method: {
      ...method,
      params: { ...method.params, eurAmount: eur.toFixed(2), euroRate: euroRate.toString() },
    },
  });

  return {
    lines: [
      line('duty', dutyEur, dutyFormula, dutyMethod),
      { id: 'excise', amount: '0.00', formula: '0', method: { key: 'KG.excise', params: {} } },
      line(
        'vat',
        vatEur,
        vatExempt ? '0' : `(${value.toString()} + ${dutyEur.toString()}) × 0.12`,
        {
          key: personal ? 'KG.vatPersonal' : vatExempt ? 'KG.vatElectricExempt' : 'KG.vat',
          params: {
            age: ageYears,
            value: value.toString(),
            duty: dutyEur.toString(),
            taxableBase: value.add(dutyEur).toString(),
            rate: 12,
          },
        },
      ),
      line('customsFee', feeEur, `${value.toString()} × 0.004`, {
        key: 'KG.customsFee',
        params: { value: value.toString(), rate: '0.4' },
      }),
    ],
    additionalCosts: personal
      ? [
          {
            ...line(
              'registrationEstimate',
              value.mul('0.05').toDecimalPlaces(2),
              `${value.toString()} × 0.05`,
              { key: 'KG.registrationEstimate', params: { value: value.toString(), rate: 5 } },
            ),
            kind: 'one_time_estimate',
          },
        ]
      : [],
  };
}
