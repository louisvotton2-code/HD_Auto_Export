import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';
import { ordinaryCombustion, personalCombustionDuty } from '../eaeu-personal';

export const RU_REFERENCE_VERSION = 'ru-personal-2026.11.23-v3';

const clearanceBands = [
  [200000, 1231], [450000, 2462], [1200000, 4924], [2700000, 13541],
  [4200000, 18465], [5500000, 21344], [10000000, 49240], [Infinity, 73860],
] as const;

export function calculateRuReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  if (!ordinaryCombustion(facts)) return { reason: 'manual_pricing', lines: [], additionalCosts: [] };
  const { input } = facts;
  const duty = personalCombustionDuty('RU', facts);
  const value = new Amount(input.price).mul(input.transactionRate);
  const [ceiling, fee] = clearanceBands.find(([limit]) => value.lte(limit))!;
  const clearance = tariffLine('customsFee', new Amount(fee), String(fee), 'RU.officialClearance',
    { value: value.toFixed(), fee, ceiling: Number.isFinite(ceiling) ? String(ceiling) : '10,000,000+' });
  // Recycling requires power classification and importer qualifications missing from this form.
  return { reason: 'manual_pricing', lines: [duty, clearance], additionalCosts: [] };
}
