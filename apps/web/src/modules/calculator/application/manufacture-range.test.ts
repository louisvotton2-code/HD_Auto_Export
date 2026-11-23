import { describe, expect, it } from 'vitest';
import { Amount } from '../core/decimal';
import { calculateImportEstimate } from '../core/calculate';
import { createDefaultInput } from './defaults';
import { calculateManufactureRange, calculateRecentJanuaryEstimates, isManufactureMonthRange } from './manufacture-range';

const input = { ...createDefaultInput('GE', '2026-11-23'), displacementCc: '1998', manufactureDate: '' };

describe('manufacture month range quotes', () => {
  it('evaluates the whole interval using complete scenario results and the same inputs', () => {
    const quote = calculateManufactureRange(input, { from: '2019-11', to: '2026-11' });
    expect(quote.evaluatedMonths).toBe(85);
    expect(quote.incompleteMonths).toBe(0);
    expect(quote.minimum?.manufactureDate).toBe('2026-01');
    expect(quote.maximum?.manufactureDate).toBe('2019-11');
    for (const scenario of [quote.minimum!, quote.maximum!]) {
      expect(scenario.result).toEqual(calculateImportEstimate(scenario.input));
      expect(scenario.result.total).toBe(scenario.result.lines.reduce((total, line) => total.add(line.amount), new Amount(0)).toFixed(2));
      expect({ ...scenario.input, manufactureDate: '' }).toEqual(input);
    }
  });

  it('uses six January scenarios and never carries an unsupported range into a total', () => {
    const quote = calculateRecentJanuaryEstimates(input, 2026);
    const totals = [2021, 2022, 2023, 2024, 2025, 2026]
      .map(year => Number(calculateImportEstimate({ ...input, manufactureDate: `${year}-01` }).total));
    expect(quote).toMatchObject({ evaluatedMonths: 6, incompleteMonths: 0, range: { from: '2021-01', to: '2026-01' } });
    expect(calculateRecentJanuaryEstimates(input, 2027)).toEqual(quote);
    expect(Number(quote.minimum?.result.total)).toBe(Math.min(...totals));
    expect(Number(quote.maximum?.result.total)).toBe(Math.max(...totals));
    const manual = calculateRecentJanuaryEstimates({ ...createDefaultInput('RU', input.customsDate), manufactureDate: '' }, 2026);
    expect(manual).toMatchObject({ evaluatedMonths: 6, incompleteMonths: 6, minimum: null, maximum: null,
      result: { status: 'needs_review', total: null, lines: [] } });
  });

  it('does not publish a partial interval when even one month is beyond the clearance date', () => {
    const quote = calculateManufactureRange(input, { from: '2026-11', to: '2026-12' });
    expect(quote).toMatchObject({ evaluatedMonths: 2, incompleteMonths: 1, minimum: null, maximum: null,
      result: { status: 'invalid', total: null, lines: [], fieldErrors: { manufactureDate: 'manufacture_after_customs' } } });
  });

  it('retains missing and unsupported rule diagnostics', () => {
    expect(calculateManufactureRange({ ...input, displacementCc: '' }, { from: '2022-01', to: '2022-12' }))
      .toMatchObject({ minimum: null, maximum: null, incompleteMonths: 12, result: { status: 'incomplete', total: null, missingFields: ['displacementCc'] } });
    expect(calculateManufactureRange({ ...input, customsDate: '2027-11-14' }, { from: '2022-01', to: '2022-12' }))
      .toMatchObject({ minimum: null, maximum: null, incompleteMonths: 12, result: { status: 'needs_review', total: null } });
  });

  it.each([
    { from: '2024-02', to: '2024-01' }, { from: '2024-00', to: '2024-12' },
    { from: '0001-01', to: '9999-12' }, { from: '2024-01', to: '2024-12', extra: true },
  ])('rejects invalid, reversed or unbounded ranges without truncating them: %j', range => {
    expect(isManufactureMonthRange(range)).toBe(false);
    expect(calculateManufactureRange(input, range)).toMatchObject({ evaluatedMonths: 0, minimum: null, maximum: null, result: { status: 'invalid', total: null } });
  });
});
