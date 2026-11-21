import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import {
  analyticsEventBatchLimit, analyticsEventBodyLimit, AnalyticsEventsResponseSchema, AnalyticsOverviewResponseSchema,
  type AnalyticsDays, type AnalyticsEvent, type AnalyticsOverview,
} from '@hd/contracts/analytics';
import { ApiErrorSchema, type PublicVehicleQuery } from '@hd/contracts/public';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';

const eventsPath = '/api/v1/analytics/events';
const overviewPath = '/api/v1/admin/analytics/overview';
const localHost = '127.0.0.1:3363';
const localOrigin = `http://${localHost}`;
const publicHost = 'cars.example.test';
const publicOrigin = `https://${publicHost}`;
const proxy = '192.0.2.10';
const visitor = '198.51.100.40';
const adminCookie = 'hd-auto.session_token=analytics-test-admin';
const editorCookie = 'hd-auto.session_token=analytics-test-editor';
const hiddenVehicle = 'ext-11111111-1111-4111-8111-111111111111';
const pageView: AnalyticsEvent = { type:'page_view', eventId:randomUUID(), pageType:'home', locale:'en' };

function overviewData(days: AnalyticsDays): AnalyticsOverview {
  return { days, timeZone:'Asia/Shanghai', startDate:days===7?'2026-11-13':'2026-10-21', endDate:'2026-11-19',
    collectionStartedAt:null, hasData:false, trend:[], topVehicles:[],
    totals:{pageViews:0, detailViews:0, vehicleClicks:0, contactClicks:0} };
}

async function setup(t: TestContext) {
  const runtime = await buildApp(readConfig({ NODE_ENV:'test',
    DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
    AUTH_SECRET:'analytics-test-placeholder-not-a-live-secret',
    TRUST_PROXY:`${proxy}/32`, ANALYTICS_ORIGINS:`${localOrigin},${publicOrigin}`, CATALOG_READ_MODE:'combined',
  }));
  t.after(() => runtime.app.close());
  t.mock.method(runtime.db.pool, 'connect', () => { throw new Error('Analytics route tests use no database.'); });
  t.mock.method(runtime.db.pool, 'query', async (sql: unknown, params?: unknown[]) => {
    if (sql === 'SELECT id,name,role,banned FROM staff WHERE id=$1') {
      const role = params?.[0];
      assert.ok(role === 'admin' || role === 'editor');
      return { rows:[{id:role, name:'Analytics test staff', role, banned:false}], rowCount:1 };
    }
    assert.equal(typeof sql === 'string' ? sql.replace(/\s+/g, ' ') : sql,
      'SELECT s.epoch::text,s.revision::text AS revision FROM public_catalog_state s WHERE s.id=1');
    return { rows:[{epoch:'00000000-0000-4000-8000-000000000001', revision:'1'}], rowCount:1 };
  });
  const getSession = t.mock.method(runtime.auth.api, 'getSession', async (options: { headers?: HeadersInit }) => {
    const cookie = new Headers(options.headers).get('cookie');
    if (cookie === adminCookie) return {user:{id:'admin'}};
    if (cookie === editorCookie) return {user:{id:'editor'}};
    return null;
  });
  const ingest = t.mock.method(runtime.analytics, 'ingest', async (events: readonly AnalyticsEvent[], _allowExternal: boolean) =>
    ({received:events.length,accepted:events.length,duplicates:0,dropped:0}));
  const overview = t.mock.method(runtime.analytics, 'overview', async (days: AnalyticsDays) => overviewData(days));
  t.mock.method(runtime.inventory, 'listPublic', async (query: PublicVehicleQuery, requestId: string) => ({
    data:{items:[], page:query.page, pageSize:query.pageSize, hasMore:false},
    meta:{requestId, catalog:'curated', total:0, totalKind:'exact', accessibleTotal:0,
      dataAsOf:'2026-11-19T00:00:00.000Z', freshness:'fresh'},
  }));
  const post = (payload: string | object = {events:[pageView]}, headers: Record<string,string> = {},
    remoteAddress = visitor) => runtime.app.inject({ method:'POST', url:eventsPath, remoteAddress, payload,
    headers:{host:localHost, origin:localOrigin, 'content-type':'application/json', ...headers},
  });
  const get = (query = '', cookie?: string) => runtime.app.inject({ method:'GET', url:overviewPath+query,
    remoteAddress:visitor, headers:cookie ? {cookie} : undefined,
  });
  return {app:runtime.app, post, get, getSession, ingest, overview};
}

type HttpResponse = {statusCode: number; headers: Record<string,unknown>; json: () => unknown};

function assertAccepted(response: HttpResponse) {
  assert.equal(response.statusCode, 202);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(AnalyticsEventsResponseSchema.parse(response.json()), {
    data:{accepted:true}, meta:{requestId:response.headers['x-request-id']},
  });
}

function assertProblem(response: HttpResponse, status: number, code: string) {
  assert.equal(response.statusCode, status);
  assert.equal(response.headers['cache-control'], 'no-store');
  const body = ApiErrorSchema.parse(response.json());
  assert.equal(body.error.code, code);
  assert.equal(body.meta.requestId, response.headers['x-request-id']);
  return body.error;
}

test('analytics accepts anonymous JSON and gives the same acknowledgement for a vehicle handled by storage', async t => {
  const {post, ingest, getSession} = await setup(t);
  const hiddenClick: AnalyticsEvent = { ...pageView, eventId:randomUUID(), type:'vehicle_click', vehicleId:hiddenVehicle };
  assertAccepted(await post({events:[pageView]}, {'content-type':'application/json; charset=utf-8'}));
  const hidden = await post({events:[hiddenClick]}, {
    cookie:adminCookie, authorization:'Bearer analytics-test-ignored', 'sec-fetch-site':'same-origin',
  });
  assertAccepted(hidden);
  assert.deepEqual(ingest.mock.calls.map(call => call.arguments), [[[pageView], true, undefined], [[hiddenClick], true, undefined]]);
  assert.equal(getSession.mock.callCount(), 0);
  assert.equal(hidden.headers['set-cookie'], undefined);
});

test('analytics requires a configured origin matching the request host and protocol', async t => {
  const {app, post, ingest} = await setup(t);
  assertProblem(await app.inject({method:'POST', url:eventsPath, remoteAddress:visitor,
    headers:{host:localHost}, payload:{events:[pageView]},
  }), 403, 'FORBIDDEN');
  const disallowed: Record<string,string>[] = [
    {origin:'http://foreign.example.test', host:'foreign.example.test'},
    {origin:'null'},
    {host:'wrong.example.test'},
    {host:publicHost, origin:publicOrigin},
    {'sec-fetch-site':'same-site'},
    {'sec-fetch-site':'cross-site'},
  ];
  for (const headers of disallowed) assertProblem(await post(undefined, headers), 403, 'FORBIDDEN');
  assert.equal(ingest.mock.callCount(), 0);

  assertAccepted(await post(undefined, {'sec-fetch-site':'same-origin'}));
  assertAccepted(await post(undefined, {host:publicHost, origin:publicOrigin, 'x-forwarded-host':publicHost,
    'x-forwarded-proto':'https', 'x-forwarded-for':visitor, 'sec-fetch-site':'same-origin'}, proxy));
  assert.equal(ingest.mock.callCount(), 2);
});

test('analytics rejects sensitive fields, invalid vehicle events, non-JSON and oversized batches', async t => {
  const {post, ingest} = await setup(t);
  const privateValue = 'private-analytics-test@example.test';
  const batch = Array.from({length:analyticsEventBatchLimit}, () => ({...pageView, eventId:randomUUID()}));
  for (const payload of [
    {events:[pageView], visitorId:privateValue},
    {events:[{...pageView, contact:privateValue, url:`https://example.test/?q=${privateValue}`}]},
    {events:[{...pageView, type:'vehicle_click', vehicleId:privateValue}]},
    {events:[{...pageView, pageType:'vehicle'}]},
    {events:[]},
    {events:[...batch, {...pageView, eventId:randomUUID()}]},
    '{"events":',
  ]) {
    const response = await post(payload);
    assertProblem(response, 400, 'INVALID_REQUEST');
    assert.ok(!response.body.includes(privateValue));
  }
  assertProblem(await post('events=test', {'content-type':'application/x-www-form-urlencoded'}), 415, 'INVALID_REQUEST');
  const json = JSON.stringify({events:batch});
  assertProblem(await post(json.padEnd(analyticsEventBodyLimit+1)), 413, 'PAYLOAD_TOO_LARGE');
  assert.equal(ingest.mock.callCount(), 0);
  assertAccepted(await post(json.padEnd(analyticsEventBodyLimit)));
  assert.deepEqual(ingest.mock.calls[0]?.arguments[0], batch);
});

test('analytics has a dedicated per-address quota and a bounded total ingest quota', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.parse('2026-11-19T00:00:00Z')});
  const {app, post, ingest} = await setup(t);
  for (let count = 0; count < 60; count++) assertAccepted(await post());
  const addressLimit = await post();
  assert.equal(assertProblem(addressLimit, 429, 'RATE_LIMITED').retryable, true);
  assert.equal(addressLimit.headers['x-ratelimit-limit'], '60');
  assert.equal(addressLimit.headers['retry-after'], '60');

  const catalog = await app.inject({method:'GET', url:'/api/v1/vehicles', remoteAddress:visitor});
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.headers['x-ratelimit-remaining'], '119');

  for (let count = 0; count < 60; count++) assertAccepted(await post(undefined, {}, '198.51.100.41'));
  const totalLimit = await post(undefined, {}, '198.51.100.42');
  assert.equal(assertProblem(totalLimit, 429, 'RATE_LIMITED').retryable, true);
  assert.equal(totalLimit.headers['x-ratelimit-remaining'], '59');
  const wait = Number(totalLimit.headers['retry-after']);
  assert.ok(wait >= 1 && wait <= 60);
  assert.equal(ingest.mock.callCount(), 120);
});

test('a busy ingestion lane rejects concurrent writes and recovers after a sanitized failure', async t => {
  const {post, ingest, get} = await setup(t);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const diagnostic = 'Synthetic private storage failure';
  ingest.mock.mockImplementationOnce(async () => {
    enter();
    await released;
    throw new Error(diagnostic);
  });
  const active = post();
  try {
    await entered;
    const busy = await post();
    assert.equal(assertProblem(busy, 503, 'SERVICE_UNAVAILABLE').retryable, true);
    assert.equal(busy.headers['retry-after'], '5');
    assert.equal(ingest.mock.callCount(), 1);
    assert.equal((await get('?days=7', adminCookie)).statusCode, 200);
  } finally {
    release();
    const failure = await active;
    assertProblem(failure, 503, 'SERVICE_UNAVAILABLE');
    assert.ok(!failure.body.includes(diagnostic));
  }
  assertAccepted(await post());
  assert.equal(ingest.mock.callCount(), 2);
});

test('analytics overview requires an administrator and supports 7 or 30 Beijing days', async t => {
  const {get, overview} = await setup(t);
  assertProblem(await get('?days=7'), 401, 'UNAUTHENTICATED');
  assertProblem(await get('?days=7', editorCookie), 403, 'FORBIDDEN');
  assertProblem(await get('?days=14', adminCookie), 400, 'INVALID_REQUEST');
  assertProblem(await get('?days=7&days=30', adminCookie), 400, 'INVALID_REQUEST');
  assert.equal(overview.mock.callCount(), 0);

  for (const [query, days] of [['?days=7', 7], ['?days=30', 30], ['', 30]] as const) {
    const response = await get(query, adminCookie);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(AnalyticsOverviewResponseSchema.parse(response.json()), {
      data:overviewData(days), meta:{requestId:response.headers['x-request-id']},
    });
  }
  assert.deepEqual(overview.mock.calls.map(call => call.arguments), [[7], [30], [30]]);
});
