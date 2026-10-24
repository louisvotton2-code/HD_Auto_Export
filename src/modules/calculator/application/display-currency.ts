import { getCountryByCode } from '../config/countries';
import { Amount } from '../core/decimal';
import type { CalculationInput } from '../core/types';
import type { ExchangeRateSnapshot } from '../infrastructure/exchange-rates';

function decimal(value: unknown): InstanceType<typeof Amount> | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = new Amount(value.trim());
  return parsed.isFinite() ? parsed : null;
}

/**
 * Secondary USD display only; never changes the local tax amount or its scope.
 * Price-based countries follow the transaction rate actually used by the input,
 * including manual overrides. GE does not use that field and follows GEL/USD.
 */
export function convertImportAmountToUsd(
  amount: string,
  input: CalculationInput,
  snapshot: ExchangeRateSnapshot,
): string | null {
  const localAmount = decimal(amount);
  const country = getCountryByCode(input.country);
  if (!localAmount || !country) return null;

  let localPerUsd: InstanceType<typeof Amount> | null;
  if (input.country === 'UZ' && input.currency !== 'USD') {
    localPerUsd = decimal(input.usdRate);
  } else if (country.needsPrice) {
    const transactionRate = decimal(input.transactionRate);
    const transactionPerUsd = decimal(snapshot.rates[input.currency]);
    if (!transactionRate?.gt(0) || !transactionPerUsd?.gt(0)) return null;
    localPerUsd = transactionRate.mul(transactionPerUsd);
  } else {
    // The country configuration supplies the mapping for all seven destinations.
    localPerUsd = decimal(snapshot.rates[country.currency]);
  }

  if (!localPerUsd?.gt(0)) return null;
  return localAmount.div(localPerUsd).toFixed(2);
}
