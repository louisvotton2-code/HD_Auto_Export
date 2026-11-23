import { compareEaeuAnniversary, personalCombustionDuty, throughEaeuAnniversary } from '../eaeu-personal';
import { Amount } from '../../core/decimal';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';

export const KG_REFERENCE_VERSION = 'kg-2026.11.23';
export const KG_REFERENCE_SOURCE = 'https://docs.eaeunion.org/documents/317/8824/';

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
export function calculateKgReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  const { input, ageYears } = facts;
  const electric = input.powertrain === 'bev' || input.powertrain === 'erev';
  const personal = input.importerType === 'individual';
  if (!personal && (input.powertrain === 'hev' || input.powertrain === 'phev')) {
    return { reason: 'powertrain_rules_pending', lines: [], additionalCosts: [] };
  }
  const cc = electric ? new Amount(0) : new Amount(input.displacementCc);
  const euroRate = new Amount(input.euroRate);
  const price = new Amount(input.price);
  const transactionValue = personal ? price : price.add(input.freight || '0').add(input.insurance || '0');
  const valueKgs = transactionValue.mul(input.transactionRate);
  const value = valueKgs.div(euroRate).toDecimalPlaces(2);
  const unified = personal && !electric ? personalCombustionDuty('KG', facts) : null;
  let duty: InstanceType<typeof Amount>;
  let dutyFormula: string;
  let dutyMethod: NonNullable<CalculationLine['method']>;

  if (unified) {
    duty = new Amount(unified.amount).div(euroRate);
    dutyFormula = unified.formula;
    dutyMethod = unified.method!;
  } else if (electric || compareEaeuAnniversary(facts, 3) < 0) {
    duty = value.mul('0.15');
    dutyFormula = `${value.toString()} × 0.15`;
    dutyMethod = {
      key: electric ? 'KG.dutyElectric' : 'KG.dutyCompanyYoung',
      params: { value: value.toString(), age: ageYears, rate: 15 },
    };
  } else {
    const bands = input.powertrain === 'diesel' ? DIESEL_CCT : PETROL_CCT;
    const band = bands.find((item) => item.limit === null || cc.lte(item.limit))!;
    if (throughEaeuAnniversary(facts, 7)) {
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
  const vatExempt = !!unified || (electric && compareEaeuAnniversary(facts, 5) < 0);
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

  const boundedFee = Amount.max(500, Amount.min(250000, valueKgs.mul('0.004')));
  return {
    assumptions: electric ? ['kg_electric_standard_duty'] : [],
    lines: [
      unified ?? line('duty', dutyEur, dutyFormula, dutyMethod),
      { id: 'excise', amount: '0.00', formula: '0', method: { key: 'KG.excise', params: {} } },
      line(
        'vat',
        vatEur,
        vatExempt ? '0' : `(${value.toString()} + ${dutyEur.toString()}) × 0.12`,
        {
          key: unified ? 'KG.vatPersonal' : vatExempt ? 'KG.vatElectricExempt' : 'KG.vat',
          params: {
            age: ageYears,
            value: value.toString(),
            duty: dutyEur.toString(),
            taxableBase: value.add(dutyEur).toString(),
            rate: 12,
          },
        },
      ),
      personal ? line('customsFee', feeEur, `${value.toString()} × 0.004`, {
        key: 'KG.customsFee',
        params: { value: value.toString(), rate: '0.4' },
      }) : {
        id: 'customsFee',
        amount: boundedFee.toFixed(2),
        formula: `min(250000, max(500, ${valueKgs} × 0.004))`,
        method: { key: 'KG.companyProcessing', params: { value: valueKgs.toFixed() } },
      },
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
