import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const KZ_REFERENCE_VERSION = 'kz-recycling-2026.11.23-v2';

const coefficients = [[1000, '1.5'], [2000, '3.5'], [3000, '5'], [Infinity, '11.5']] as const;

export function calculateKzReference({ input }: ReferencePolicyFacts): ReferencePolicyResult {
  const electric = input.powertrain === 'bev';
  if (!electric && input.powertrain !== 'petrol' && input.powertrain !== 'diesel')
    return { reason: 'manual_pricing', lines: [], additionalCosts: [] };
  const cc = new Amount(electric ? '0' : input.displacementCc);
  const coefficient = electric ? '0' : coefficients.find(([limit]) => cc.lte(limit))![1];
  return {
    reason: 'manual_pricing',
    lines: [tariffLine('recycling', new Amount(50).mul(4325).mul(coefficient),
      `50 × 4325 × ${coefficient}`, 'KZ.officialRecycling', { coefficient })],
    additionalCosts: [],
  };
}
