import type { Amount } from './decimal';
import type { CalculationLine } from './types';

export function tariffLine(
  id: string,
  amount: InstanceType<typeof Amount>,
  formula: string,
  key: string,
  params: Record<string, string | number> = {},
): CalculationLine {
  return { id, amount: amount.toFixed(2), formula, method: { key, params } };
}
