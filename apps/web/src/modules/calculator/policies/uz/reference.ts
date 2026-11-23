import { Amount, roundedAmount } from '../../core/decimal';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';

export const UZ_REFERENCE_VERSION = 'uz-hs8703-2026.11.23-v2';

const CLEARANCE_BANDS = [
  { limit: '10000', coefficient: '1' },
  { limit: '20000', coefficient: '1.5' },
  { limit: '40000', coefficient: '2.5' },
  { limit: '60000', coefficient: '4' },
  { limit: '100000', coefficient: '7' },
  { limit: '200000', coefficient: '10' },
  { limit: '500000', coefficient: '15' },
  { limit: '1000000', coefficient: '20' },
  { limit: null, coefficient: '25' },
] as const;
const PETROL_BANDS = [
  { limit: '1000', fresh: '0.4', older: '1.8' },
  { limit: '1500', fresh: '0.6', older: '2' },
  { limit: '1800', fresh: '0.8', older: '2.5' },
  { limit: '3000', fresh: '1', older: '2.5' },
  { limit: null, fresh: '1.25', older: '3' },
] as const;
const DIESEL_BANDS = [
  { limit: '1500', fresh: '0.6', older: '2' },
  { limit: '2500', fresh: '0.8', older: '2.5' },
  { limit: null, fresh: '1.25', older: '3' },
] as const;
const RECYCLING_BANDS = [
  { limit: '1000', fresh: '30', older: '90' },
  { limit: '2000', fresh: '120', older: '210' },
  { limit: '3000', fresh: '180', older: '330' },
  { limit: '3500', fresh: '180', older: '390' },
  { limit: null, fresh: '300', older: '480' },
] as const;

export function calculateUzReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  const { input, ageMonths } = facts;
  const electric = input.powertrain === 'bev';
  const hybrid = input.powertrain === 'hev' || input.powertrain === 'phev';
  const used = input.condition !== 'new';
  const manual = (reason: string) => ({ reason, lines: [], additionalCosts: [] });
  if (input.customsDate < '2026-02-16' || input.powertrain === 'erev') return manual('manual_pricing');
  if (ageMonths === 36 || !electric && !used && ageMonths === 12) return manual('age_boundary_manual');
  if (!electric && !hybrid && !used && ageMonths > 36) return manual('manual_pricing');
  const brv = new Amount(input.customsDate >= '2026-09-01' ? 440000 : 412000);
  const freshNew = !used && ageMonths < 12;
  const olderThanThree = ageMonths > 36;
  const cc = new Amount(electric ? '0' : input.displacementCc);
  const transactionRate = new Amount(input.transactionRate);
  const usdRate = new Amount(input.usdRate ?? input.transactionRate);
  // All incoming monetary facts share the transaction currency, unlike the source's USD-only freight field.
  const transactionValue = new Amount(input.price)
    .add(input.freight || '0')
    .add(input.insurance || '0');
  const customsValue = transactionValue.mul(transactionRate);
  const customsUsd = customsValue.div(usdRate);
  let dutyRate = '0';
  let perCc = '0';

  if (!electric) {
    if (hybrid) {
      dutyRate = freshNew ? '0.15' : '0.30';
    } else if (used) {
      dutyRate = '0.4';
      perCc = '3';
    } else {
      const bands = input.powertrain === 'diesel' ? DIESEL_BANDS : PETROL_BANDS;
      const band = bands.find((candidate) => candidate.limit === null || cc.lte(candidate.limit))!;
      dutyRate = freshNew ? '0.15' : '0.3';
      perCc = freshNew ? band.fresh : band.older;
    }
  }

  const dutyUsd = customsUsd.mul(dutyRate).add(cc.mul(perCc));
  const duty = dutyUsd.mul(usdRate);
  const clearanceBand = CLEARANCE_BANDS.find(
    (band) => band.limit === null || (band.limit === '1000000' ? customsUsd.lt(band.limit) : customsUsd.lte(band.limit)),
  )!;
  const clearanceCoefficient = clearanceBand.coefficient;
  const clearanceIndex = CLEARANCE_BANDS.indexOf(clearanceBand);
  const recyclingBand = RECYCLING_BANDS.find((band) => band.limit === null || cc.lte(band.limit))!;
  const recyclingCoefficient = electric
    ? olderThanThree
      ? '210'
      : '120'
    : olderThanThree
      ? recyclingBand.older
      : recyclingBand.fresh;
  const registrationCoefficient = electric || hybrid ? '1.5' : '6.84';
  const vatBase = customsValue.add(duty);
  const dutyKey = electric
    ? 'dutyElectric'
    : hybrid
      ? freshNew ? 'dutyHybridNewYoung' : 'dutyHybridOther'
      : used
        ? 'dutyUsed'
        : freshNew
          ? 'dutyNewYoung'
          : 'dutyNewOld';
  const dutyMethod: NonNullable<CalculationLine['method']> = {
    key: `UZ.${dutyKey}`,
    params: electric
      ? {}
      : {
          ageMonths,
          customsUsd: customsUsd.toString(),
          percentage: new Amount(dutyRate).mul(100).toString(),
          ...(!hybrid ? { cc: cc.toString(), perCc } : {}),
          usdRate: usdRate.toString(),
        },
  };

  const lines: CalculationLine[] = [
    {
      id: 'customsFee',
      amount: roundedAmount(brv.mul(clearanceCoefficient)),
      formula: `${brv} × ${clearanceCoefficient}`,
      method: {
        key: clearanceBand.limit === null ? 'UZ.customsFeeTop' : 'UZ.customsFee',
        params: {
          customsUsd: customsUsd.toString(),
          lower: clearanceIndex === 0 ? '0' : CLEARANCE_BANDS[clearanceIndex - 1].limit!,
          ...(clearanceBand.limit === null ? {} : { upper: clearanceBand.limit }),
          brv: brv.toString(),
          coefficient: clearanceCoefficient,
        },
      },
    },
    {
      id: 'duty',
      amount: roundedAmount(duty),
      formula: electric
        ? '0'
        : `round((${customsUsd.toString()} × ${dutyRate} + ${cc.toString()} × ${perCc}) × ${usdRate.toString()})`,
      method: dutyMethod,
    },
    {
      id: 'vat',
      amount: roundedAmount(vatBase.mul('0.12')),
      formula: `round(${vatBase.toString()} × 0.12)`,
      method: {
        key: 'UZ.vat',
        params: {
          value: customsValue.toString(),
          duty: duty.toString(),
          base: vatBase.toString(),
          percentage: '12',
        },
      },
    },
    {
      id: 'recycling',
      amount: roundedAmount(brv.mul(recyclingCoefficient)),
      formula: `${brv} × ${recyclingCoefficient}`,
      method: {
        key: `UZ.recycling${electric ? 'Electric' : 'Standard'}${olderThanThree ? 'Old' : 'Young'}`,
        params: {
          ageMonths,
          ...(electric ? {} : { cc: cc.toString() }),
          brv: brv.toString(),
          coefficient: recyclingCoefficient,
        },
      },
    },
  ];
  return { lines, additionalCosts: [{
    id: 'registration', kind: 'one_time_estimate',
    amount: roundedAmount(brv.mul(registrationCoefficient)),
    formula: `${brv} × ${registrationCoefficient}`,
    method: { key: 'UZ.registrationCore', params: { brv: brv.toString(), coefficient: registrationCoefficient } },
  }] };
}
