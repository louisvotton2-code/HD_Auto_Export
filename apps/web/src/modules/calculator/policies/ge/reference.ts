import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const GE_REFERENCE_VERSION = 'ge-hs8703-2026.11.23-v3';

// Article 188, ordinary passenger cars. The April 2026 amendment retains the prior
// schedule for consignments satisfying the documents and deadlines in its article 2.
const priorExciseRates = ['1.5', '1.5', '1.5', '1.4', '1.2', '1.0', '0.8', '0.8', '0.8', '0.9', '1.1', '1.3', '1.5', '1.8', '2.1', '2.4'];

export function calculateGeReference({ input, ageYears }: ReferencePolicyFacts): ReferencePolicyResult {
  const prior = input.customsDate < '2026-04-02' || input.gePriorScheduleEligible === 'approved';
  const baseRate = prior ? priorExciseRates[Math.min(ageYears, 15)] : ageYears <= 6 ? '1.50' : '4.50';
  const right = input.steering === 'right' || input.steeringConverted === 'yes';
  const electric = input.powertrain === 'bev';
  const cc = new Amount(electric ? 0 : input.displacementCc);

  if (input.powertrain === 'erev') {
    // Its marketing label does not establish a hybrid or electric customs classification.
    return { reason: 'powertrain_rules_pending', lines: [], additionalCosts: [] };
  }

  const hybridRelief = !right && ageYears <= 6 && (input.powertrain === 'hev' || input.powertrain === 'phev');
  const multiplier = right ? '3' : hybridRelief ? '0.4' : '1';
  const params = { cc: cc.toFixed(), age: ageYears, baseRate };
  let excise = tariffLine('excise', cc.mul(baseRate).mul(multiplier), `${cc} × ${baseRate} × ${multiplier}`,
    right ? 'GE.exciseRight' : hybridRelief ? 'GE.exciseHybridRelief' : 'GE.exciseStandard', params);
  if (electric) {
    if (right && prior) {
      excise = tariffLine('excise', new Amount(baseRate).mul(2000), `2000 × ${baseRate}`, 'GE.exciseElectricPrior', params);
    } else {
      const flat = right ? 3000 : 0;
      excise = tariffLine('excise', new Amount(flat), String(flat), right ? 'GE.exciseElectricRight' : 'GE.exciseElectric');
    }
  }
  const preferential = input.geChinaOriginPreference === 'approved';
  const importRate = new Amount('0.05').mul(new Amount('0.05').mul(ageYears).add(1));
  const importTax = electric || preferential ? new Amount(0) : cc.mul(importRate);
  return {
    lines: [
      excise,
      tariffLine('importTax', importTax, electric || preferential ? '0' : `${cc} × 0.05 × (1 + 0.05 × ${ageYears})`,
        electric ? 'GE.importTaxElectric' : preferential ? 'GE.importTaxPreferential' : 'GE.importTax',
        { cc: cc.toFixed(), age: ageYears, rate: importRate.toFixed() }),
      tariffLine('service', new Amount(150), '150', 'GE.service'),
      tariffLine('vat', new Amount(0), '0', 'GE.vatZero'),
    ],
    additionalCosts: [],
  };
}
