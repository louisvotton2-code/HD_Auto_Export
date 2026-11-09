import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDatabase } from '../src/db/index.js';
import { readFxQuote, readFxHealth, seedSyntheticFx, refreshFxQuote } from '../src/external/fx.js';

// This suite owns one random local database, reads no env files, and injects all
// provider responses. It never starts an HTTP server or makes a real FX request.
function maintenanceAddress() {
  try {
    const url = new URL(process.env.API_TEST_DATABASE_URL ?? 'postgresql://hd_local:local-development-only@127.0.0.1:55432/postgres');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
        url.pathname !== '/postgres' || url.search || url.hash) throw new Error();
    return url;
  } catch { throw new Error('FX tests require a local PostgreSQL maintenance URL without options.'); }
}
const address = maintenanceAddress();
const name = `hd_ext_fx_preview_${randomBytes(8).toString('hex')}`;
const testAddress = new URL(address); testAddress.pathname = `/${name}`;
const maintenance = createDatabase(address.toString(), 1);
const db = createDatabase(testAddress.toString(), 5);
let created = false;
const revision = async () => (await db.pool.query<{ revision: string }>('SELECT revision FROM public_catalog_state WHERE id=1')).rows[0]!.revision;
const current = () => db.transaction(tx => readFxQuote(tx));
const health = () => db.transaction(tx => readFxHealth(tx));
const stored = async () => (await db.pool.query('SELECT * FROM public_fx_quote WHERE id=1')).rows[0];
const insert = (rates: unknown = { USD: '1', CNY: '7' }) => db.pool.query(`INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates)
  VALUES(1,'synthetic',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '168 hours',$1)`, [JSON.stringify(rates)]);
const authorization = { networkEnabled: true, mode: 'synthetic', nodeEnv: 'test', databaseUrl: testAddress.toString() };
function provider(asOf = Math.floor(Date.now() / 1000), cny = 7) {
  return { result: 'success', base_code: 'USD', time_last_update_unix: asOf,
    time_next_update_unix: asOf + 86400, time_eol_unix: 0, rates: { USD: 1, CNY: cny } };
}
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const claim = async () => (await db.pool.query('SELECT * FROM fx_refresh_state WHERE id=1')).rows[0];
async function cliEnvironment(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hd-fx-cli-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'database-url');
  await writeFile(file, testAddress.toString(), { mode: 0o600 });
  return { PATH: process.env.PATH, NODE_ENV: 'test', EXTERNAL_CATALOG_MODE: 'synthetic', DATABASE_URL_FILE: file };
}
const runHealthCli = (env: NodeJS.ProcessEnv) => promisify(execFile)(process.execPath,
  ['--import', 'tsx', 'src/external/fx-cli.ts', '--health'],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), env, timeout: 5000 });
async function makeAttemptEligible() {
  // Only this test's random database: model an elapsed claim window without a
  // 24-hour test or changing the provider snapshot's real freshness timestamps.
  await db.pool.query(`WITH clock AS (SELECT clock_timestamp() AS now) UPDATE fx_refresh_state
    SET last_attempt_at=clock.now-interval '25 hours',next_attempt_at=clock.now-interval '1 hour' FROM clock WHERE id=1`);
}

before(async () => {
  await maintenance.pool.query(`CREATE DATABASE "${name}"`); created = true;
  await db.transaction(async tx => {
    for (const migration of ['0000_inventory', '0001_media_rights', '0002_vehicle_recycle_and_sources',
      '0003_vehicle_localization', '0004_external_catalog', '0006_public_catalog_version', '0009_fx_quote']) {
      await tx.query(await readFile(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'));
    }
  });
});
beforeEach(async () => {
  await db.transaction(async tx => {
    await tx.query('DELETE FROM public_fx_quote');
    await tx.query("UPDATE fx_refresh_state SET attempt_id=NULL,last_attempt_at=NULL,next_attempt_at=NULL,outcome='never' WHERE id=1");
  });
});
after(async () => {
  try { await db.close(); }
  finally {
    try { if (created) await maintenance.pool.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
    finally { await maintenance.close(); }
  }
});

test('SQL rejects missing USD, unsupported currencies and rates outside each supported range', async () => {
  const ranges = { USD: [1, 1], CNY: [0.1, 100], EUR: [0.01, 100], GBP: [0.01, 100], AED: [0.1, 100],
    RUB: [1, 10_000], KRW: [10, 100_000], KZT: [1, 100_000], UZS: [10, 1_000_000], GEL: [0.01, 1000],
    AMD: [1, 100_000], KGS: [1, 10_000], ALL: [1, 10_000], JPY: [1, 100_000] };
  const valid = async (rates: unknown) => (await db.pool.query<{ valid: boolean }>('SELECT valid_public_fx_rates($1::jsonb) AS valid', [JSON.stringify(rates)])).rows[0]!.valid;
  for (const invalid of [{}, { CNY: '7' }, [], null, { USD: 1 }, { USD: '1', BTC: '1' }, { USD: '1', CNY: 'NaN' }, { USD: '1', CNY: '-1' }]) {
    assert.equal(await valid(invalid), false, JSON.stringify(invalid));
    await assert.rejects(insert(invalid), { code: '23514' });
  }
  for (const [currency, [low, high]] of Object.entries(ranges)) {
    for (const value of [low!, high!]) assert.equal(await valid({ USD: '1', [currency]: String(value) }), true, `${currency} inclusive bound`);
    for (const value of [low! / 10, high! * 10]) assert.equal(await valid({ USD: '1', [currency]: String(value) }), false, `${currency} out of range`);
  }
});

test('SQL freshness is at most 168 elapsed hours across both daylight-saving transitions', async () => {
  await db.transaction(async tx => {
    await tx.query("SET LOCAL TIME ZONE 'America/New_York'");
    await tx.query(`INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates)
      VALUES(1,'synthetic','2024-03-09T00:00:00Z','2024-03-16T00:00:00Z','{"USD":"1"}')`);
    assert.equal(Number((await tx.query("SELECT extract(epoch FROM expires_at-as_of)/3600 AS hours FROM public_fx_quote")).rows[0].hours), 168);
  });
  await db.pool.query('DELETE FROM public_fx_quote');
  await assert.rejects(db.transaction(async tx => {
    await tx.query("SET LOCAL TIME ZONE 'America/New_York'");
    await tx.query(`INSERT INTO public_fx_quote(id,source,as_of,expires_at,rates)
      VALUES(1,'synthetic','2024-11-02T00:00:00Z','2024-11-09T01:00:00Z','{"USD":"1"}')`);
  }), { code: '23514' });
  assert.equal(await stored(), undefined);
});

test('snapshot identity and public revision change only with committed quote content', async () => {
  const start = BigInt(await revision());
  await insert(); const first = await stored();
  assert.equal(BigInt(await revision()), start + 1n);
  await db.pool.query('UPDATE public_fx_quote SET rates=rates,version=$1 WHERE id=1', [randomUUID()]);
  assert.equal((await stored()).version, first.version);
  assert.equal(BigInt(await revision()), start + 1n);
  await assert.rejects(db.transaction(async tx => {
    await tx.query(`UPDATE public_fx_quote SET rates='{"USD":"1","CNY":"8"}' WHERE id=1`);
    assert.notEqual((await tx.query('SELECT version FROM public_fx_quote')).rows[0].version, first.version);
    throw new Error('Synthetic rollback');
  }), /Synthetic rollback/);
  assert.deepEqual(await stored(), first); assert.equal(BigInt(await revision()), start + 1n);
  await db.transaction(async tx => {
    await tx.query(`UPDATE public_fx_quote SET rates='{"USD":"1","CNY":"8"}' WHERE id=1`);
    await tx.query(`UPDATE public_fx_quote SET source='exchange_rate_api' WHERE id=1`);
  });
  assert.notEqual((await stored()).version, first.version);
  assert.equal(BigInt(await revision()), start + 2n);
});

test('synthetic A/B fixtures are idempotent per UTC day and expiry never extends on re-seed', async () => {
  const first = await seedSyntheticFx(db, 'a'); assert.equal(first.changed, true);
  const a = await stored(); const firstRevision = await revision();
  assert.equal(new Date(a.as_of).toISOString().slice(11), '00:00:00.000Z');
  assert.equal(new Date(a.expires_at).getTime() - new Date(a.as_of).getTime(), 168 * 3600_000);
  assert.equal((await seedSyntheticFx(db, 'a')).changed, false);
  assert.deepEqual(await stored(), a); assert.equal(await revision(), firstRevision);
  const second = await seedSyntheticFx(db, 'b'); assert.equal(second.changed, true);
  assert.notEqual(second.quote.version, first.quote.version); assert.notDeepEqual(second.quote.rates, first.quote.rates);
  const beforeExpired = await revision(); const expired = await seedSyntheticFx(db, 'expired'); assert.equal(expired.changed, true);
  assert.equal(await current(), null); assert.equal((await seedSyntheticFx(db, 'expired')).changed, false);
  assert.equal(BigInt(await revision()), BigInt(beforeExpired) + 1n);
});

test('quote availability uses one transaction timestamp and never returns an expired or future snapshot to a new transaction', async () => {
  await insert();
  await db.transaction(async tx => {
    await tx.query("UPDATE public_fx_quote SET as_of=CURRENT_TIMESTAMP-interval '1 hour',expires_at=CURRENT_TIMESTAMP+interval '10 milliseconds' WHERE id=1");
    const before = await readFxQuote(tx); assert.ok(before);
    await tx.query('SELECT pg_sleep(0.03)');
    assert.deepEqual(await readFxQuote(tx), before, 'one read transaction retains its CURRENT_TIMESTAMP freshness boundary');
  });
  assert.equal(await current(), null); assert.equal((await health()).status, 'expired');
  await db.pool.query("UPDATE public_fx_quote SET as_of=CURRENT_TIMESTAMP+interval '1 hour',expires_at=CURRENT_TIMESTAMP+interval '2 hours' WHERE id=1");
  assert.equal(await current(), null); assert.equal((await health()).status, 'expired');
});

test('health changes from fresh to retained at exactly 24 hours while the quote remains usable', async () => {
  await insert();
  await db.transaction(async tx => {
    await tx.query(`UPDATE public_fx_quote SET as_of=CURRENT_TIMESTAMP-interval '24 hours'+interval '1 millisecond',
      expires_at=CURRENT_TIMESTAMP+interval '144 hours'+interval '1 millisecond' WHERE id=1`);
    assert.equal((await readFxHealth(tx)).status, 'fresh'); assert.ok(await readFxQuote(tx));
    await tx.query(`UPDATE public_fx_quote SET as_of=CURRENT_TIMESTAMP-interval '24 hours',
      expires_at=CURRENT_TIMESTAMP+interval '144 hours' WHERE id=1`);
    const retained = await readFxHealth(tx), quote = await readFxQuote(tx);
    assert.equal(retained.status, 'retained'); assert.ok(quote);
    assert.equal(retained.version, quote.version);
    assert.equal(Date.parse(quote.expiresAt) - Date.parse(quote.asOf), 168 * 3600_000);
  });
});

test('concurrent refreshes commit exactly one durable claim before the injected provider call', async () => {
  const entered = deferred<void>(), release = deferred<void>(); let calls = 0;
  const initialRevision = await revision();
  const fetcher: typeof fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://open.er-api.com/v6/latest/USD'); assert.equal(options?.redirect, 'error');
    entered.resolve(); await release.promise; return response(provider());
  };
  const first = refreshFxQuote(db, authorization, fetcher);
  try {
    await Promise.race([entered.promise, first.then(() => { throw new Error('Refresh completed before entering the injected provider.'); })]);
    const pending = await claim();
    assert.equal(pending.outcome, 'pending'); assert.ok(pending.attempt_id);
    assert.equal(new Date(pending.next_attempt_at).getTime() - new Date(pending.last_attempt_at).getTime(), 24 * 3600_000);
    assert.equal(await stored(), undefined); assert.equal(await revision(), initialRevision);
    const followers = await Promise.all(Array.from({ length: 5 }, () => refreshFxQuote(db, authorization, fetcher)));
    assert.ok(followers.every(result => result.attempted === false && result.health.lastOutcome === 'pending'));
    assert.equal(calls, 1); assert.equal((await claim()).attempt_id, pending.attempt_id);
  } finally { release.resolve(); await first; }
  const result = await first;
  assert.equal(result.attempted, true); assert.equal(result.health.lastOutcome, 'success');
  assert.equal(result.health.status, 'fresh'); assert.ok(await current());
  assert.equal(BigInt(await revision()), BigInt(initialRevision) + 1n);
  assert.doesNotMatch(JSON.stringify(result.health), /"(?:rates|rate|CNY|USD|base|endpoint|error)"/);
});

test('a failed provider call consumes the 24-hour claim without replacing or extending the old quote', async () => {
  await seedSyntheticFx(db, 'a'); const old = await stored(), initialRevision = await revision(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('Synthetic provider failure'); };
  const failed = await refreshFxQuote(db, authorization, fetcher);
  assert.equal(failed.attempted, true); assert.equal(failed.health.lastOutcome, 'failed');
  assert.deepEqual(await stored(), old); assert.equal(await revision(), initialRevision);
  const consumed = await claim();
  const repeat = await refreshFxQuote(db, authorization, fetcher);
  assert.equal(repeat.attempted, false); assert.equal(calls, 1); assert.deepEqual(await claim(), consumed);
  assert.deepEqual(await stored(), old);
  assert.doesNotMatch(JSON.stringify(failed.health), /Synthetic provider failure|"rates"/);
});

test('HTTP failure, malformed JSON and oversized response bodies retain the old quote and consume each eligible claim', async () => {
  await seedSyntheticFx(db, 'a'); const old = await stored(), initialRevision = await revision();
  const replies = [() => new Response('Synthetic error', { status: 503 }), () => new Response('{bad json'),
    () => new Response('x'.repeat(65_537))];
  for (const [index, reply] of replies.entries()) {
    if (index) await makeAttemptEligible();
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return reply(); };
    const result = await refreshFxQuote(db, authorization, fetcher);
    assert.equal(result.attempted, true); assert.equal(result.health.lastOutcome, 'failed');
    assert.deepEqual(await stored(), old); assert.equal(await revision(), initialRevision);
    assert.equal((await refreshFxQuote(db, authorization, fetcher)).attempted, false);
    assert.equal(calls, 1);
  }
});

test('a nonresponding injected provider reaches the deadline, aborts, and cannot retry inside its claim window', async () => {
  await seedSyntheticFx(db, 'a'); const old = await stored(), initialRevision = await revision();
  let calls = 0, signal: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (_, options) => { calls++; signal = options?.signal; return new Promise<Response>(() => {}); };
  const result = await refreshFxQuote(db, authorization, fetcher);
  assert.equal(result.attempted, true); assert.equal(result.health.lastOutcome, 'failed'); assert.equal(signal?.aborted, true);
  assert.deepEqual(await stored(), old); assert.equal(await revision(), initialRevision);
  assert.equal((await refreshFxQuote(db, authorization, fetcher)).attempted, false); assert.equal(calls, 1);
});

test('a database failure after quote save rolls back both the snapshot and public revision, but not the committed claim', async () => {
  await seedSyntheticFx(db, 'a'); const old = await stored(), initialRevision = await revision();
  await db.pool.query(`CREATE FUNCTION test_reject_fx_success() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic completion failure'; END $$;
    CREATE TRIGGER test_reject_fx_success BEFORE UPDATE ON fx_refresh_state FOR EACH ROW
    WHEN (NEW.outcome='success') EXECUTE FUNCTION test_reject_fx_success()`);
  try {
    const result = await refreshFxQuote(db, authorization, async () => response(provider(undefined, 8)));
    assert.equal(result.attempted, true); assert.equal(result.health.lastOutcome, 'failed');
    assert.deepEqual(await stored(), old); assert.equal(await revision(), initialRevision);
    assert.ok((await claim()).attempt_id); assert.ok((await claim()).next_attempt_at);
  } finally {
    await db.pool.query('DROP TRIGGER test_reject_fx_success ON fx_refresh_state; DROP FUNCTION test_reject_fx_success()');
  }
});

test('a same provider snapshot is a no-op and an older response cannot overwrite a newer quote', async () => {
  const body = provider();
  assert.equal((await refreshFxQuote(db, authorization, async () => response(body))).health.lastOutcome, 'success');
  const first = await stored(), initialRevision = await revision();
  await makeAttemptEligible();
  assert.equal((await refreshFxQuote(db, authorization, async () => response(body))).health.lastOutcome, 'success');
  assert.deepEqual(await stored(), first); assert.equal(await revision(), initialRevision);
  await makeAttemptEligible();
  const older = await refreshFxQuote(db, authorization, async () => response(provider(body.time_last_update_unix - 3600, 8)));
  assert.equal(older.health.lastOutcome, 'failed'); assert.deepEqual(await stored(), first);
  assert.equal(await revision(), initialRevision);
});

test('authorization failures make no provider call and cannot consume a claim', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; return response(provider()); };
  const original = await claim();
  const otherDatabase = new URL(testAddress); otherDatabase.pathname = '/hd_ext_fx_preview_other';
  for (const denied of [{ ...authorization, networkEnabled: false }, { ...authorization, mode: 'synthetic-scale' },
    { ...authorization, nodeEnv: 'production' }, { ...authorization, databaseUrl: otherDatabase.toString() }]) {
    await assert.rejects(refreshFxQuote(db, denied, fetcher), /FX (?:network gate|database scope) rejected/);
  }
  assert.equal(calls, 0); assert.deepEqual(await claim(), original); assert.equal(await stored(), undefined);
});

test('real health CLI accepts DATABASE_URL_FILE alone and emits only the safe health projection', async t => {
  await seedSyntheticFx(db, 'a'); const priorClaim = await claim();
  const result = await runHealthCli(await cliEnvironment(t));
  assert.equal(result.stderr, ''); assert.deepEqual(JSON.parse(result.stdout), await health());
  assert.doesNotMatch(result.stdout, /postgres(?:ql)?:|"(?:rates|CNY|USD|databaseUrl|password)"/);
  assert.deepEqual(await claim(), priorClaim, '--health cannot claim a provider refresh');
});

test('real health CLI rejects inline plus file configuration without exposing the sentinel or opening a connection', async t => {
  const env = await cliEnvironment(t), priorClaim = await claim();
  await assert.rejects(runHealthCli({ ...env,
    DATABASE_URL: 'postgresql://fake:cli-inline-sentinel@127.0.0.1:1/hd_ext_fx_preview_denied' }), error => {
    const result = error as { code: number; stdout: string; stderr: string };
    assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.match(result.stderr, /FX command failed/);
    assert.doesNotMatch(result.stderr, /sentinel|postgres(?:ql)?:|ECONNREFUSED|database-url/);
    return true;
  });
  assert.deepEqual(await claim(), priorClaim);
});
