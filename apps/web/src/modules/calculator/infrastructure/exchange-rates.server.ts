import {
  createReferenceSnapshot,
  EXCHANGE_CURRENCIES,
  type ExchangeRates,
  type ExchangeRateSnapshot,
} from './exchange-rates';

/**
 * BUILD-TIME PAGE USE ONLY. Do not expose this data through a public FX proxy/API.
 * Provider terms allow cached end-use conversions but forbid data redistribution:
 * https://www.exchangerate-api.com/terms (LICENSE / Data Caching Policy).
 * Pages using these estimates must show the provider attribution link:
 * https://www.exchangerate-api.com/docs/free (Attribution).
 * The exported calculator embeds a build-time snapshot. Refresh by rebuilding;
 * no timer or currency service runs on the static hosting server.
 */
export const MARKET_RATES_URL = 'https://open.er-api.com/v6/latest/USD';
export const MARKET_RATES_TIMEOUT_MS = 3000;

type ServerFetch = (input: string, init?: RequestInit) => Promise<Response>;

function parseSnapshot(body: unknown): ExchangeRateSnapshot {
  if (!body || typeof body !== 'object') throw new Error('invalid_exchange_response');
  const data = body as Record<string, unknown>;
  if (
    data.result !== 'success' ||
    data.base_code !== 'USD' ||
    !data.rates ||
    typeof data.rates !== 'object'
  ) {
    throw new Error('invalid_exchange_response');
  }
  if (
    typeof data.time_last_update_unix !== 'number' ||
    !Number.isSafeInteger(data.time_last_update_unix) ||
    data.time_last_update_unix <= 0
  ) {
    throw new Error('invalid_exchange_timestamp');
  }
  const asOf = new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('invalid_exchange_timestamp');
  const rawRates = data.rates as Record<string, unknown>;
  const rates = {} as ExchangeRates;
  for (const code of EXCHANGE_CURRENCIES) {
    const value = rawRates[code];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 1_000_000_000
    ) {
      throw new Error('invalid_exchange_rate');
    }
    rates[code] = value.toString();
    // Scientific notation is neither needed by the supported currencies nor accepted by the core.
    if (!/^\d+(?:\.\d+)?$/.test(rates[code])) throw new Error('invalid_exchange_rate');
  }
  if (rates.USD !== '1') throw new Error('invalid_exchange_base');
  return { status: 'live', source: 'open.er-api.com', asOf, rates };
}

/** Failed or malformed provider responses return an explicitly labelled demo snapshot. */
export async function fetchExchangeRates(
  fetcher: ServerFetch = fetch,
): Promise<ExchangeRateSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MARKET_RATES_TIMEOUT_MS);
  try {
    const response = await fetcher(MARKET_RATES_URL, {
      cache: 'force-cache',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('exchange_rate_service_unavailable');
    return parseSnapshot(await response.json());
  } catch {
    return createReferenceSnapshot();
  } finally {
    clearTimeout(timeout);
  }
}
