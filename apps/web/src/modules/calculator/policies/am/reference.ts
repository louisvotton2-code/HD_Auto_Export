import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';
import { ordinaryCombustion, personalCombustionDuty, throughEaeuAnniversary } from '../eaeu-personal';

export const AM_REFERENCE_VERSION = 'am-personal-2026.11.23-v2';
export const AM_REFERENCE_SOURCE = 'https://exim.src.am/ru/transport';

export function calculateAmReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  if (!ordinaryCombustion(facts)) return { reason: 'manual_pricing', lines: [], additionalCosts: [] };
  const duty = personalCombustionDuty('AM', facts);
  const { input } = facts;
  const value = new Amount(input.price).mul(input.transactionRate);
  const band = [[3, 2], [5, 4], [10, 6], [15, 12], [Infinity, 24]]
    .find(([age]) => throughEaeuAnniversary(facts, age))!;
  const rate = band[1];
  const environmental = tariffLine('environmental', value.mul(rate).div(100), `${value} × ${rate}%`,
    'AM.officialEnvironmental', { value: value.toFixed(), rate });
  // The state duty depends on declaration class, weight, place and hours.
  return { reason: 'manual_pricing', lines: [duty, environmental], additionalCosts: [] };
}
