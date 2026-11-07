import Decimal from 'decimal.js';

// A private constructor prevents callers' Decimal.set() calls from changing a quote.
export const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function roundedAmount(value: Decimal): string {
  return value.toFixed(0, Decimal.ROUND_HALF_UP);
}
