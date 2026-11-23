import { describe, expect, it } from 'vitest';
import { Amount } from '../core/decimal';
import { calculateImportEstimate } from '../core/calculate';
import { createDefaultInput } from './defaults';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { calculateManufactureRange, calculateRecentJanuaryEstimates, isManufactureMonthRange } from './manufacture-range';

const input = {
  ...createDefaultInput('RU', '2026-11-14', createReferenceSnapshot()),
  price: '30000', transactionRate: '100', euroRate: '100', displacementCc: '2000', powerHp: '150',
  manufactureDate: '',
};

describe('complete manufacture month range quotes', () => {
  it('finds the interior cheapest tariff, not just the two date endpoints or stitched line minima', () => {
    const before = structuredClone(input);
    const quote = calculateManufactureRange(input, { from: '2020-11', to: '2026-11' });
    expect(quote.evaluatedMonths).toBe(73);
    expect(quote.incompleteMonths).toBe(0);
    expect(quote.minimum?.manufactureDate).toBe('2021-11');
    expect(quote.minimum?.result.total).toBe('563665');
    expect(quote.maximum?.result.total).toBe('1461865');
    expect(quote.minimum?.result.lines.find(line => line.id === 'recycling')?.amount).toBe('5200');
    // The young-car recycling amount is 3400, but it does not belong to the cheapest COMPLETE quote.
    for (const scenario of [quote.minimum!, quote.maximum!]) {
      expect(scenario.result).toEqual(calculateImportEstimate(scenario.input));
      expect(scenario.result.total).toBe(scenario.result.lines.reduce((total, line) => total.add(line.amount), new Amount(0)).toFixed(0));
      expect({ ...scenario.input, manufactureDate: '' }).toEqual(input);
    }
    expect(input).toEqual(before);
  });

  it('uses each of six January scenarios rather than every month or only endpoints', () => {
    const quote = calculateRecentJanuaryEstimates(input, 2026);
    const totals = [2021, 2022, 2023, 2024, 2025, 2026]
      .map(year => Number(calculateImportEstimate({ ...input, manufactureDate: `${year}-01` }).total));
    expect(quote).toMatchObject({ evaluatedMonths: 6, incompleteMonths: 0, range: { from: '2021-01', to: '2026-01' } });
    expect(calculateRecentJanuaryEstimates(input, 2027)).toEqual(quote);
    expect(Number(quote.minimum?.result.total)).toBe(Math.min(...totals));
    expect(Number(quote.maximum?.result.total)).toBe(Math.max(...totals));
    expect(calculateRecentJanuaryEstimates({ ...input, powerHp: '' }, 2026).minimum).toBeNull();
  });

  it.each([
    ['2023-10', '2023-11'],
    ['2021-10', '2021-11'],
  ] as const)('quotes both months around the %s / %s anniversary boundary', (from, to) => {
    const quote = calculateManufactureRange(input, { from, to });
    expect(quote.evaluatedMonths).toBe(2);
    const amounts = [from, to].map(manufactureDate => Number(calculateImportEstimate({ ...input, manufactureDate }).total));
    expect(amounts[0]).not.toBe(amounts[1]);
    expect(Number(quote.minimum!.result.total)).toBe(Math.min(...amounts));
    expect(Number(quote.maximum!.result.total)).toBe(Math.max(...amounts));
  });

  it('does not publish a partial interval when even one month is in the future', () => {
    const quote = calculateManufactureRange(input, { from: '2026-11', to: '2026-12' });
    expect(quote).toMatchObject({ evaluatedMonths: 2, incompleteMonths: 1, minimum: null, maximum: null,
      result: { status: 'invalid', total: null, lines: [], fieldErrors: { manufactureDate: 'manufacture_after_customs' } } });
  });

  it('retains missing and unsupported rule diagnostics rather than returning a price range', () => {
    expect(calculateManufactureRange({ ...input, powerHp: '' }, { from: '2022-01', to: '2022-12' }))
      .toMatchObject({ minimum: null, maximum: null, incompleteMonths: 12, result: { status: 'incomplete', total: null, missingFields: ['powerHp'] } });
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
