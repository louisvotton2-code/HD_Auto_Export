import { Amount, roundedAmount } from '../../core/decimal';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';

/** Competitor research snapshot; this does not certify eligibility or current customs law. */
export const KZ_REFERENCE_VERSION = 'kz-reference-2026.10.22-v1';

const MCI = new Amount('4325');
const LUXURY_THRESHOLD = new Amount('77850000');
const OLD_DUTY_BANDS = [
  { limit: '1000', perCc: '0.36' },
  { limit: '1500', perCc: '0.4' },
  { limit: null, perCc: '0.6' },
] as const;
const RECYCLING_BANDS = [
  { limit: '1000', coefficient: '1.5' },
  { limit: '2000', coefficient: '3.5' },
  { limit: '3000', coefficient: '5' },
  { limit: null, coefficient: '11.5' },
] as const;

export function calculateKzReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  const { input, ageMonths, ageYears } = facts;
  const electric = input.powertrain === 'bev';
  const electricSchedule = electric || input.powertrain === 'erev';
  const cc = new Amount(electric ? '0' : input.displacementCc);
  const value = new Amount(input.price).mul(input.transactionRate);
  const euroRate = new Amount(input.euroRate);
  const customsFee = MCI.mul(6);
  let duty = new Amount(0);
  let dutyFormula = '0';
  let dutyMethod: NonNullable<CalculationLine['method']> = {
    key: 'KZ.dutyElectric',
    params: {},
  };

  if (!electricSchedule) {
    const byValue = value.mul('0.15');
    if (ageMonths > 84) {
      const band = OLD_DUTY_BANDS.find((band) => band.limit === null || cc.lte(band.limit))!;
      const perCc = band.perCc;
      duty = Amount.max(byValue, cc.mul(perCc).mul(euroRate));
      dutyFormula = `round(max(${value.toString()} × 0.15, ${cc.toString()} × ${perCc} × ${euroRate.toString()}))`;
      const bandIndex = OLD_DUTY_BANDS.indexOf(band);
      dutyMethod = {
        key: band.limit === null ? 'KZ.dutyOldTop' : 'KZ.dutyOld',
        params: {
          ageMonths,
          value: value.toString(),
          percentage: '15',
          valueDuty: byValue.toString(),
          cc: cc.toString(),
          perCc,
          euroRate: euroRate.toString(),
          minimumDuty: cc.mul(perCc).mul(euroRate).toString(),
          lower: bandIndex === 0 ? '0' : OLD_DUTY_BANDS[bandIndex - 1].limit!,
          ...(band.limit === null ? {} : { upper: band.limit }),
        },
      };
    } else {
      duty = byValue;
      dutyFormula = `round(${value.toString()} × 0.15)`;
      dutyMethod = {
        key: 'KZ.dutyYoung',
        params: { ageMonths, value: value.toString(), percentage: '15' },
      };
    }
  }

  // EREV follows the electric duty/registration/recycling schedule but retains engine excise.
  const engineExcise = cc.gt(3000) ? cc.mul(100) : new Amount(0);
  const luxuryExcise = value.gt(LUXURY_THRESHOLD)
    ? new Amount(roundedAmount(value.mul('0.1')))
    : new Amount(0);
  // The reference includes the unrounded duty and the rounded luxury excise in the VAT base.
  const vatBase = value.add(duty).add(engineExcise).add(luxuryExcise).add(customsFee);
  const registrationCoefficient =
    ageYears <= 1
      ? '0.25'
      : ageYears <= 2
        ? electricSchedule
          ? '25'
          : '50'
        : electricSchedule
          ? '250'
          : '500';
  const recyclingBand = RECYCLING_BANDS.find((band) => band.limit === null || cc.lte(band.limit))!;
  const recyclingCoefficient = recyclingBand.coefficient;
  const recyclingIndex = RECYCLING_BANDS.indexOf(recyclingBand);

  const lines: CalculationLine[] = [
    {
      id: 'customsFee',
      amount: roundedAmount(customsFee),
      formula: '4325 × 6',
      method: { key: 'KZ.customsFee', params: { mci: MCI.toString(), coefficient: '6' } },
    },
    { id: 'duty', amount: roundedAmount(duty), formula: dutyFormula, method: dutyMethod },
    {
      id: 'excise',
      amount: roundedAmount(engineExcise),
      formula: cc.gt(3000) ? `${cc.toString()} × 100` : '0',
      method: {
        key: electric ? 'KZ.exciseElectric' : cc.gt(3000) ? 'KZ.excise' : 'KZ.exciseZero',
        params: electric ? {} : { cc: cc.toString(), ...(cc.gt(3000) ? { perCc: '100' } : {}) },
      },
    },
    {
      id: 'luxuryExcise',
      amount: roundedAmount(luxuryExcise),
      formula: value.gt(LUXURY_THRESHOLD) ? `round(${value.toString()} × 0.1)` : '0',
      method: {
        key: value.gt(LUXURY_THRESHOLD) ? 'KZ.luxuryExcise' : 'KZ.luxuryExciseZero',
        params: {
          value: value.toString(),
          threshold: LUXURY_THRESHOLD.toString(),
          ...(value.gt(LUXURY_THRESHOLD) ? { percentage: '10' } : {}),
        },
      },
    },
    {
      id: 'vat',
      amount: roundedAmount(vatBase.mul('0.16')),
      formula: `round(${vatBase.toString()} × 0.16)`,
      method: {
        key: 'KZ.vat',
        params: {
          value: value.toString(),
          duty: duty.toString(),
          engineExcise: engineExcise.toString(),
          luxuryExcise: luxuryExcise.toString(),
          customsFee: customsFee.toString(),
          base: vatBase.toString(),
          percentage: '16',
        },
      },
    },
    {
      id: 'registration',
      amount: roundedAmount(MCI.mul(registrationCoefficient)),
      formula: `round(4325 × ${registrationCoefficient})`,
      method: {
        key:
          ageYears <= 1
            ? 'KZ.registrationYoung'
            : `KZ.registration${electricSchedule ? 'Electric' : 'Standard'}${ageYears <= 2 ? 'Middle' : 'Old'}`,
        params: { ageYears, mci: MCI.toString(), coefficient: registrationCoefficient },
      },
    },
    {
      id: 'plates',
      amount: roundedAmount(MCI.mul('4.05')),
      formula: 'round(4325 × (2.8 + 1.25))',
      method: {
        key: 'KZ.plates',
        params: { mci: MCI.toString(), plateCoefficient: '2.8', documentCoefficient: '1.25' },
      },
    },
    {
      id: 'recycling',
      amount: electricSchedule ? '0' : roundedAmount(MCI.mul(50).mul(recyclingCoefficient)),
      formula: electricSchedule ? '0' : `4325 × 50 × ${recyclingCoefficient}`,
      method: {
        key: electricSchedule
          ? 'KZ.recyclingElectric'
          : recyclingBand.limit === null
            ? 'KZ.recyclingTop'
            : 'KZ.recycling',
        params: electricSchedule
          ? {}
          : {
              cc: cc.toString(),
              lower: recyclingIndex === 0 ? '0' : RECYCLING_BANDS[recyclingIndex - 1].limit!,
              ...(recyclingBand.limit === null ? {} : { upper: recyclingBand.limit }),
              mci: MCI.toString(),
              baseCoefficient: '50',
              coefficient: recyclingCoefficient,
            },
      },
    },
    // Market service estimate in the reference, included in its total; not a statutory tax.
    {
      id: 'relatedCosts',
      amount: '400000',
      formula: '400000',
      method: { key: 'KZ.relatedCosts', params: { amount: '400000' } },
    },
  ];
  return { lines, additionalCosts: [] };
}
