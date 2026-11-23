import { Amount, roundedAmount } from '../../core/decimal';
import type { CalculationLine, ReferencePolicyFacts, ReferencePolicyResult } from '../../core/types';
import { personalCombustionDuty } from '../eaeu-personal';

export const AM_REFERENCE_VERSION = 'am-personal-2026.11.23';
export const AM_REFERENCE_SOURCE = 'https://exim.src.am/ru/transport';

// RA Tax Code, Article 171: tax on imported vehicles, classified by production year.
const ENVIRONMENTAL_BANDS = [[3, 2], [5, 4], [10, 6], [15, 12], [Infinity, 24]] as const;

export function calculateAmReference(facts: ReferencePolicyFacts): ReferencePolicyResult {
  const { input, ageYears } = facts;
  if (input.powertrain === 'erev') {
    return { reason: 'powertrain_rules_pending', lines: [], additionalCosts: [] };
  }
  const value = new Amount(input.price).mul(input.transactionRate);
  const electric = input.powertrain === 'bev';
  const duty: CalculationLine = electric
    ? { id: 'duty', amount: roundedAmount(value.mul('0.15')), formula: `round(${value} × 0.15)`,
        method: { key: 'AM.electricStandardDuty', params: { value: value.toFixed() } } }
    : personalCombustionDuty('AM', facts);

  // Tax Code Article 64(58.1, 58.2); VAT relief has its own dates, independent of tariff quota.
  const evVatRelief = electric && (input.customsDate < '2026-02-01' || input.manufactureDate >= '2024-01');
  const vat: CalculationLine = {
    id: 'vat', amount: '0', formula: '0',
    method: { key: evVatRelief ? 'AM.electricVatRelief' : 'AM.unifiedVat', params: {} },
  };
  if (electric && !evVatRelief) {
    const vatBase = value.add(duty.amount);
    vat.amount = roundedAmount(vatBase.mul('0.2'));
    vat.formula = `round((${value} + ${duty.amount}) × 0.20)`;
    vat.method = { key: 'AM.vat', params: { value: value.toFixed(), duty: duty.amount, taxableBase: vatBase.toFixed(), rate: 20 } };
  }
  const [, rate] = ENVIRONMENTAL_BANDS.find(([limit]) => ageYears <= limit)!;
  return {
    assumptions: electric ? ['am_electric_standard_duty', 'am_environmental_value_assumed'] : ['am_environmental_value_assumed'],
    lines: [
      duty,
      { id: 'excise', amount: '0', formula: '0', method: { key: 'AM.excise', params: {} } },
      vat,
      { id: 'environmental', amount: roundedAmount(value.mul(rate).div(100)), formula: `round(${value} × ${rate} / 100)`,
        method: { key: 'AM.importEnvironment', params: { age: ageYears, value: value.toFixed(), rate } } },
    ],
    additionalCosts: [],
  };
}
