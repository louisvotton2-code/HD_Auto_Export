import { calculateImportEstimate } from '../core/calculate';
import type { CalculationInput } from '../core/types';

export function januaryManufactureMonths(year: number): string[] {
  if (!Number.isInteger(year) || year < 7 || year > 9999) return [];
  return Array.from({ length: 7 }, (_, offset) => `${String(year - offset).padStart(4, '0')}-01`);
}

/** Each January is a hypothetical manufacture month, never an inferred vehicle fact. */
export function estimateJanuaryManufacture(input: CalculationInput, year: number) {
  return januaryManufactureMonths(year).map(manufactureDate => {
    const scenario = { ...input, manufactureDate };
    return { manufactureDate, input: scenario, result: calculateImportEstimate(scenario) };
  });
}
