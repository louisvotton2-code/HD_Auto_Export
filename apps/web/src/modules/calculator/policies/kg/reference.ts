import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';
import { ordinaryCombustion, personalCombustionDuty } from '../eaeu-personal';

export const KG_REFERENCE_VERSION = 'kg-hs8703-2026.11.23-v2';
export const KG_REFERENCE_SOURCE = 'https://docs.eaeunion.org/documents/317/8824/';

export function calculateKgReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  const manual = { reason: 'manual_pricing', lines: [], additionalCosts: [] };
  if (!ordinaryCombustion(facts)) return manual;
  const { input } = facts;
  if (input.importerType === 'individual') {
    return { ...manual, lines: [personalCombustionDuty('KG', facts)] };
  }
  const cc = new Amount(input.displacementCc);
  // Only the verified ordinary petrol tariff band is offered for a goods declaration.
  if (input.powertrain !== 'petrol' || cc.lte(1800) || cc.gt(3000) || facts.ageMonths < 36) return manual;
  if (facts.ageMonths === 36 || facts.ageMonths === 84) return { ...manual, reason: 'age_boundary_manual' };
  const value = new Amount(input.price).add(input.freight || '0').add(input.insurance || '0').mul(input.transactionRate);
  const middle = facts.ageMonths < 84;
  const fixed = cc.mul(middle ? '0.44' : '2.20').mul(input.euroRate);
  const duty = middle ? Amount.max(value.mul('0.20'), fixed) : fixed;
  const customsFee = Amount.min(250000, Amount.max(500, value.mul('0.004')));
  return { lines: [
    tariffLine('duty', duty, middle ? `max(${value} × 20%, ${cc} × 0.44 × ${input.euroRate})`
      : `${cc} × 2.20 × ${input.euroRate}`, middle ? 'KG.officialCompanyMiddle' : 'KG.officialCompanyOld'),
    tariffLine('vat', value.add(duty).mul('0.12'), `(${value} + ${duty}) × 12%`, 'KG.officialCompanyVat'),
    tariffLine('customsFee', customsFee, `min(250000, max(500, ${value} × 0.004))`, 'KG.officialCompanyFee'),
  ], additionalCosts: [] };
}
