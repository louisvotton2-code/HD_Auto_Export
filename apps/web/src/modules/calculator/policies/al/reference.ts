import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const AL_REFERENCE_VERSION = 'al-hs8703-2026.11.23-v2';
export const AL_REFERENCE_SOURCE = 'https://www.dogana.gov.al/english/c/179/customs-clearance-of-vehicles';

export function calculateAlReference({ input }: ReferencePolicyFacts): ReferencePolicyResult {
  const newElectric = input.powertrain === 'bev' && input.condition === 'new';
  const customsValue = new Amount(input.price).add(input.freight || '0')
    .add(input.insurance || '0').mul(input.transactionRate);
  return {
    // Eligibility, alternative customs valuation, seat count and registration value still require the documents.
    reason: 'manual_pricing',
    lines: [
      tariffLine('vat', newElectric ? new Amount(0) : customsValue.mul('0.20'),
        newElectric ? '0' : `${customsValue} × 20%`,
        newElectric ? 'AL.vatNewElectric' : 'AL.vatDeclared', { taxableBase: customsValue.toFixed() }),
      tariffLine('registration', new Amount(8500), '2000 + 2500 + 2 × 2000', 'AL.registration'),
    ],
    additionalCosts: [],
  };
}
