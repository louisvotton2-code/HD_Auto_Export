import { Amount, roundedAmount } from '../../core/decimal';
import type { CalculationLine, Powertrain } from '../../core/types';

export const GE_REFERENCE_VERSION = 'ge-personal-reference-2026.10.22-v1';

export interface GeReferenceFacts {
  powertrain: Powertrain;
  displacementCc: string;
  ageYears: number;
  steering: 'left' | 'right';
}

export function calculateGeReference(facts: GeReferenceFacts): CalculationLine[] {
  const electric = facts.powertrain === 'bev';
  const hybrid = ['hev', 'phev', 'erev'].includes(facts.powertrain);
  const cc = electric ? new Amount(0) : new Amount(facts.displacementCc).div(100).ceil().mul(100);
  const baseRate = facts.ageYears <= 6 ? '1.5' : '4.5';
  const multiplier = facts.steering === 'right' ? '3' : hybrid && facts.ageYears <= 6 ? '0.4' : '1';
  const excise = cc.mul(baseRate).mul(multiplier);
  const importRate = new Amount('0.05').add(new Amount('0.0025').mul(facts.ageYears));
  const importTax = cc.mul(importRate);

  return [
    {
      id: 'excise',
      amount: roundedAmount(excise),
      formula: electric ? '0' : `${cc.toString()} × ${baseRate} × ${multiplier}`,
      method: {
        key: electric
          ? 'GE.exciseElectric'
          : facts.steering === 'right'
            ? 'GE.exciseRight'
            : hybrid && facts.ageYears <= 6
              ? 'GE.exciseHybridRelief'
              : 'GE.exciseStandard',
        params: electric
          ? {}
          : {
              originalCc: facts.displacementCc,
              cc: cc.toString(),
              age: facts.ageYears,
              baseRate,
              multiplier,
            },
      },
    },
    {
      id: 'importTax',
      amount: roundedAmount(importTax),
      formula: electric ? '0' : `round((0.05 + 0.0025 × ${facts.ageYears}) × ${cc.toString()})`,
      method: {
        key: electric ? 'GE.importTaxElectric' : 'GE.importTax',
        params: electric
          ? {}
          : { cc: cc.toString(), age: facts.ageYears, rate: importRate.toString() },
      },
    },
    {
      id: 'service',
      amount: '480',
      formula: '150 + 200 + 30 + 50 + 50',
      method: { key: 'GE.service', params: {} },
    },
    { id: 'duty', amount: '0', formula: '0', method: { key: 'GE.dutyZero', params: {} } },
    { id: 'vat', amount: '0', formula: '0', method: { key: 'GE.vatZero', params: {} } },
  ];
}
