import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHtmlCacheServer, readHtmlCacheKey } from './production/html-cache.mjs';

const start = Date.parse('2026-11-18T00:00:00Z');
const release = 'b'.repeat(40);
const site = 'cars.hongdingauto.com';
const secret = 'synthetic-html-cache-secret-only-used-in-tests';
const control = 'X-HD-Cache-Protocol';
const nonce = 'x-hd-html-nonce';
const proof = 'X-HD-HTML-Proof';
const versionUrl = '/internal/public-html/version/?locale=zh';
const renderUrl = '/internal/public-html/render/';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return new URL('http://127.0.0.1:' + server.address().port);
}
function close(server) {
  server.closeAllConnections();
  return new Promise(resolve => server.close(resolve));
}
function read(origin, headers, path, method) {
  return new Promise((resolve, reject) => {
    const req = request(origin, { headers, path, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => {
        if (!response.complete) reject(new Error('incomplete HTTP response'));
        else {
          const bytes = Buffer.concat(chunks);
          resolve({ status: response.statusCode, headers: response.headers,
            trailers: response.trailers, body: bytes.toString(), bytes });
        }
      });
      response.once('error', reject);
    });
    req.once('error', reject);
    req.end();
  });
}

async function fixture(t, edgeIp = '127.0.0.1', cacheProtocol = '2') {
  const calls = [];
  const ttlForProtocol = cacheProtocol === '3' ? 600_000 : 300_000;
  const state = {
    now: start, tick: 0, catalog: 'a', filters: 'b', ttl: ttlForProtocol, renderTtl: ttlForProtocol,
    versionStatus: 200, confirm: cacheProtocol, renderConfirm: cacheProtocol, renderStatus: 200, healthy: true,
    renderHeaders: {}, actualFilters: null, fxUntil: null, fxVersion: '11111111-1111-4111-8111-111111111111',
    omitProof: false, proofSource: 'header', nonceMismatch: false, scopeOmitted: false,
    duplicateScope: false, rewindWhenRendering: 0,
    oversized: false, truncate: false, dynamicGzip: false, pauseRender: null,
  };
  const counts = { version: 0, render: 0 };
  const origin = createServer((req, res) => {
    calls.push({ path: req.url, headers: req.headers });
    const isVersion = req.url.startsWith('/internal/public-html/version/?');
    const isPrivate = req.url === renderUrl;
    if (isPrivate && state.rewindWhenRendering) {
      state.now -= state.rewindWhenRendering;
      state.rewindWhenRendering = 0;
    }
    const ttl = isVersion ? state.ttl : state.renderTtl;
    const fx = state.fxUntil === null ? null : { version: state.fxVersion, expiresAt: new Date(state.fxUntil).toISOString() };
    const stamp = (version) => ({
      version: version.repeat(64), priceView: 'usd', fx, checkedAt: new Date(state.now).toISOString(),
      validUntil: new Date(Math.min(state.now + ttl, state.fxUntil ?? Infinity)).toISOString(),
    });
    const data = { catalog: stamp(state.catalog), filters: stamp(isVersion ? state.filters : state.actualFilters ?? state.filters) };
    if (state.scopeOmitted) delete data.filters;
    if (state.duplicateScope) data.filters = data.catalog;
    const value = { release, nonce: req.headers[nonce], data };
    if (isVersion) {
      counts.version++;
      assert.equal(req.headers['x-hd-html-key'], secret);
      assert.equal(req.headers[control.toLowerCase()], cacheProtocol);
      assert.equal(req.headers['x-hd-visitor-ip'], '192.0.2.21');
      res.writeHead(state.versionStatus, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', [control]: state.confirm,
      }).end(JSON.stringify(value));
      return;
    }
    const renderId = ++counts.render;
    const body = state.oversized ? 'x'.repeat(513 * 1024) : '<html><body>render ' + renderId + '</body></html>';
    const headers = {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      Vary: 'RSC, Next-Router-Prefetch, Accept-Encoding', 'X-Request-Id': 'private-' + renderId,
      ...state.renderHeaders,
    };
    if (isPrivate) {
      assert.equal(req.headers['x-hd-render-target'], '/zh/');
      assert.equal(req.headers['x-hd-html-key'], secret);
      assert.equal(req.headers[control.toLowerCase()], cacheProtocol);
      assert.equal(req.headers.accept, 'text/html');
      assert.equal(req.headers['accept-encoding'], 'identity');
    }
    if (isPrivate && state.renderConfirm) headers[control] = state.renderConfirm;
    if (!isPrivate && state.dynamicGzip) headers['Content-Encoding'] = 'gzip';
    if (!state.omitProof && isPrivate) {
      const encoded = Buffer.from(JSON.stringify({ ...value,
        nonce: state.nonceMismatch ? 'a'.repeat(32) : value.nonce, healthy: state.healthy,
      })).toString('base64url');
      if (state.proofSource === 'header') headers[proof] = encoded;
      else {
        headers.Trailer = proof;
        res.addTrailers({ [proof]: encoded });
      }
    }
    res.writeHead(state.renderStatus, headers);
    if (state.truncate && isPrivate) {
      res.write(body.slice(0, 5), () => res.destroy());
      return;
    }
    if (isPrivate && state.pauseRender) {
      const pauseRender = state.pauseRender;
      state.pauseRender = null;
      pauseRender(() => res.end(body));
      return;
    }
    res.end(!isPrivate && state.dynamicGzip ? gzipSync(body) : body);
  });
  const remote = await listen(origin);
  const cache = createHtmlCacheServer({ origin: remote, siteHost: site, edgeIp, release, secret, cacheProtocol,
    now: () => state.now, tick: () => state.tick });
  const endpoint = await listen(cache);
  t.after(async () => {
    await close(cache);
    await close(origin);
  });
  return { state, calls, counts,
    get: (headers, path = '/zh/', method = 'GET') => read(endpoint,
      { Host: site, Accept: 'text/html', 'X-HD-Visitor-IP': '192.0.2.21', ...headers }, path, method),
    advance(ms) { state.now += ms; state.tick += ms; },
  };
}

test('hits require a fresh v2 live version; proof, nonce and request identity stay private', async t => {
  const { get, calls, counts } = await fixture(t);
  const first = await get({ [control]: 'forged', 'X-HD-HTML-Key': 'attacker',
    [proof]: 'malicious', 'X-HD-HTML-Nonce': 'not-the-render', 'X-HD-Cache-Unlisted': 'ignore',
    'X-HD-Public-HTML-Render-Ticket': 'ignore', 'X-HD-Render-Target': '/ru/', 'User-Agent': 'not shared' });
  const second = await get({ Host: site + ':443' });
  assert.equal(first.status, 200);
  assert.equal(first.body, second.body);
  assert.equal(first.headers['x-hd-cache-document'], undefined);
  assert.equal(second.headers['x-hd-cache-document'], 'hit');
  assert.deepEqual(counts, { version: 2, render: 1 });
  assert.deepEqual(calls.map(call => call.path), [versionUrl, renderUrl, versionUrl]);
  assert.equal(calls[1].headers['x-hd-cache-unlisted'], undefined);
  assert.equal(calls[1].headers['x-hd-html-proof'], undefined);
  assert.equal(calls[1].headers['x-hd-public-html-render-ticket'], undefined);
  assert.equal(calls[1].headers['user-agent'], undefined);
  assert.match(calls[1].headers[nonce], /^[0-9a-f]{32}$/);
  assert.notEqual(calls[0].headers[nonce], calls[1].headers[nonce]);
  assert.equal(second.headers['x-request-id'], undefined);
  for (const response of [first, second]) {
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-hd-cache-protocol'], undefined);
    assert.equal(response.headers['x-hd-html-proof'], undefined);
    assert.deepEqual(response.trailers, {});
  }
});

test('normal reload validates the current revision and negotiates cached gzip and identity', async t => {
  const { get, state, calls, counts } = await fixture(t);
  state.renderHeaders.Vary = 'RSC, Next-Router-Prefetch';
  const identity = await get();
  const gzip = await get({ 'Cache-Control': 'max-age=0', 'Accept-Encoding': 'br, gzip' });
  assert.deepEqual(calls.map(call => call.path), [versionUrl, renderUrl, versionUrl]);
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(gzip.headers['content-length'], String(gzip.bytes.length));
  assert.equal(identity.headers['content-length'], String(identity.bytes.length));
  assert.deepEqual(gunzipSync(gzip.bytes), identity.bytes);
  for (const response of [identity, gzip]) {
    assert.equal(response.headers.vary, 'RSC, Next-Router-Prefetch, Accept-Encoding');
    assert.equal(response.headers.etag, undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const value of ['', 'identity', 'gzip;q=0, *;q=1', 'gzip;q=0.4, identity;q=0.9', 'gzip, GZIP;q=0']) {
    const result = await get({ 'Cache-Control': 'max-age=0', 'Accept-Encoding': value });
    assert.equal(result.headers['content-encoding'], undefined);
    assert.deepEqual(result.bytes, identity.bytes);
  }
  assert.deepEqual(counts, { version: 7, render: 1 });
  state.catalog = 'c';
  state.renderHeaders.Vary = 'RSC, aCcEpT-EnCoDiNg';
  const changed = await get({ 'Cache-Control': 'max-age=0', 'Accept-Encoding': '*;q=1' });
  assert.equal(changed.headers.vary, 'RSC, aCcEpT-EnCoDiNg');
  assert.equal(changed.headers['content-encoding'], 'gzip');
  assert.notDeepEqual(gunzipSync(changed.bytes), identity.bytes);
  state.versionStatus = 503;
  const degraded = await get({ 'Cache-Control': 'max-age=0', 'Accept-Encoding': 'gzip' });
  assert.equal(degraded.headers['content-encoding'], undefined);
  assert.equal(calls.at(-1).path, '/zh/');
  assert.notDeepEqual(degraded.bytes, gunzipSync(changed.bytes));
});

test('hard reload, no-store, no-transform and conditional documents keep the origin response', async t => {
  const { get, state, calls, counts } = await fixture(t);
  await get({ 'Accept-Encoding': 'gzip' });
  state.dynamicGzip = true;
  for (const headers of [
    { 'Cache-Control': 'no-cache' }, { Pragma: 'no-cache' }, { 'Cache-Control': 'max-age=0, no-store' },
    { 'Cache-Control': 'no-transform' }, { 'Cache-Control': 'max-age=0', 'If-None-Match': '"old"' },
    { 'Accept-Encoding': 'gzip, identity;q=0' }, { 'Cache-Control': 'max-age=0', Cookie: 'private=token' },
    { 'Cache-Control': 'max-age=0', RSC: '1' },
  ]) {
    const response = await get({ 'Accept-Encoding': 'gzip', ...headers });
    const upstream = calls.at(-1);
    assert.equal(upstream.path, '/zh/');
    assert.equal(upstream.headers[nonce], undefined);
    assert.equal(response.headers['content-encoding'], 'gzip');
    assert.deepEqual(response.bytes, gzipSync('<html><body>render ' + counts.render + '</body></html>'));
  }
  assert.deepEqual(counts, { version: 1, render: 9 });
});

test('all live dependency changes invalidate immediately and mixed renders never write', async t => {
  const { get, state, counts } = await fixture(t);
  const first = await get();
  state.filters = 'c';
  const filterChange = await get();
  assert.notEqual(first.body, filterChange.body);
  state.catalog = 'd';
  const catalogChange = await get();
  assert.notEqual(catalogChange.body, filterChange.body);
  state.fxUntil = start + 90_000;
  const fxAdded = await get();
  assert.notEqual(fxAdded.body, catalogChange.body);
  assert.equal((await get()).body, fxAdded.body);
  const beforeFx = counts.render;
  state.fxVersion = '22222222-2222-4222-8222-222222222222';
  await get();
  assert.equal(counts.render, beforeFx + 1);
  state.filters = 'f';
  state.actualFilters = 'e';
  const mixed = await get({ 'Accept-Encoding': 'gzip' });
  assert.equal(mixed.headers['content-encoding'], undefined);
  assert.notEqual((await get()).body, mixed.body);
  state.actualFilters = null;
  const healthy = await get();
  assert.equal((await get()).body, healthy.body);
});

test('an older in-flight gzip render cannot overwrite a later cached revision', async t => {
  const { get, state, counts } = await fixture(t);
  const encoding = { 'Accept-Encoding': 'gzip' };
  const paused = new Promise(resolve => { state.pauseRender = resolve; });
  const earlierRequest = get(encoding);
  const finishRender = await paused;
  state.catalog = 'c';
  const recent = await get(encoding);
  assert.equal(recent.headers['content-encoding'], 'gzip');
  finishRender();
  const earlier = await earlierRequest;
  assert.equal(earlier.headers['content-encoding'], undefined);
  assert.deepEqual((await get(encoding)).bytes, recent.bytes);
  assert.deepEqual(counts, { version: 3, render: 3 });
});

test('300 second maximum never extends from a hit and expiry stays closed on clock rollback', async t => {
  const { advance, get, state } = await fixture(t);
  const first = await get();
  advance(250_000);
  assert.equal((await get()).body, first.body);
  state.tick += 50_000;
  state.now -= 240_000; // Actual elapsed deadline is still 300s.
  assert.notEqual((await get()).body, first.body);
});

test('protocol 3 retains authenticated homepage HTML up to 600 seconds with a live read on every hit', async t => {
  const { advance, counts, get } = await fixture(t, '127.0.0.1', '3');
  const first = await get();
  advance(300_001);
  const warm = await get();
  assert.equal(warm.body, first.body);
  assert.equal(warm.headers['x-hd-cache-document'], 'hit');
  assert.equal(warm.headers['cache-control'], 'no-store');
  assert.equal(warm.headers[control.toLowerCase()], undefined);
  advance(299_998);
  assert.equal((await get()).body, first.body);
  advance(1);
  assert.notEqual((await get()).body, first.body);
  assert.deepEqual(counts, { version: 4, render: 2 });
});

test('protocol 3 invalidates a live revision and also honors a shorter render or FX deadline', async t => {
  for (const reason of ['revision', 'render', 'fx']) {
    await t.test(reason, async context => {
      const { advance, get, state } = await fixture(context, '127.0.0.1', '3');
      if (reason === 'render') state.renderTtl = 350_000;
      if (reason === 'fx') state.fxUntil = start + 350_000;
      const first = await get();
      advance(349_999);
      assert.equal((await get()).body, first.body);
      if (reason === 'revision') state.filters = 'c';
      else advance(1);
      assert.notEqual((await get()).body, first.body);
    });
  }
});

test('protocol 3 treats older version or render confirmation as a dynamic request', async t => {
  const { get, state, calls } = await fixture(t, '127.0.0.1', '3');
  state.confirm = '2';
  let response = await get();
  assert.deepEqual(calls.map(call => call.path), [versionUrl, '/zh/']);
  assert.equal(response.headers['x-hd-cache-document'], undefined);
  calls.length = 0;
  state.confirm = '3';
  state.renderConfirm = '2';
  response = await get();
  assert.deepEqual(calls.map(call => call.path), [versionUrl, renderUrl, '/zh/']);
  assert.equal(response.headers['x-hd-cache-document'], undefined);
  calls.length = 0;
  response = await get({ Cookie: 'session=private' });
  assert.deepEqual(calls.map(call => call.path), ['/zh/']);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('a clock rollback during render cannot extend the previously checked live deadline', async t => {
  const { get, state, advance } = await fixture(t);
  state.ttl = 5000;
  state.rewindWhenRendering = 60_000;
  const first = await get();
  advance(4999);
  assert.equal((await get()).body, first.body);
  advance(1);
  assert.notEqual((await get()).body, first.body);
});

test('earliest live, rendered and FX deadlines bound a hit', async t => {
  for (const deadline of ['ttl', 'renderTtl', 'fxUntil']) {
    await t.test(deadline, async testContext => {
      const { get, state, advance } = await fixture(testContext);
      state[deadline] = deadline === 'fxUntil' ? start + 5000 : 5000;
      const encoding = { 'Accept-Encoding': 'gzip' };
      const first = await get(encoding);
      assert.equal(first.headers['content-encoding'], 'gzip');
      advance(4999);
      assert.deepEqual((await get(encoding)).bytes, first.bytes);
      advance(1);
      if (deadline === 'fxUntil') state.fxUntil = start + 20_000;
      assert.notDeepEqual((await get(encoding)).bytes, first.bytes);
    });
  }
});

test('legacy, failed, incomplete and malformed version checks bypass a cached render', async t => {
  const { get, state, calls, counts } = await fixture(t);
  const first = await get();
  const options = [{ confirm: '' }, { confirm: '1' }, { versionStatus: 503 },
    { ttl: 301_000 }, { scopeOmitted: true }, { duplicateScope: true }];
  for (const optionsForRequest of options) {
    Object.assign(state, { confirm: '2', versionStatus: 200, ttl: 300_000, scopeOmitted: false, duplicateScope: false }, optionsForRequest);
    const response = await get();
    assert.equal(response.status, 200);
    assert.notEqual(response.body, first.body);
    assert.equal(calls.at(-1).headers[nonce], undefined);
  }
  assert.deepEqual(counts, { version: 7, render: 7 });
});

test('429 on a warm version check or a private render is propagated once', async t => {
  const { get, state, calls } = await fixture(t);
  await get();
  state.versionStatus = 429;
  calls.length = 0;
  const limitedHit = await get();
  assert.equal(limitedHit.status, 429);
  assert.equal(limitedHit.headers['retry-after'], '1');
  assert.deepEqual(calls.map(call => call.path), [versionUrl]);
  state.versionStatus = 200;
  state.catalog = 'd';
  state.renderStatus = 429;
  state.renderHeaders = { 'Retry-After': '7' };
  calls.length = 0;
  const limitedRender = await get();
  assert.equal(limitedRender.status, 429);
  assert.equal(limitedRender.headers['retry-after'], '7');
  assert.deepEqual(calls.map(call => call.path), [versionUrl, renderUrl]);
});

test('Cookie, auth, RSC, prefetch and noncanonical routes never perform a live lookup', async t => {
  const { get, calls, counts } = await fixture(t);
  const ordinary = await get();
  for (const headers of [
    { Cookie: 'session=private' }, { Authorization: 'Bearer private' }, { RSC: '1' },
    { 'Next-Router-Prefetch': '1' }, { 'Next-Router-Segment-Prefetch': '/tree' }, { 'Next-Url': '/en/' },
    { Purpose: 'prefetch' }, { 'Sec-Purpose': 'prefetch;prerender' }, { Range: 'bytes=0-100' },
    { Accept: 'application/json' }, { Accept: 'text/html;q=0' }, { 'Cache-Control': 'no-cache' },
  ]) {
    const response = await get(headers);
    assert.notEqual(response.body, ordinary.body);
    assert.equal(calls.at(-1).headers[nonce], undefined);
  }
  assert.equal((await get({}, '/zh/?ref=other')).status, 200);
  for (const path of ['/zh', '/staff/vehicles/x/', '/zh/cars/x/', '/internal/public-html/version/?locale=zh']) {
    assert.equal((await get({}, path)).status, 502);
  }
  assert.equal(counts.version, 1);
  assert.equal(counts.render, 14);
  assert.equal((await get()).body, ordinary.body);
});

test('unhealthy, private, personalized, oversized and incomplete HTML is never admitted', async t => {
  for (const [name, changes] of Object.entries({
    noProof: { omitProof: true }, unhealthy: { healthy: false }, replay: { nonceMismatch: true },
    trailerOnly: { proofSource: 'trailer' }, noNegotiation: { renderConfirm: '' },
    private: { renderHeaders: { 'Cache-Control': 'private, no-store' } },
    noTransform: { renderHeaders: { 'Cache-Control': 'no-store, no-transform' } },
    cookie: { renderHeaders: { 'Set-Cookie': 'private=token' } },
    vary: { renderHeaders: { Vary: 'User-Agent' } },
    rsc: { renderHeaders: { 'Content-Type': 'text/x-component' } },
    oversized: { oversized: true }, truncated: { truncate: true },
    true404: { renderStatus: 404 }, rateLimited: { renderStatus: 429 }, unavailable: { renderStatus: 503 },
  })) {
    await t.test(name, async testContext => {
      const { get, state, counts } = await fixture(testContext);
      Object.assign(state, changes);
      for (let i = 0; i < 2; i++) {
        const result = await get();
        assert.equal(result.status, state.renderStatus);
        assert.equal(result.headers['cache-control'], 'no-store');
        if (state.oversized) assert.equal(result.body.length, 513 * 1024);
        if (state.truncate) assert.match(result.body, /<\/html>$/);
      }
      const dynamicRerender = ['noNegotiation', 'private', 'noTransform', 'cookie', 'vary', 'rsc', 'oversized',
        'truncated', 'true404', 'unavailable'].includes(name);
      assert.deepEqual(counts, { version: 2, render: dynamicRerender ? 4 : 2 });
    });
  }
});

test('non-edge peers cannot reach either the render origin or the private version endpoint', async t => {
  const { get, counts } = await fixture(t, '127.0.0.2');
  const reply = await get();
  assert.equal(reply.status, 404);
  assert.deepEqual(counts, { version: 0, render: 0 });
});

test('the shared key is read only from a regular owner-only file without following links', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hd-html-cache-key-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = join(dir, 'key');
  const shared = join(dir, 'shared');
  const link = join(dir, 'link');
  await writeFile(key, secret + '\n', { mode: 0o600 });
  await writeFile(shared, secret, { mode: 0o644 });
  await chmod(shared, 0o644);
  await symlink(key, link);
  assert.equal(readHtmlCacheKey(key), secret);
  for (const file of [shared, link, dir, 'relative']) assert.throws(() => readHtmlCacheKey(file), /owner-only/);
});
