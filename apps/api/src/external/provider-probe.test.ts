import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderProbe, type ProviderProbeResult, type ProviderProbeState } from './provider-probe.js';

const checkedAt = '2026-11-11T10:00:00.000Z';
const now = () => new Date(checkedAt);
const account = () => ({ product: 'chinacarapi', plan: 'starter', sources: ['dongchedi', 'che168'], expiresAt: '2026-11-19T09:12:44.000Z' });
const json = (value: unknown) => Response.json(value);
const empty = (state: ProviderProbeState, at: string | null = checkedAt): ProviderProbeResult => ({
  state, checkedAt: at, plan: null, expiresAt: null, sources: [], dailyLimit: null, remainingToday: null,
});

test('missing configuration never fetches or invents a check timestamp', async () => {
  for (const key of [undefined, '', ' \n\t ']) {
    const probe = createProviderProbe(key, { fetch: async () => { assert.fail('No network without a key'); }, now });
    assert.deepEqual(await probe(), empty('not_configured', null));
    assert.deepEqual(await probe(), empty('not_configured', null));
  }
});

test('only the fixed account URL and documented header are used, with redirects and credentials disabled', async () => {
  let calls = 0;
  const probe = createProviderProbe('test-api-key', { now, fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.chinacarapi.com/api/me');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'omit');
    assert.ok(init?.signal);
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { accept: 'application/json', 'x-api-key': 'test-api-key' });
    return json({ ...account(), apiKey: 'private-secret', email: 'private@example.invalid', unknown: { account: 'private' } });
  } });
  assert.deepEqual(await probe(), { state: 'ok', checkedAt, plan: 'starter', expiresAt: account().expiresAt,
    sources: ['dongchedi', 'che168'], dailyLimit: null, remainingToday: null });
  assert.equal(calls, 1);
});

test('documented quota values are retained exactly, optional values stay null, and offsets normalize to UTC', async () => {
  for (const value of [
    { dailyLimit: 1000, remainingToday: 0 },
    { dailyLimit: null, remainingToday: null },
    { dailyLimit: 0, remainingToday: 0 },
    { remainingToday: 12 },
  ]) {
    const probe = createProviderProbe('synthetic-key', { now, fetch: async () => json({ ...account(), ...value,
      expiresAt: '2026-11-19T17:12:44+08:00' }) });
    const result = await probe();
    assert.equal(result.state, 'ok');
    assert.equal(result.dailyLimit, value.dailyLimit ?? null);
    assert.equal(result.remainingToday, value.remainingToday ?? null);
    assert.equal(result.expiresAt, '2026-11-19T09:12:44.000Z');
  }
  const absent = await createProviderProbe('synthetic-key', { now, fetch: async () => json({
    product: 'chinacarapi', plan: 'trial', sources: [],
  }) })();
  assert.equal(absent.state, 'ok');
  assert.equal(absent.expiresAt, null);
});

test('malformed or unrecognized account shapes are rejected rather than projected as a healthy account', async () => {
  const invalid: unknown[] = [null, [], 'ok', {}, { plan: 'starter', sources: [] },
    { ...account(), product: 'unrecognized' }, { ...account(), plan: 'secret-sentinel' },
    { ...account(), sources: ['unknown'] }, { ...account(), sources: ['che168', 'che168'] },
    { ...account(), sources: 'che168' }, { ...account(), expiresAt: 'tomorrow' },
    { ...account(), expiresAt: '2026-02-30T00:00:00.000Z' }, { ...account(), expiresAt: 123 },
    { ...account(), dailyLimit: -1 }, { ...account(), dailyLimit: 1.5 },
    { ...account(), remainingToday: '10' }, { ...account(), remainingToday: Number.MAX_SAFE_INTEGER + 1 },
    { ...account(), remainingToday: -1 }];
  for (const value of invalid) {
    assert.deepEqual(await createProviderProbe('synthetic-key', { now, fetch: async () => json(value) })(), empty('invalid_response'));
  }
});

test('HTTP failures return only generic states and never read provider error details', async () => {
  for (const [status, state] of [[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate_limited'],
    [400, 'unavailable'], [404, 'unavailable'], [500, 'unavailable'], [503, 'unavailable']] as const) {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('secret error body with private account')); },
      cancel() { canceled = true; },
    });
    const probe = createProviderProbe('synthetic-key', { now, fetch: async () => new Response(body, { status }) });
    assert.deepEqual(await probe(), empty(state));
    assert.equal(canceled, true);
  }
});

test('redirect responses and redirected doubles are unavailable and never followed', async () => {
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://other.example.invalid/leak' } }),
    Object.defineProperty(json(account()), 'redirected', { value: true }) as Response]) {
    let calls = 0;
    const result = await createProviderProbe('synthetic-key', { now, fetch: async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, 'error');
      return response;
    } })();
    assert.deepEqual(result, empty('unavailable'));
    assert.equal(calls, 1);
  }
});

test('wrong content type, non-200 success, broken JSON and invalid UTF-8 cannot become an account', async () => {
  const responses = [
    new Response(JSON.stringify(account())),
    new Response(JSON.stringify(account()), { headers: { 'content-type': 'text/html' } }),
    new Response(JSON.stringify(account()), { headers: { 'content-type': 'application/json-not-json' } }),
    new Response(null, { status: 204 }),
    new Response('{broken-json-secret', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }),
  ];
  for (const response of responses) {
    assert.deepEqual(await createProviderProbe('synthetic-key', { now, fetch: async () => response })(), empty('invalid_response'));
  }
});

test('body limit is enforced on actual streamed bytes and declared length; exact limit remains valid', async () => {
  const base = { ...account(), padding: '' };
  const prefixBytes = new TextEncoder().encode(JSON.stringify(base)).length;
  const exact = JSON.stringify({ ...base, padding: 'x'.repeat(16 * 1024 - prefixBytes) });
  assert.equal(new TextEncoder().encode(exact).length, 16 * 1024);
  assert.equal((await createProviderProbe('synthetic-key', { now,
    fetch: async () => new Response(exact, { headers: { 'content-type': 'application/json; charset=utf-8' } }) })()).state, 'ok');
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(exact));
      controller.enqueue(new Uint8Array([32]));
    },
    cancel() { canceled = true; },
  });
  const streamed = await createProviderProbe('synthetic-key', { now,
    fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) })();
  assert.deepEqual(streamed, empty('invalid_response'));
  assert.equal(canceled, true);
  assert.deepEqual(await createProviderProbe('synthetic-key', { now, fetch: async () => new Response('{}', {
    headers: { 'content-type': 'application/json', 'content-length': String(16 * 1024 + 1) },
  }) })(), empty('invalid_response'));
});

test('network failures are generic and do not propagate credential or error text', async () => {
  const result = await createProviderProbe('private-key-sentinel', { now, fetch: async () => {
    throw new Error('private-key-sentinel private-provider-error');
  } })();
  assert.deepEqual(result, empty('unavailable'));
  assert.doesNotMatch(JSON.stringify(result), /sentinel|private/);
});

test('timeout bounds a non-responsive fetch double and aborts its request without retries', async () => {
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  const result = await createProviderProbe('synthetic-key', { now, timeoutMs: 15, fetch: async (_url, init) => {
    calls++;
    signal = init?.signal;
    return new Promise<Response>(() => undefined);
  } })();
  assert.deepEqual(result, empty('unavailable'));
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
});

test('timeout includes a stalled body stream and cancels it', async () => {
  let canceled = false;
  const result = await createProviderProbe('synthetic-key', { now, timeoutMs: 15, fetch: async () => new Response(
    new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }), { headers: { 'content-type': 'application/json' } },
  ) })();
  assert.deepEqual(result, empty('unavailable'));
  assert.equal(canceled, true);
});

test('concurrent callers share one request, the TTL starts at completion, and returned objects cannot corrupt the cache', async () => {
  let calls = 0;
  let mono = 0;
  let wall = checkedAt;
  let resolveResponse!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { resolveResponse = resolve; });
  const probe = createProviderProbe('synthetic-key', { now: () => new Date(wall), monotonicNow: () => mono, ttlMs: 100,
    fetch: async () => { calls++; return calls === 1 ? delayed : json(account()); } });
  const first = probe();
  const second = probe();
  assert.equal(calls, 1);
  mono = 80;
  wall = '2026-11-11T10:00:01.000Z';
  resolveResponse(json(account()));
  const a = await first;
  const b = await second;
  assert.equal(a.checkedAt, wall);
  assert.deepEqual(a, b);
  a.sources.push('caller-mutation');
  a.plan = 'caller-mutation';
  assert.equal(b.sources.length, 2);
  mono = 179;
  wall = '2026-11-10T10:00:00.000Z';
  const cached = await probe();
  assert.equal(calls, 1);
  assert.equal(cached.plan, 'starter');
  assert.equal(cached.sources.length, 2);
  assert.equal(cached.checkedAt, '2026-11-11T10:00:01.000Z');
  mono = 180;
  assert.equal((await probe()).checkedAt, wall);
  assert.equal(calls, 2);
});

test('failed refresh clears previous account data, is cached, and later expiry permits recovery', async () => {
  let calls = 0;
  let mono = 0;
  const probe = createProviderProbe('synthetic-key', { now, monotonicNow: () => mono, ttlMs: 10, fetch: async () => {
    calls++;
    return calls === 2 ? new Response('private-error', { status: 403 }) : json(account());
  } });
  assert.equal((await probe()).state, 'ok');
  mono = 10;
  assert.deepEqual(await probe(), empty('forbidden'));
  mono = 19;
  assert.deepEqual(await probe(), empty('forbidden'));
  assert.equal(calls, 2);
  mono = 20;
  assert.equal((await probe()).state, 'ok');
  assert.equal(calls, 3);
});

test('separate configured keys never share cached account data', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    return json({ ...account(), plan: new Headers(init?.headers).get('x-api-key') === 'first-key' ? 'trial' : 'business' });
  };
  const first = createProviderProbe('first-key', { now, fetch: fetcher });
  const second = createProviderProbe('second-key', { now, fetch: fetcher });
  assert.equal((await first()).plan, 'trial');
  assert.equal((await second()).plan, 'business');
  assert.equal((await first()).plan, 'trial');
  assert.equal(calls, 2);
});
