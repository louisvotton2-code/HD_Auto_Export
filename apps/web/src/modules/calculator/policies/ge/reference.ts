import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const GE_REFERENCE_VERSION = 'ge-hs8703-2026.04.02-v2';

export function calculateGeReference({ input, ageYears }: ReferencePolicyFacts): ReferencePolicyResult {
  // The April amendment has a pre-shipment transition. This method covers ordinary current entries.
  if (input.customsDate < '2026-04-02' || ageYears > 30 || input.powertrain === 'erev') {
    return { reason: 'manual_pricing', lines: [], additionalCosts: [] };
  }
  const electric = input.powertrain === 'bev';
  const right = input.steering === 'right';
  const hybridRelief = !right && (input.powertrain === 'hev' || input.powertrain === 'phev') && ageYears <= 6;
  const cc = new Amount(electric ? '0' : input.displacementCc);
  const baseRate = ageYears <= 6 ? '1.50' : '4.50';
  const multiplier = right ? '3' : hybridRelief ? '0.4' : '1';
  const excise = electric ? new Amount(right ? 3000 : 0) : cc.mul(baseRate).mul(multiplier);
  const dutyRate = new Amount('0.05').mul(new Amount(1).add(new Amount('0.05').mul(ageYears)));
  const duty = cc.mul(dutyRate);
  return {
    lines: [
      tariffLine('excise', excise, electric ? excise.toFixed() : `${cc} × ${baseRate} × ${multiplier}`,
        electric ? right ? 'GE.exciseElectricRight' : 'GE.exciseElectric'
          : right ? 'GE.exciseRight' : hybridRelief ? 'GE.exciseHybridRelief' : 'GE.exciseStandard',
        { cc: cc.toFixed(), age: ageYears, baseRate, multiplier }),
      tariffLine('importTax', duty, electric ? '0' : `${cc} × 0.05 × (1 + 0.05 × ${ageYears})`,
        electric ? 'GE.importTaxElectric' : 'GE.importTax', { cc: cc.toFixed(), age: ageYears, rate: dutyRate.toFixed() }),
      tariffLine('service', new Amount(150), '150', 'GE.service'),
      tariffLine('vat', new Amount(0), '0', 'GE.vatZero'),
    ],
    additionalCosts: [],
  };
}
