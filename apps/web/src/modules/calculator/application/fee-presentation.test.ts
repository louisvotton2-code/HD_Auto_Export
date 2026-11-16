import { describe, expect, it } from 'vitest';
import type { CalculationLine } from '../core/types';
import { formatFeeFormula, formatMethodParameters } from './fee-presentation';

const labels = { maximum: '取较高值', lookup: '按计税价值查表', amount: '该项金额' };
const line = (formula: string, amount = '100'): CalculationLine => ({
  id: 'duty',
  amount,
  formula,
});

describe('readable substituted formulas', () => {
  it('keeps coefficients non-zero and appends the actual result without exposing rounding helpers', () => {
    const source = line('round2(round2(10000 × 0.004) × 100.77)', '4030.80');
    const displayed = formatFeeFormula(source, 'KGS', 'zh', labels);
    expect(displayed).toBe('(10,000 × 0.004) × 100.77 = 4,030.8 KGS');
    expect(displayed).not.toContain('round');
    expect(source.formula).toBe('round2(round2(10000 × 0.004) × 100.77)');
  });

  it('uses a translated lookup instead of an internal function name', () => {
    expect(
      formatFeeFormula(line('clearance_band(2049229.55) = 13541', '13541'), 'RUB', 'zh', labels),
    ).toBe('按计税价值查表(2,049,229.55) = 13,541 RUB');
  });

  it('shows the EUR fee actually multiplied by the KGS rate after intermediate rounding', () => {
    const duty = {
      ...line('round2(round2(172.5 × 0.15) × 2)', '51.76'),
      method: { key: 'KG.dutyElectric', params: { eurAmount: '25.88', euroRate: '2' } },
    };
    expect(formatFeeFormula(duty, 'KGS', 'zh', labels)).toBe('25.88 EUR × 2 KGS/EUR = 51.76 KGS');
    const dutyWithLocalRounding = {
      ...duty,
      amount: '2607.93',
      method: { ...duty.method, params: { eurAmount: '25.88', euroRate: '100.77' } },
    };
    expect(formatFeeFormula(dutyWithLocalRounding, 'KGS', 'zh', labels))
      .toBe('25.88 EUR × 100.77 KGS/EUR ≈ 2,607.93 KGS');
  });

  it('separates max operands from grouping commas and marks shortened long decimals', () => {
    const displayed = formatFeeFormula(
      line('round(max(10000.123456789 × 0.2, 1998 × 0.44 × 422.7))', '371616'),
      'AMD',
      'zh',
      labels,
    );
    expect(displayed).toContain('≈ 取较高值(10,000.12 × 0.2 ; 1,998 × 0.44 × 422.7)');
    expect(displayed).toContain('= 371,616 AMD');
    expect(displayed).not.toContain('round(');
  });

  it('localizes decimal separators and preserves cents on large values', () => {
    const displayed = formatFeeFormula(
      line('100000000000000000.05 × 1', '100000000000000000.05'),
      'KGS',
      'ru',
      { maximum: 'макс', lookup: 'Группа', amount: 'Сумма' },
    );
    expect(displayed).toContain('000,05');
    expect(displayed).not.toContain('≈');
    expect(displayed.replace(/\s/g, '')).toContain('100000000000000000,05');
  });

  it('explains a true zero without a misleading blank formula', () => {
    expect(formatFeeFormula(line('0', '0'), 'AMD', 'zh', labels)).toBe('该项金额 = 0 AMD');
  });
});

describe('policy explanation operands', () => {
  it('uses readable monetary values and preserves the higher precision of rates', () => {
    const input = {
      taxableBase: '12345.6789',
      euroRate: '422.7000000001',
      rate: 0.4,
      cc: '1998',
      currency: 'AMD',
    };
    expect(formatMethodParameters(input, 'zh')).toEqual({
      taxableBase: '≈ 12,345.68',
      euroRate: '≈ 422.7',
      rate: '0.4',
      cc: '1,998',
      currency: 'AMD',
    });
    expect(input.taxableBase).toBe('12345.6789');
  });

  it('formats Russian parameters without passing numeric strings to ICU as dates or identifiers', () => {
    const values = formatMethodParameters({ age: 5, perCc: '0.44', amount: '21000' }, 'ru');
    expect(values.age).toBe('5');
    expect(values.perCc).toBe('0,44');
    expect(values.amount.replace(/\s/g, '')).toBe('21000');
  });
});
