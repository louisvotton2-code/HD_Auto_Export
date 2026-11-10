import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SUPPORTED_CURRENCIES, type Currency } from '@hd/contracts/public';
import type { Database } from '../db/index.js';

export type FxQuote = { version: string; asOf: string; expiresAt: string;
  source: 'exchange_rate_api' | 'synthetic'; rates: Partial<Record<Currency, string>> };
export type FxQueryable = Pick<PoolClient, 'query'>;
export const ACTIVE_FX_SQL = 'f.id=1 AND f.as_of<=CURRENT_TIMESTAMP AND f.expires_at>CURRENT_TIMESTAMP';
const week = 168 * 60 * 60 * 1000;
const endpoint = 'https://open.er-api.com/v6/latest/USD';
const limits: Record<Currency, readonly [number, number]> = {
  USD: [1, 1], CNY: [0.1, 100], EUR: [0.01, 100], GBP: [0.01, 100], AED: [0.1, 100],
  RUB: [1, 10000], KRW: [10, 100000], KZT: [1, 100000], UZS: [10, 1000000],
  GEL: [0.01, 1000], AMD: [1, 100000], KGS: [1, 10000], ALL: [1, 10000], JPY: [1, 100000],
};
type QuoteInput = Omit<FxQuote, 'version'>;
type QuoteRow = { version: string; as_of: Date; expires_at: Date; source: FxQuote['source']; rates: FxQuote['rates'] };
const mapQuote = (row: QuoteRow): FxQuote => ({ version: row.version, asOf: row.as_of.toISOString(),
  expiresAt: row.expires_at.toISOString(), source: row.source, rates: row.rates });
const invalid = () => new Error('Invalid FX snapshot.');

/** Provider rates are internal conversion inputs, never a public rates feed. */
export function normalizeFxRates(value: unknown): FxQuote['rates'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  const rates: FxQuote['rates'] = {};
  for (const currency of SUPPORTED_CURRENCIES) {
    if (!Object.hasOwn(input, currency)) continue;
    const raw = input[currency];
    if (typeof raw !== 'string' && typeof raw !== 'number') throw invalid();
    const text = String(raw);
    const [low, high] = limits[currency];
    if (!/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,12})?$/.test(text) || Number(text) < low || Number(text) > high) throw invalid();
    rates[currency] = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  }
  if (rates.USD !== '1') throw invalid();
  return rates;
}

function timestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 946684800 || value > 253402300799) throw invalid();
  return value * 1000;
}
export function parseProviderFx(value: unknown, now: Date): QuoteInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const body = value as Record<string, unknown>;
  if (body.result !== 'success' || body.base_code !== 'USD') throw invalid();
  const asOf = timestamp(body.time_last_update_unix);
  if (!Number.isFinite(now.getTime()) || asOf > now.getTime()) throw invalid();
  // next_update is a polling hint; the user's seven-day retention bound is independent.
  if (body.time_next_update_unix !== undefined && timestamp(body.time_next_update_unix) <= asOf) throw invalid();
  let expires = asOf + week;
  if (body.time_eol_unix !== undefined && body.time_eol_unix !== 0) expires = Math.min(expires, timestamp(body.time_eol_unix));
  if (expires <= now.getTime() || expires <= asOf || expires > 253402300799999) throw invalid();
  return { source: 'exchange_rate_api', asOf: new Date(asOf).toISOString(), expiresAt: new Date(expires).toISOString(), rates: normalizeFxRates(body.rates) };
}

export async function readFxQuote(tx: FxQueryable): Promise<FxQuote | null> {
  const result = await tx.query<QuoteRow>(`SELECT f.* FROM public_fx_quote f WHERE ${ACTIVE_FX_SQL}`);
  return result.rows[0] ? mapQuote(result.rows[0]) : null;
}
export type FxHealth = { status: 'missing' | 'fresh' | 'retained' | 'expired'; version: string | null;
  asOf: string | null; expiresAt: string | null; source: FxQuote['source'] | null;
  lastAttemptAt: string | null; nextAttemptAt: string | null; lastOutcome: 'never' | 'pending' | 'success' | 'failed' };
export async function readFxHealth(tx: FxQueryable): Promise<FxHealth> {
  const { rows: [row] } = await tx.query<Partial<QuoteRow> & { now: Date; last_attempt_at: Date | null;
    next_attempt_at: Date | null; outcome: FxHealth['lastOutcome'] }>(`SELECT f.version,f.as_of,f.expires_at,f.source,
    s.last_attempt_at,s.next_attempt_at,s.outcome,CURRENT_TIMESTAMP AS now
    FROM fx_refresh_state s LEFT JOIN public_fx_quote f ON f.id=1 WHERE s.id=1`);
  if (!row) throw new Error('FX migration is required.');
  const status = !row.version ? 'missing' : !row.as_of || !row.expires_at || row.as_of > row.now || row.expires_at <= row.now ? 'expired' :
    row.now.getTime() - row.as_of.getTime() < 86400000 ? 'fresh' : 'retained';
  return { status, version: row.version ?? null, asOf: row.as_of?.toISOString() ?? null, expiresAt: row.expires_at?.toISOString() ?? null,
    source: row.source ?? null, lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null, lastOutcome: row.outcome };
}

async function saveQuote(tx: FxQueryable, quote: QuoteInput, allowOlder = false) {
  // This singleton lock never locks vehicle rows; public revision changes remain deferred until commit.
  await tx.query('SELECT pg_advisory_xact_lock(86147,9)');
  const old = (await tx.query<QuoteRow>('SELECT * FROM public_fx_quote WHERE id=1 FOR UPDATE')).rows[0];
  if (old && !allowOlder && old.as_of.getTime() > Date.parse(quote.asOf)) throw invalid();
  const result = await tx.query<QuoteRow>(`INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates) VALUES(1,$1,$2,$3,$4)
    ON CONFLICT(id) DO UPDATE SET source=EXCLUDED.source,as_of=EXCLUDED.as_of,expires_at=EXCLUDED.expires_at,rates=EXCLUDED.rates
    WHERE ROW(public_fx_quote.source,public_fx_quote.as_of,public_fx_quote.expires_at,public_fx_quote.rates)
      IS DISTINCT FROM ROW(EXCLUDED.source,EXCLUDED.as_of,EXCLUDED.expires_at,EXCLUDED.rates) RETURNING *`,
  [quote.source, quote.asOf, quote.expiresAt, JSON.stringify(quote.rates)]);
  return { changed: result.rowCount === 1, quote: mapQuote(result.rows[0] ?? old!) };
}

export const SYNTHETIC_FX_RATES = {
  a: { USD: '1', CNY: '7', EUR: '0.9', RUB: '80', KRW: '1000', KZT: '500', UZS: '12500', GEL: '2.5', AMD: '400', KGS: '90', ALL: '100', JPY: '150', GBP: '0.8', AED: '3.67' },
  b: { USD: '1', CNY: '8', EUR: '0.8', RUB: '100', KRW: '1200', KZT: '600', UZS: '13000', GEL: '3', AMD: '420', KGS: '100', ALL: '110', JPY: '160', GBP: '0.75', AED: '3.68' },
} as const;
async function assertDatabase(tx: FxQueryable, pattern: RegExp, expected?: string) {
  const name = (await tx.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name;
  if (!name || !pattern.test(name) || (expected !== undefined && name !== expected)) throw new Error('FX database scope rejected.');
}
export async function seedSyntheticFx(db: Database, fixture: 'a' | 'b' | 'expired'): Promise<{ changed: boolean; quote: FxQuote }> {
  if (!['a', 'b', 'expired'].includes(fixture)) throw invalid();
  return db.transaction(async tx => {
    await assertDatabase(tx, /^hd_ext_(?:scale|fx_preview)_[a-z0-9_]+$/);
    const now = (await tx.query<{ now: Date }>('SELECT CURRENT_TIMESTAMP AS now')).rows[0]!.now;
    const asOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (fixture === 'expired' ? 8 * 86400000 : 0));
    return saveQuote(tx, { source: 'synthetic', asOf: asOf.toISOString(), expiresAt: new Date(asOf.getTime() + week).toISOString(),
      rates: { ...SYNTHETIC_FX_RATES[fixture === 'expired' ? 'a' : fixture] } }, true);
  });
}

export type FxRefreshAuthorization = { networkEnabled: boolean; mode: string; nodeEnv: string; databaseUrl: string };
export function assertFxRefreshAuthorization(auth: FxRefreshAuthorization) {
  let url: URL;
  try { url = new URL(auth.databaseUrl); } catch { throw new Error('FX network gate rejected.'); }
  if (!auth.networkEnabled || auth.nodeEnv !== 'test' || auth.mode !== 'synthetic' ||
      !['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      !/^\/hd_ext_fx_preview_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) throw new Error('FX network gate rejected.');
  return url.pathname.slice(1);
}

async function fetchSnapshot(fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('FX timeout.')); }, 3000); });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetcher(endpoint, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok || !response.body || (response.url && response.url !== endpoint)) throw invalid();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) { const result = await reader.read(); if (result.done) break;
          size += result.value.byteLength; if (size > 65536) throw invalid(); chunks.push(result.value); }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    })()]);
  } finally { clearTimeout(timer!); controller.abort(); }
}

/** Explicit administrative job only; no GET/public request calls this function. Failure never refunds the 24h claim. */
export async function refreshFxQuote(db: Database, authorization: FxRefreshAuthorization, fetcher: typeof fetch = fetch):
Promise<{ attempted: boolean; health: FxHealth }> {
  const expected = assertFxRefreshAuthorization(authorization);
  await assertDatabase(db.pool, /^hd_ext_fx_preview_[a-z0-9_]+$/, expected);
  const attempt = randomUUID();
  const claim = await db.pool.query(`WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS now)
    UPDATE fx_refresh_state SET attempt_id=$1,last_attempt_at=clock.now,next_attempt_at=clock.now+interval '24 hours',outcome='pending'
    FROM clock WHERE id=1 AND (next_attempt_at IS NULL OR next_attempt_at<=clock.now) RETURNING id`, [attempt]);
  if (!claim.rowCount) return { attempted: false, health: await readFxHealth(db.pool) };
  try {
    const response = await fetchSnapshot(fetcher);
    await db.transaction(async tx => {
      const now = (await tx.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
      await saveQuote(tx, parseProviderFx(response, now));
      const finished = await tx.query("UPDATE fx_refresh_state SET outcome='success' WHERE id=1 AND attempt_id=$1 RETURNING id", [attempt]);
      if (finished.rowCount !== 1) throw new Error('FX claim changed.');
    });
  } catch {
    await db.pool.query("UPDATE fx_refresh_state SET outcome='failed' WHERE id=1 AND attempt_id=$1", [attempt]);
  }
  return { attempted: true, health: await readFxHealth(db.pool) };
}
