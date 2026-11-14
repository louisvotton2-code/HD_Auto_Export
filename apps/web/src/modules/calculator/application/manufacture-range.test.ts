import { describe, expect, it } from 'vitest';
import { Amount } from '../core/decimal';
import { calculateImportEstimate } from '../core/calculate';
import { createDefaultInput } from './defaults';
import { createReferenceSnapshot } from '../infrastructure/exchange-rates';
import { calculateManufactureRange, isManufactureMonthRange } from './manufacture-range';

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
    expect(quote.minimum?.manufactureDate).toBe('2021-12');
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

  it.each([
    ['2023-11', '2023-12', 35, 36],
    ['2021-11', '2021-12', 59, 60],
  ] as const)('evaluates both sides of the exact %s / %s reference boundary', (from, to, lower, upper) => {
    const quote = calculateManufactureRange(input, { from, to });
    expect(quote.evaluatedMonths).toBe(2);
    const ages = [quote.minimum!, quote.maximum!].map(scenario => scenario.result.lines.find(line => line.id === 'duty')!.method!.params.ageMonths);
    expect(ages.sort((a, b) => Number(a) - Number(b))).toEqual([lower, upper]);
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
