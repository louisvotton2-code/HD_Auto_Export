import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { assertFxRefreshAuthorization, normalizeFxRates, parseProviderFx, SYNTHETIC_FX_RATES } from './fx.js';

const now = new Date('2026-11-10T12:00:00.000Z');
const seconds = (date: string) => Date.parse(date) / 1000;
const response = () => ({ result: 'success', base_code: 'USD', time_last_update_unix: seconds('2026-11-10T00:00:00Z'),
  time_next_update_unix: seconds('2026-11-11T00:00:00Z'), time_eol_unix: 0, rates: { USD: 1, CNY: 7.1234, JPY: 150, XYZ: 999 } });

test('provider snapshot retains only supported fixed-point rates and has a precise seven-day bound', () => {
  const quote = parseProviderFx(response(), now);
  assert.deepEqual(quote, { source: 'exchange_rate_api', asOf: '2026-11-10T00:00:00.000Z',
    expiresAt: '2026-11-17T00:00:00.000Z', rates: { USD: '1', CNY: '7.1234', JPY: '150' } });
  assert.equal('XYZ' in quote.rates, false);
  assert.equal(parseProviderFx({ ...response(), time_eol_unix: seconds('2026-11-12T00:00:00Z') }, now).expiresAt, '2026-11-12T00:00:00.000Z');
  assert.equal(parseProviderFx({ ...response(), time_next_update_unix: seconds('2026-11-11T00:00:00Z') }, new Date('2026-11-16')).expiresAt, quote.expiresAt);
});

test('bad source identity, dates, expiration and provider failure never become usable quotes', () => {
  const bad = [null, [], {}, { ...response(), result: 'error' }, { ...response(), base_code: 'EUR' },
    { ...response(), time_last_update_unix: seconds('2026-11-11') },
    { ...response(), time_last_update_unix: seconds('2026-11-01') },
    { ...response(), time_last_update_unix: 1.1 }, { ...response(), time_last_update_unix: '123' },
    { ...response(), time_last_update_unix: Number.MAX_SAFE_INTEGER },
    { ...response(), time_eol_unix: seconds('2026-11-09') }, { ...response(), time_eol_unix: -1 },
    { ...response(), time_next_update_unix: response().time_last_update_unix }];
  for (const input of bad) assert.throws(() => parseProviderFx(input, now));
  assert.throws(() => parseProviderFx(response(), new Date('2026-11-17T00:00:00Z')));
  assert.throws(() => parseProviderFx(response(), new Date(NaN)));
});

test('rates require base USD=1, strict positive bounded decimals, and normalize equivalent values', () => {
  for (const input of [{}, { CNY: 7 }, { USD: 2 }, { USD: '01' }, { USD: 1, CNY: 0 }, { USD: 1, CNY: ' 7' },
    { USD: 1, CNY: '7e0' }, { USD: 1, CNY: Infinity }, { USD: 1, CNY: -7 }, { USD: 1, CNY: 101 },
    { USD: 1, EUR: 0.001 }, { USD: 1, JPY: 100001 }, { USD: 1, CNY: '7.1234567890123' }, { USD: 1, CNY: null }]) {
    assert.throws(() => normalizeFxRates(input));
  }
  assert.deepEqual(normalizeFxRates({ USD: '1.000', CNY: '7.10000', EUR: 0.01, XXX: 'not supported' }), { USD: '1', CNY: '7.1', EUR: '0.01' });
  assert.deepEqual(normalizeFxRates(SYNTHETIC_FX_RATES.a), SYNTHETIC_FX_RATES.a);
  assert.deepEqual(normalizeFxRates(SYNTHETIC_FX_RATES.b), SYNTHETIC_FX_RATES.b);
});

test('network authorization is explicit and exclusive to a new local FX preview database', () => {
  const auth = { networkEnabled: true, mode: 'synthetic', nodeEnv: 'test', databaseUrl: 'postgresql://user:secret@127.0.0.1:55432/hd_ext_fx_preview_123' };
  assert.equal(assertFxRefreshAuthorization(auth), 'hd_ext_fx_preview_123');
  for (const patch of [{ networkEnabled: false }, { mode: 'synthetic-scale' }, { mode: 'disabled' }, { nodeEnv: 'production' },
    { databaseUrl: 'postgresql://user:secret@localhost/hd_ext_fx_preview_123' },
    { databaseUrl: 'postgresql://user:secret@remote.invalid/hd_ext_fx_preview_123' },
    { databaseUrl: 'postgresql://user:secret@127.0.0.1/hd_ext_scale_123' },
    { databaseUrl: 'postgresql://user:secret@127.0.0.1/hd_ext_real_123' },
    { databaseUrl: `${auth.databaseUrl}?options=untrusted` }, { databaseUrl: `${auth.databaseUrl}#ignored` },
    { databaseUrl: 'bad-secret-sentinel' }]) assert.throws(() => assertFxRefreshAuthorization({ ...auth, ...patch }), /FX network gate rejected/);
});

test('CLI invalid/closed gate errors omit connection secrets and exit before opening a database', async () => {
  for (const databaseUrl of ['bad-password-sentinel', 'postgresql://user:password-sentinel@127.0.0.1:1/hd_ext_scale_123']) {
    let rejected = false;
    try {
      await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/external/fx-cli.ts', '--refresh'],
        { timeout: 5000, env: { ...process.env, NODE_ENV: 'test', EXTERNAL_CATALOG_MODE: 'synthetic-scale', EXTERNAL_FX_NETWORK: 'enabled',
          DATABASE_URL_FILE: undefined, DATABASE_URL: databaseUrl } });
    } catch (error) {
      rejected = true;
      const result = error as { code: number; stdout: string; stderr: string };
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /FX command failed/);
      assert.doesNotMatch(result.stderr, /sentinel|ECONNREFUSED|postgresql/);
    }
    assert.ok(rejected);
  }
});

test('formal FX refresh requires explicit database identity, production release and network gate',()=>{
 const auth={networkEnabled:true,mode:'disabled',nodeEnv:'production',databaseUrl:'postgresql://operator@db/formal_catalog',formalDatabase:'formal_catalog',releaseId:'a'.repeat(40)};
 assert.equal(assertFxRefreshAuthorization(auth),'formal_catalog');
 for(const change of [{networkEnabled:false},{nodeEnv:'test'},{mode:'synthetic'},{formalDatabase:'another_db'},{releaseId:'unreleased'},{databaseUrl:'postgresql://operator@db/formal_catalog?options=override'}])assert.throws(()=>assertFxRefreshAuthorization({...auth,...change}));
 assert.throws(()=>assertFxRefreshAuthorization({...auth,formalDatabase:undefined}));
});
