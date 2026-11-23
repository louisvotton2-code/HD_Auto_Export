import { personalCombustionDuty } from '../eaeu-personal';
import { Amount, roundedAmount } from '../../core/decimal';
import type {
  CalculationLine,
  ReferencePolicyFacts,
  ReferencePolicyResult,
} from '../../core/types';

export const KZ_REFERENCE_VERSION = 'kz-m1-2026.11.23-v2';

const MCI = new Amount('4325');
const LUXURY_THRESHOLD = new Amount('77850000');
const RECYCLING_BANDS = [
  { limit: '1000', coefficient: '1.5' },
  { limit: '2000', coefficient: '3.5' },
  { limit: '3000', coefficient: '5' },
  { limit: null, coefficient: '11.5' },
] as const;

export function calculateKzReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  const { input, ageYears } = facts;
  const electric = input.powertrain === 'bev';
  const cc = new Amount(electric ? '0' : input.displacementCc);
  const customsFee = MCI.mul(6);
  const declaration = input.kzDeclaration
    ?? (input.importerType === 'company' || electric ? 'goods' : 'personal');
  const additionalCosts: ReferencePolicyResult['additionalCosts'] = [{
    id: 'relatedCosts', kind: 'one_time_estimate', amount: '400000', formula: '400000',
    method: { key: 'KZ.relatedCosts', params: { amount: '400000' } },
  }];
  const registrationCoefficient =
    ageYears <= 1
      ? '0.25'
      : ageYears <= 2
        ? electric
          ? '25'
          : '50'
        : electric
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
    {
      id: 'registration',
      amount: roundedAmount(MCI.mul(registrationCoefficient)),
      formula: `round(4325 × ${registrationCoefficient})`,
      method: {
        key:
          ageYears <= 1
            ? 'KZ.registrationYoung'
            : `KZ.registration${electric ? 'Electric' : 'Standard'}${ageYears <= 2 ? 'Middle' : 'Old'}`,
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
      amount: electric ? '0' : roundedAmount(MCI.mul(50).mul(recyclingCoefficient)),
      formula: electric ? '0' : `4325 × 50 × ${recyclingCoefficient}`,
      method: {
        key: electric
          ? 'KZ.recyclingElectric'
          : recyclingBand.limit === null
            ? 'KZ.recyclingTop'
            : 'KZ.recycling',
        params: electric
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
  ];
  // Decision 107 uses unified duties and taxes for ordinary personal combustion cars.
  if (declaration === 'personal' && input.importerType === 'individual' && !electric && input.powertrain !== 'erev') {
    lines.splice(1, 0, personalCombustionDuty('KZ', facts));
    return { lines, additionalCosts, assumptions: ['kz_personal_declaration'] };
  }
  if (declaration !== 'goods') return { reason: 'kz_declaration_review', lines, additionalCosts };

  // Tax Code art. 537 uses customs valuation for acquisition from outside the EAEU.
  const value = new Amount(input.price).add(input.freight || 0).add(input.insurance || 0).mul(input.transactionRate);
  const luxuryTaxable = value.gte(LUXURY_THRESHOLD);
  const luxuryExcise = luxuryTaxable ? new Amount(roundedAmount(value.mul('0.10'))) : new Amount(0);
  const luxuryLine: CalculationLine = {
    id: 'luxuryExcise', amount: roundedAmount(luxuryExcise),
    formula: luxuryTaxable ? `round(${value} × 0.10)` : '0',
    method: {
      key: luxuryTaxable ? 'KZ.luxuryExcise' : 'KZ.luxuryExciseZero',
      params: { value: value.toString(), threshold: LUXURY_THRESHOLD.toString(), ...(luxuryTaxable ? { percentage: '10' } : {}) },
    },
  };
  if (!electric) {
    // The common tariff for combustion cars depends on the detailed commodity code.
    const engineExcise: CalculationLine = {
      id: 'excise', amount: roundedAmount(cc.gt(3000) ? cc.mul(100) : new Amount(0)),
      formula: cc.gt(3000) ? `${cc} × 100` : '0',
      method: { key: 'KZ.goodsEngineExcise', params: { cc: cc.toString() } },
    };
    return { reason: 'kz_declaration_review', lines: [...lines, engineExcise, luxuryLine], additionalCosts };
  }
  const duty = value.mul('0.15');
  const vatBase = value.add(duty).add(luxuryExcise).add(customsFee);
  lines.splice(1, 0, {
    id: 'duty', amount: roundedAmount(duty), formula: `round(${value} × 0.15)`,
    method: { key: 'KZ.goodsBevDuty', params: { value: value.toString(), percentage: '15' } },
  }, luxuryLine, {
    id: 'vat', amount: roundedAmount(vatBase.mul('0.16')), formula: `round(${vatBase} × 0.16)`,
    method: {
      key: 'KZ.vat',
      params: { value: value.toString(), duty: duty.toString(), engineExcise: '0', luxuryExcise: luxuryExcise.toString(),
        customsFee: customsFee.toString(), base: vatBase.toString(), percentage: '16' },
    },
  });
  return { lines, additionalCosts, assumptions: ['kz_standard_goods'] };
}
