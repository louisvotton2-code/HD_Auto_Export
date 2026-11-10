import { Amount, roundedAmount } from '../../core/decimal';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const AL_REFERENCE_VERSION = 'al-personal-reference-2026.10.22-v1';
export const AL_REFERENCE_SOURCE = 'https://www.kmotors.shop/en/calculator/albania';

const MINIMUM_VALUES = [
  { limit: '1400', value: '162500' },
  { limit: '1900', value: '250000' },
  { limit: '2500', value: '406000' },
  { limit: '3000', value: '500000' },
  { limit: '4500', value: '625000' },
  { limit: null, value: '1000000' },
] as const;

export function calculateAlReference({ input }: ReferencePolicyFacts): ReferencePolicyResult {
  const electric = input.powertrain === 'bev';
  const cc = electric ? new Amount(0) : new Amount(input.displacementCc);
  const customsValue = new Amount(
    roundedAmount(
      new Amount(input.price)
        .add(input.freight || '0')
        .add(input.insurance || '0')
        .mul(input.transactionRate),
    ),
  );
  const minimum = electric
    ? '0'
    : MINIMUM_VALUES.find((item) => item.limit === null || cc.lte(item.limit))!.value;
  const vatBase = Amount.max(customsValue, minimum);
  const luxury = (!electric && cc.gte('3000')) || vatBase.gte('5000000');
  return {
    lines: [
      { id: 'duty', amount: '0', formula: '0', method: { key: 'AL.duty', params: {} } },
      { id: 'excise', amount: '0', formula: '0', method: { key: 'AL.excise', params: {} } },
      {
        id: 'vat',
        amount: roundedAmount(vatBase.mul('0.2')),
        formula: `round(max(${customsValue.toString()}, ${minimum}) × 0.2)`,
        method: {
          key: electric
            ? 'AL.vatElectric'
            : vatBase.eq(customsValue)
              ? 'AL.vatDeclared'
              : 'AL.vatMinimum',
          params: {
            declared: customsValue.toString(),
            minimum,
            taxableBase: vatBase.toString(),
            cc: cc.toString(),
            rate: 20,
          },
        },
      },
      {
        id: 'registration',
        amount: '8500',
        formula: '8500',
        method: { key: 'AL.registration', params: { fee: 8500 } },
      },
      {
        id: 'luxuryOnce',
        amount: luxury ? '70000' : '0',
        formula: luxury ? '70000' : '0',
        method: {
          key: luxury
            ? !electric && cc.gte('3000')
              ? 'AL.luxuryDisplacement'
              : 'AL.luxuryValue'
            : electric
              ? 'AL.luxuryElectricBelow'
              : 'AL.luxuryBelow',
          params: { cc: cc.toString(), taxableBase: vatBase.toString(), fee: luxury ? 70000 : 0 },
        },
      },
    ],
    additionalCosts: luxury
      ? [
          {
            id: 'annualLuxury',
            amount: '21000',
            formula: '21000',
            kind: 'annual',
            method: { key: 'AL.annualLuxury', params: { fee: 21000 } },
          },
        ]
      : [],
  };
}
