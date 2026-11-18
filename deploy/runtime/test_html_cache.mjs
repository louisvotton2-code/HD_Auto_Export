import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
        else resolve({ status: response.statusCode, headers: response.headers,
          trailers: response.trailers, body: Buffer.concat(chunks).toString() });
      });
      response.once('error', reject);
    });
    req.once('error', reject);
    req.end();
  });
}

async function fixture(t, edgeIp = '127.0.0.1') {
  const calls = [];
  const state = {
    now: start, tick: 0, catalog: 'a', filters: 'b', ttl: 300_000, renderTtl: 300_000,
    versionStatus: 200, confirm: '2', renderConfirm: '2', renderStatus: 200, healthy: true,
    renderHeaders: {}, actualFilters: null, fxUntil: null, fxVersion: '11111111-1111-4111-8111-111111111111',
    omitProof: false, proofSource: 'header', nonceMismatch: false, scopeOmitted: false,
    duplicateScope: false, rewindWhenRendering: 0,
    oversized: false, truncate: false,
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
      assert.equal(req.headers[control.toLowerCase()], '2');
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
      assert.equal(req.headers.accept, 'text/html');
      assert.equal(req.headers['accept-encoding'], 'identity');
    }
    if (isPrivate && state.renderConfirm) headers[control] = state.renderConfirm;
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
    res.end(body);
  });
  const remote = await listen(origin);
  const cache = createHtmlCacheServer({ origin: remote, siteHost: site, edgeIp, release, secret,
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
  assert.notEqual((await get()).body, (await get()).body);
  state.actualFilters = null;
  const healthy = await get();
  assert.equal((await get()).body, healthy.body);
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
      const first = await get();
      advance(4999);
      assert.equal((await get()).body, first.body);
      advance(1);
      if (deadline === 'fxUntil') state.fxUntil = start + 20_000;
      assert.notEqual((await get()).body, first.body);
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
      const dynamicRerender = ['noNegotiation', 'private', 'cookie', 'vary', 'rsc', 'oversized',
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
