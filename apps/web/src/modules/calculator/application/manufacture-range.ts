import { calculateImportEstimate } from '../core/calculate';
import { parseManufactureMonth } from '../core/dates';
import { Amount } from '../core/decimal';
import type { CalculationInput, CalculationResult } from '../core/types';

export type ManufactureMonthRange = { from: string; to: string };
export type ManufactureQuoteScenario = {
  manufactureDate: string;
  input: CalculationInput;
  result: CalculationResult;
};
export type ManufactureRangeCalculation = {
  range: ManufactureMonthRange;
  evaluatedMonths: number;
  incompleteMonths: number;
  minimum: ManufactureQuoteScenario | null;
  maximum: ManufactureQuoteScenario | null;
  /** Only complete ranges expose a total; diagnostics never expose partial bounds. */
  result: CalculationResult;
};

// Bound untrusted fragments and synchronous UI work without truncating a source range.
export const MAX_MANUFACTURE_RANGE_MONTHS = 2400;

export function isManufactureMonthRange(value: unknown): value is ManufactureMonthRange {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.from !== 'string' || typeof record.to !== 'string') return false;
  const from = parseManufactureMonth(record.from);
  const to = parseManufactureMonth(record.to);
  if (!from || !to) return false;
  const months = (to.year - from.year) * 12 + to.month - from.month + 1;
  return months > 0 && months <= MAX_MANUFACTURE_RANGE_MONTHS;
}

/** Evaluate each possible month with the SAME inputs and existing tax rules. */
export function calculateManufactureRange(
  input: CalculationInput,
  range: ManufactureMonthRange,
): ManufactureRangeCalculation {
  if (!isManufactureMonthRange(range)) {
    const result = calculateImportEstimate({ ...input, manufactureDate: '' });
    return {
      range, evaluatedMonths: 0, incompleteMonths: 0, minimum: null, maximum: null,
      result: { ...result, status: 'invalid', total: null, lines: [], additionalCosts: [],
        fieldErrors: { ...result.fieldErrors, manufactureDate: 'invalid_month' } },
    };
  }
  const first = parseManufactureMonth(range.from)!;
  const last = parseManufactureMonth(range.to)!;
  const start = first.year * 12 + first.month - 1;
  const end = last.year * 12 + last.month - 1;
  let minimum: ManufactureQuoteScenario | null = null;
  let maximum: ManufactureQuoteScenario | null = null;
  let failure: CalculationResult | null = null;
  let incompleteMonths = 0;
  const severity = { reference: 0, needs_review: 1, incomplete: 2, invalid: 3 };
  for (let month = start; month <= end; month++) {
    const manufactureDate = `${String(Math.floor(month / 12)).padStart(4, '0')}-${String(month % 12 + 1).padStart(2, '0')}`;
    const scenarioInput = { ...input, manufactureDate };
    const result = calculateImportEstimate(scenarioInput);
    if (result.status !== 'reference' || result.total === null) {
      incompleteMonths++;
      if (!failure || severity[result.status] > severity[failure.status]) failure = result;
      continue;
    }
    const scenario = { manufactureDate, input: scenarioInput, result };
    if (!minimum || new Amount(result.total).lt(minimum.result.total!)) minimum = scenario;
    if (!maximum || new Amount(result.total).gt(maximum.result.total!)) maximum = scenario;
  }
  if (failure) {
    // Some months cannot be priced: valid months do not become a purported complete range.
    return { range, evaluatedMonths: end - start + 1, incompleteMonths, minimum: null, maximum: null,
      result: { ...failure, total: null, lines: [], additionalCosts: [] } };
  }
  return { range, evaluatedMonths: end - start + 1, incompleteMonths: 0, minimum, maximum, result: minimum!.result };
}
