import { Amount } from '../core/decimal';
import type { CountryCode, TransactionCurrency } from '../core/types';

export const EXCHANGE_CURRENCIES = [
  'USD',
  'CNY',
  'EUR',
  'RUB',
  'KZT',
  'UZS',
  'GEL',
  'AMD',
  'KGS',
  'ALL',
] as const;
export type ExchangeCurrency = (typeof EXCHANGE_CURRENCIES)[number];
export type ExchangeRates = Record<ExchangeCurrency, string>;

/** Market conversion estimates; these are never official customs exchange rates. */
export type ExchangeRateSnapshot = {
  asOf: string;
  /** Units of each currency for one USD. */
  rates: ExchangeRates;
} & (
  | { status: 'live'; source: 'open.er-api.com' }
  | { status: 'reference'; source: 'reference_snapshot' }
);

export interface DerivedRates {
  transactionRate: string;
  euroRate: string;
  usdRate: string;
}

export const EXCHANGE_RATE_ATTRIBUTION = {
  label: 'Rates By Exchange Rate API',
  url: 'https://www.exchangerate-api.com',
} as const;

/** Research capture date, NOT a claim that the following are market rates for that date. */
export const REFERENCE_FX_DATE = '2026-10-22';

const destinationCurrencies: Record<CountryCode, ExchangeCurrency> = {
  RU: 'RUB',
  KZ: 'KZT',
  UZ: 'UZS',
  GE: 'GEL',
  AM: 'AMD',
  KG: 'KGS',
  AL: 'ALL',
};

/**
 * Illustration-only fallback copied as facts from docs/research/reference-default-results.json:
 * russia.rubPerUnit/rubPerEur, kazakhstan.kztPerUnit, uzbekistan.uzsPerUsd,
 * georgia.gelPerUsd, armenia.amdPerUnit, kyrgyzstan.eurPerUnit × kgsPerEur,
 * and albania.allPerUnit. CNY/USD=6.9 is an explicit demonstration assumption.
 * The examples are not a coherent historic market fixing; use a single RU-derived
 * EUR/USD anchor so conversions remain internally consistent across destinations.
 */
export const REFERENCE_FX_SNAPSHOT: ExchangeRateSnapshot = Object.freeze({
  status: 'reference',
  source: 'reference_snapshot',
  asOf: REFERENCE_FX_DATE,
  rates: Object.freeze({
    USD: '1',
    CNY: '6.9',
    EUR: new Amount('81.969182').div('94.7').toString(),
    RUB: '81.969182',
    KZT: '468.321957',
    UZS: '11851.454593',
    GEL: '2.7',
    AMD: '366.081469',
    KGS: new Amount('0.865939').mul('100.77').toString(),
    ALL: '80.7859',
  }),
});

function plainRate(value: InstanceType<typeof Amount>): string {
  return value.toFixed(12).replace(/\.?0+$/, '');
}

function positiveRate(value: string): InstanceType<typeof Amount> {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('invalid_exchange_rate');
  const amount = new Amount(value);
  if (!amount.isFinite() || !amount.gt(0)) throw new Error('invalid_exchange_rate');
  return amount;
}

/** Pure cross-rate conversion; neither language nor transaction amounts are changed. */
export function deriveRates(
  snapshot: ExchangeRateSnapshot,
  country: CountryCode,
  currency: TransactionCurrency,
): DerivedRates {
  const destination = positiveRate(snapshot.rates[destinationCurrencies[country]]);
  return {
    transactionRate: plainRate(destination.div(positiveRate(snapshot.rates[currency]))),
    euroRate: plainRate(destination.div(positiveRate(snapshot.rates.EUR))),
    usdRate: plainRate(destination),
  };
}

export function getReferenceRate(
  country: CountryCode,
  currency: TransactionCurrency,
): DerivedRates {
  return deriveRates(REFERENCE_FX_SNAPSHOT, country, currency);
}

/** Do not share the frozen constant with code that may update UI state. */
export function createReferenceSnapshot(): ExchangeRateSnapshot {
  return { ...REFERENCE_FX_SNAPSHOT, rates: { ...REFERENCE_FX_SNAPSHOT.rates } };
}
