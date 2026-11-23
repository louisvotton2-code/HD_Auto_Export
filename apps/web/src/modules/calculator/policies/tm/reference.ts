import { Amount } from '../../core/decimal';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const TM_REFERENCE_VERSION = 'tm-personal-2026.11.23-v2';
export const TM_REFERENCE_SOURCE = 'https://www.customs.gov.tm/index.php/tk/customs-info/customs-fees/duties';

// Customs tariff row 61, indexed by completed calendar years excluding production year.
const dutyBands = [
  { rate: '0.02', minimumUsdCc: '0.10' },
  { rate: '0.10', minimumUsdCc: '0.30' },
  { rate: '0.25', minimumUsdCc: '0.50' },
  { rate: '0.40', minimumUsdCc: '1.00' },
  { rate: '0.50', minimumUsdCc: '1.50' },
] as const;

export function calculateTmReference({ input, ageYears }: ReferencePolicyFacts): ReferencePolicyResult {
  const unavailable = (reason: string) => ({ reason, lines: [], additionalCosts: [] });
  if (ageYears >= dutyBands.length) return unavailable('tm_age_limit');
  if (input.steering === 'right' || input.steeringConverted === 'yes') return unavailable('tm_steering_limit');
  if (input.powertrain === 'erev') return unavailable('powertrain_rules_pending');

  const electric = input.powertrain === 'bev';
  const hybrid = input.powertrain === 'hev' || input.powertrain === 'phev';
  const cc = new Amount(electric ? '0' : input.displacementCc);
  if (cc.gt(3500)) return unavailable('tm_displacement_review');

  // Personal-use customs value excludes delivery costs under Customs Code art. 230.
  const value = new Amount(input.price).mul(input.transactionRate);
  const usd = new Amount(input.usdRate!);
  const { rate, minimumUsdCc } = dutyBands[ageYears]!;
  const dutyBase = Amount.max(value.mul(rate), cc.mul(minimumUsdCc).mul(usd));
  const duty = electric ? new Amount(0) : dutyBase.mul(hybrid ? '0.5' : '1');
  const dutyFormula = `max(${value} × ${rate}, ${cc} × ${minimumUsdCc} × ${usd})`;
  const excise = cc.mul('0.30').mul(usd);
  const fee = value.mul('0.002');
  return {
    lines: [
      tariffLine('duty', duty, electric ? '0' : `${dutyFormula}${hybrid ? ' × 0.50' : ''}`,
        electric ? 'TM.evDuty' : hybrid ? 'TM.hybridDuty' : 'TM.duty', {
          age: ageYears, rate: new Amount(rate).mul(100).toFixed(), minimum: minimumUsdCc, value: value.toFixed(),
          cc: cc.toFixed(), usd: usd.toFixed(),
        }),
      tariffLine('excise', excise, electric ? '0' : `${cc} × 0.30 × ${usd}`,
        electric ? 'TM.evExcise' : 'TM.excise', { cc: cc.toFixed(), usd: usd.toFixed() }),
      tariffLine('customsFee', fee, `${value} × 0.002`, 'TM.fee', { value: value.toFixed() }),
    ],
    additionalCosts: [],
  };
}
