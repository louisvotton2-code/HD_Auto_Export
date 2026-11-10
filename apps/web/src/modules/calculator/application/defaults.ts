import type { CalculationInput, CountryCode } from '../core/types';
import { Amount } from '../core/decimal';
import type { TransactionCurrency } from '../core/types';
import {
  deriveRates,
  REFERENCE_FX_SNAPSHOT,
  type ExchangeRateSnapshot,
} from '../infrastructure/exchange-rates';

/**
 * Editable demonstration facts for a useful first render, never a vehicle quotation.
 * The date and optional market snapshot are injected by the caller.
 */
export function createDefaultInput(
  country: CountryCode,
  date: string,
  snapshot: ExchangeRateSnapshot = REFERENCE_FX_SNAPSHOT,
): CalculationInput {
  return {
    country,
    importerType: 'individual',
    condition: 'used',
    powertrain: 'petrol',
    price: '25000',
    currency: 'USD',
    displacementCc: '1998',
    powerHp: '150',
    manufactureDate: '2021-01',
    customsDate: date,
    // No China freight quote is known; unknown costs must not silently become zero.
    freight: '',
    insurance: '',
    steering: 'left',
    ...deriveRates(snapshot, country, 'USD'),
  };
}

/** Currency switches preserve invalid/unfinished user input for the UI to flag. */
export function convertTransactionPrice(
  amount: string,
  from: TransactionCurrency,
  to: TransactionCurrency,
  snapshot: ExchangeRateSnapshot,
): string {
  if (!/^\d{1,18}(?:\.\d{1,12})?$/.test(amount.trim())) return amount;
  try {
    const fromRate = new Amount(snapshot.rates[from]);
    const toRate = new Amount(snapshot.rates[to]);
    if (!fromRate.isFinite() || !fromRate.gt(0) || !toRate.isFinite() || !toRate.gt(0))
      return amount;
    return new Amount(amount.trim()).div(fromRate).mul(toRate).toFixed(2);
  } catch {
    return amount;
  }
}
