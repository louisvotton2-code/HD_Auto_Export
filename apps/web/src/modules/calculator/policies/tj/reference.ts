import { Amount } from '../../core/decimal';
import { compareManufactureAnniversary } from '../../core/dates';
import { tariffLine } from '../../core/tariff-line';
import type { ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';

export const TJ_REFERENCE_VERSION = 'tj-personal-2026.11.23-v3';
export const TJ_REFERENCE_SOURCE = 'https://tajtrade.tj/procedure/356?l=ru';

const clearanceBands = [
  { belowUsd: 101, feeUsd: 0 }, { belowUsd: 5001, feeUsd: 10 },
  { belowUsd: 10001, feeUsd: 20 }, { belowUsd: 50001, feeUsd: 70 },
  { belowUsd: 100001, feeUsd: 150 },
];

export function calculateTjReference({ input, ageMonths }: ReferencePolicyFacts): ReferencePolicyResult {
  const unavailable = (reason: string) => ({ reason, lines: [], additionalCosts: [] });
  if (Number(input.manufactureDate.trim().slice(0, 4)) < 2013) return unavailable('tj_age_limit');
  const electric = input.powertrain === 'bev';
  if (electric) {
    const anniversary = compareManufactureAnniversary(input, ageMonths, 1);
    if (anniversary === null || anniversary > 0) return unavailable('tj_electric_age_review');
  }
  if (!electric && input.powertrain !== 'petrol' && input.powertrain !== 'diesel') {
    return unavailable('powertrain_rules_pending');
  }

  const usd = new Amount(input.usdRate!);
  // The declared customs value is entered directly, with no automatic CIF adjustment.
  const value = new Amount(input.price).mul(input.transactionRate);
  const valueUsd = value.div(usd);
  const feeUsd = clearanceBands.find(({ belowUsd }) => valueUsd.lt(belowUsd))?.feeUsd ?? 450;
  const fee = usd.mul(feeUsd);
  const dutyRate = new Amount(electric ? '0' : input.tjDutyPercent!);
  const exciseRate = new Amount(electric ? '0' : input.tjExcisePercent!);
  const exciseMinimum = new Amount(electric ? '0' : input.tjExciseMinimum!);
  const duty = value.mul(dutyRate).div(100);
  const cc = new Amount(electric ? '0' : input.displacementCc);
  const eur = new Amount(electric ? '0' : input.euroRate);
  // Tax Code art. 283 uses customs value; art. 250 adds duty to the separate VAT base.
  const excise = Amount.max(value.mul(exciseRate).div(100), cc.mul(exciseMinimum).mul(eur));
  const recycling = new Amount(144).mul(78);
  const vatBase = value.add(duty).add(excise).add(fee).add(recycling);
  const vat = electric ? new Amount(0) : vatBase.mul('0.14');
  return {
    lines: [
      tariffLine('duty', duty, electric ? '0' : `${value} × ${dutyRate}%`, electric ? 'TJ.evDuty' : 'TJ.duty', {
        value: value.toFixed(), rate: dutyRate.toFixed(),
      }),
      tariffLine('excise', excise, electric ? '0' : `max(${value} × ${exciseRate}%, ${cc} × ${exciseMinimum} × ${eur})`,
        electric ? 'TJ.evExcise' : 'TJ.excise', {
          value: value.toFixed(), rate: exciseRate.toFixed(), cc: cc.toFixed(), minimum: exciseMinimum.toFixed(), eur: eur.toFixed(),
        }),
      tariffLine('customsFee', fee, `${feeUsd} × ${usd}`, 'TJ.fee', { feeUsd, usd: usd.toFixed() }),
      tariffLine('recycling', recycling, '144 × 78', 'TJ.recycling'),
      tariffLine('vat', vat, electric ? '0' : `(${value} + ${duty} + ${excise} + ${fee} + ${recycling}) × 14%`,
        electric ? 'TJ.evVat' : 'TJ.vat', { value: vatBase.toFixed() }),
    ],
    additionalCosts: [],
  };
}
