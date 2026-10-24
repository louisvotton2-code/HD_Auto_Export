import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReferenceSnapshot,
  deriveRates,
  getReferenceRate,
  REFERENCE_FX_DATE,
  REFERENCE_FX_SNAPSHOT,
  type ExchangeRateSnapshot,
} from './exchange-rates';
import {
  fetchExchangeRates,
  MARKET_RATES_TIMEOUT_MS,
  MARKET_RATES_URL,
} from './exchange-rates.server';

const providerPayload = {
  result: 'success',
  base_code: 'USD',
  time_last_update_unix: 1792713600,
  rates: {
    USD: 1,
    CNY: 7,
    EUR: 0.8,
    RUB: 84,
    KZT: 500,
    UZS: 12000,
    GEL: 2.7,
    AMD: 400,
    KGS: 90,
    ALL: 90,
  },
};

afterEach(() => vi.useRealTimers());

describe('cross rates and reference provenance', () => {
  it('derives local-per-transaction and local-per-EUR rates from a USD base', () => {
    const snapshot: ExchangeRateSnapshot = {
      status: 'live',
      source: 'open.er-api.com',
      asOf: '2026-10-23',
      rates: Object.fromEntries(
        Object.entries(providerPayload.rates).map(([code, value]) => [code, String(value)]),
      ) as ExchangeRateSnapshot['rates'],
    };
    expect(deriveRates(snapshot, 'RU', 'CNY')).toEqual({
      transactionRate: '12',
      euroRate: '105',
      usdRate: '84',
    });
    expect(deriveRates(snapshot, 'RU', 'USD')).toEqual({
      transactionRate: '84',
      euroRate: '105',
      usdRate: '84',
    });
    expect(deriveRates(snapshot, 'GE', 'CNY')).toEqual({
      transactionRate: '0.385714285714',
      euroRate: '3.375',
      usdRate: '2.7',
    });
  });

  it('labels the fallback as an illustration and retains the existing RU USD reference pair', () => {
    expect(REFERENCE_FX_SNAPSHOT).toMatchObject({
      status: 'reference',
      source: 'reference_snapshot',
      asOf: REFERENCE_FX_DATE,
    });
    expect(getReferenceRate('RU', 'USD')).toEqual({
      transactionRate: '81.969182',
      euroRate: '94.7',
      usdRate: '81.969182',
    });
    expect(REFERENCE_FX_SNAPSHOT.rates).toMatchObject({
      CNY: '6.9',
      KZT: '468.321957',
      UZS: '11851.454593',
      GEL: '2.7',
      AMD: '366.081469',
      ALL: '80.7859',
    });
  });

  it('returns independent fallback objects so consumers cannot change future defaults', () => {
    const reference = createReferenceSnapshot();
    reference.rates.CNY = '99';
    expect(createReferenceSnapshot().rates.CNY).toBe('6.9');
  });
});

describe('server-only market snapshot loading', () => {
  it('selects all required currencies, keeps the provider timestamp and requests hourly caching', async () => {
    const fetcher = vi.fn(async () => Response.json(providerPayload));
    const snapshot = await fetchExchangeRates(fetcher);
    expect(snapshot).toMatchObject({
      status: 'live',
      source: 'open.er-api.com',
      asOf: '2026-10-23',
      rates: { CNY: '7', RUB: '84', EUR: '0.8' },
    });
    expect(fetcher).toHaveBeenCalledWith(
      MARKET_RATES_URL,
      expect.objectContaining({ cache: 'force-cache', signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    { ...providerPayload, result: 'error' },
    { ...providerPayload, base_code: 'EUR' },
    { ...providerPayload, time_last_update_unix: '2026-10-23' },
    { ...providerPayload, rates: { ...providerPayload.rates, CNY: 0 } },
    { ...providerPayload, rates: { ...providerPayload.rates, GEL: -1 } },
    { ...providerPayload, rates: { ...providerPayload.rates, RUB: 'bad' } },
    { ...providerPayload, rates: { ...providerPayload.rates, ALL: undefined } },
    { ...providerPayload, rates: { ...providerPayload.rates, USD: 2 } },
  ])('does not label malformed provider data as live', async (payload) => {
    expect(await fetchExchangeRates(async () => Response.json(payload))).toEqual(
      REFERENCE_FX_SNAPSHOT,
    );
  });

  it('returns the explicit fallback on HTTP failure, invalid JSON or a network exception', async () => {
    const unavailable = await fetchExchangeRates(
      async () => new Response('unavailable', { status: 503 }),
    );
    const invalidJson = await fetchExchangeRates(async () => new Response('{invalid-json'));
    const networkFailure = await fetchExchangeRates(async () => {
      throw new Error('offline');
    });
    for (const result of [unavailable, invalidJson, networkFailure]) {
      expect(result).toMatchObject({
        status: 'reference',
        source: 'reference_snapshot',
        asOf: REFERENCE_FX_DATE,
      });
      expect(result.rates).toEqual(REFERENCE_FX_SNAPSHOT.rates);
    }
  });

  it('aborts a stalled provider request after three seconds and resolves to the fallback', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = fetchExchangeRates(fetcher);
    await vi.advanceTimersByTimeAsync(MARKET_RATES_TIMEOUT_MS);
    expect(await pending).toMatchObject({ status: 'reference', source: 'reference_snapshot' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
