import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHtmlCacheServer, readBrowseGeneration } from './production/html-cache.mjs';

const siteHost = 'hongdingauto.com';
const release = '1'.repeat(40);
const first = 'a'.repeat(32);
const second = 'b'.repeat(32);
const secret = 'isolated-browse-test-secret-only';
const authorityKey = 'isolated-private-ssr-catalogue-credential';
const docHeaders = { host: siteHost, accept: 'text/html', 'x-hd-visitor-ip': '192.0.2.20' };

async function listen(server, t) {
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function fixture(t) {
  const data = {
    generation: first, wall: 1_900_000_000_000, elapsed: 0, reads: [], content: 'visible car',
    changeProof: value => value, responseHeaders: {}, block: null, dynamicBlock: null, dynamicStatus: 200, throttle: false,
    authority: 'c'.repeat(64), authorityReads: 0, authorityStatus: 200,
  };
  const origin = await listen(createServer(async (req, res) => {
    const h = req.headers;
    const target = h['x-hd-render-target'];
    if (req.url === '/internal/public-catalog/browse-generation') {
      data.authorityReads++;
      assert.equal(h['x-hd-ssr-key'], authorityKey);
      assert.equal(h['x-forwarded-for'], '192.0.2.20');
      assert.ok(!h.cookie && !h.authorization);
      res.writeHead(data.authorityStatus, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '2',
      }).end(JSON.stringify({ data: { policy: 'browse-600-v1', generation: data.authority } }));
      return;
    }
    data.reads.push({ url: req.url, target, generation: h['x-hd-browse-generation'] });
    if (req.url !== '/internal/public-html/browse/') {
      if (data.dynamicBlock) await data.dynamicBlock();
      res.writeHead(data.dynamicStatus, { 'Content-Type': h.rsc ? 'text/x-component' : 'text/html' }).end(`live ${data.content}`);
      return;
    }
    assert.equal(h['x-hd-html-key'], secret);
    assert.equal(h['x-hd-cache-protocol'], '4');
    const content = data.content;
    const stamp = data.changeProof({
      release, nonce: h['x-hd-html-nonce'], target, generation: h['x-hd-browse-generation'],
      healthy: true, observedAt: data.wall, expiresAt: data.wall + 600_000,
    });
    if (data.block) await data.block();
    if (data.throttle) {
      res.writeHead(429, { 'Retry-After': '2' }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html', 'X-HD-Cache-Protocol': '4', 'Cache-Control': 'no-store',
      'X-HD-HTML-Proof': Buffer.from(JSON.stringify(stamp)).toString('base64url'),
      ...data.responseHeaders,
    }).end(content);
  }), t);
  const server = createHtmlCacheServer({
    origin: new URL(`http://127.0.0.1:${origin}`), siteHost, edgeIp: '127.0.0.1', release, secret,
    cacheProtocol: '4', readGeneration: () => data.generation, now: () => data.wall, tick: () => data.elapsed,
    browseAuthorityOrigin: new URL(`http://127.0.0.1:${origin}`), browseAuthorityKey: authorityKey,
  });
  const port = await listen(server, t);
  let requests = 0;
  const milestones = new Map();
  server.on('request', () => {
    requests++;
    milestones.get(requests)?.resolve();
  });
  function waitForRequests(total) {
    if (requests >= total) return Promise.resolve();
    const milestone = Promise.withResolvers();
    milestones.set(total, milestone);
    return milestone.promise;
  }
  const get = (path, extra = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers: { ...docHeaders, ...extra } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, h: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.once('error', reject).end();
  });
  return { data, get, waitForRequests };
}

test('warm HTML only reads the separate browse authority', async t => {
  const { data, get } = await fixture(t);
  await get('/zh/');
  assert.equal((await get('/zh/')).h['x-hd-cache-document'], 'hit');
  const firstRequest = await get('/ru/cars/?page=2&make=byd');
  assert.equal(firstRequest.h['cache-control'], 'no-store');
  assert.equal(firstRequest.h['x-hd-html-proof'], undefined);
  const before = data.authorityReads;
  const hits = await Promise.all(Array.from({ length: 20 }, () => get('/ru/cars/?make=byd&page=2')));
  assert.equal(hits.filter(result => result.h['x-hd-cache-document'] === 'hit').length, 20);
  assert.deepEqual(data.reads.map(r => r.target), ['/zh/', '/ru/cars/?make=byd&page=2']);
  assert.equal(data.authorityReads - before, 20);
  assert.equal((await get('/ru/cars/?page=3&make=byd')).h['x-hd-cache-document'], undefined);
  assert.equal((await get('/en/cars/?make=byd&page=2')).h['x-hd-cache-document'], undefined);
  await get('/ru/cars/');
  assert.equal((await get('/ru/cars/?page=1')).h['x-hd-cache-document'], undefined);
  assert.equal(data.reads.length, 6);
});

test('a database authority change invalidates hot HTML without a manual host hold', async t => {
  const { data, get } = await fixture(t);
  await get('/ru/');
  assert.equal((await get('/ru/')).h['x-hd-cache-document'], 'hit');
  data.content = 'withdrawn';
  data.authority = 'd'.repeat(64);
  const firstAfter = await get('/ru/');
  assert.equal(firstAfter.text, 'withdrawn');
  assert.equal(firstAfter.h['x-hd-cache-document'], undefined);
  assert.equal((await get('/ru/')).h['x-hd-cache-document'], 'hit');
  assert.equal(data.generation, first);
  data.authorityStatus = 503;
  assert.equal((await get('/ru/')).text, 'live withdrawn');
  data.authorityStatus = 429;
  const throttled = await get('/ru/');
  assert.equal(throttled.status, 429);
  assert.equal(throttled.h['retry-after'], '2');
});

test('RSC, private and ambiguous requests never consume document cache entries', async t => {
  const { data, get } = await fixture(t);
  const path = '/ru/cars/?make=byd';
  await get(path);
  for (const headers of [
    { rsc: '1' }, { accept: 'text/html, text/x-component' }, { cookie: 'session=private' }, { authorization: 'Bearer private' },
    { accept: '*/*', 'sec-fetch-dest': 'empty' }, { 'sec-fetch-dest': 'empty' },
    { 'next-router-prefetch': '1' }, { 'cache-control': 'no-cache' }, { 'if-none-match': '"tag"' },
  ]) {
    const result = await get(path, headers);
    assert.equal(result.h['x-hd-cache-document'], undefined);
    assert.equal(result.h['cache-control'], 'no-store');
    assert.equal(result.text, 'live visible car');
  }
  for (const path of ['/ru/?page=1', '/ru/cars/?make=byd&make=geely', '/ru/cars/?cursor=opaque',
    '/ru/cars/?madeUp=yes', '/ru/cars/?q=%ED%A0%80']) {
    assert.equal((await get(path, { 'x-hd-browse-generation': second })).text, 'live visible car');
  }
  assert.equal(data.reads.filter(r => r.target).length, 1);
  assert.ok(data.reads.filter(r => !r.target).every(r => r.generation === undefined));
  assert.equal((await get('/ru/cars/private-id/')).status, 502);
});

test('the authenticated render proof binds the document, generation, release and deadline', async t => {
  const { data, get } = await fixture(t);
  const path = '/en/cars/';
  for (const fields of [{ target: '/en/' }, { generation: second }, { release: second },
    { healthy: false }, { observedAt: data.wall - 600_000 }, { expiresAt: data.wall }]) {
    data.changeProof = value => ({ ...value, ...fields });
    assert.equal((await get(path)).text, 'live visible car');
  }
  data.changeProof = value => value;
  data.responseHeaders = { 'Set-Cookie': 'session=secret' };
  assert.equal((await get(path)).text, 'live visible car');
  data.responseHeaders = {};
  await get(path);
  data.wall += 597_000;
  data.elapsed += 597_000;
  assert.equal((await get(path)).h['x-hd-cache-document'], 'hit');
  data.wall += 3_000;
  data.elapsed += 3_000;
  assert.equal((await get(path)).h['x-hd-cache-document'], undefined);
});

test('an in-flight document containing a withdrawn vehicle cannot repopulate the cache', { timeout: 5000 }, async t => {
  const { data, get } = await fixture(t);
  await get('/en/');
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  data.block = () => { started.resolve(); return resume.promise; };
  const inFlight = get('/en/cars/');
  await started.promise;

  data.generation = null;
  data.content = 'withdrawn';
  assert.equal((await get('/en/')).text, 'live withdrawn');
  data.generation = second;
  data.block = null;
  assert.equal((await get('/en/cars/')).text, 'withdrawn');
  resume.resolve();
  assert.equal((await inFlight).text, 'live withdrawn');
  const after = await get('/en/cars/');
  assert.equal(after.text, 'withdrawn');
  assert.equal(after.h['x-hd-cache-document'], 'hit');
});

test('origin throttling preserves the real 429 without dynamic retry or shared HTML', { timeout: 5000 }, async t => {
  const { data, get, waitForRequests } = await fixture(t);
  data.throttle = true;
  const resume = Promise.withResolvers();
  data.block = () => resume.promise;
  const inflight = Array.from({ length: 5 }, () => get('/en/cars/'));
  await waitForRequests(5);
  resume.resolve();
  const results = await Promise.all(inflight);
  assert.ok(results.every(result => result.status === 429 && result.h['retry-after'] === '2'));
  assert.ok(data.reads.every(read => read.target === '/en/cars/'));
  data.throttle = false;
  assert.equal((await get('/en/cars/')).status, 200);
});

test('a failed shared proof cannot turn twenty duplicate requests into twenty dynamic renders', { timeout: 5000 }, async t => {
  const { data, get, waitForRequests } = await fixture(t);
  await get('/zh/');
  data.changeProof = value => ({ ...value, healthy: false });
  const releaseProof = Promise.withResolvers();
  const releaseDynamic = Promise.withResolvers();
  const dynamicStarted = Promise.withResolvers();
  let dynamicCalls = 0;
  data.block = () => releaseProof.promise;
  data.dynamicBlock = () => {
    if (++dynamicCalls === 8) dynamicStarted.resolve();
    return releaseDynamic.promise;
  };
  const pending = Array.from({ length: 20 }, () => get('/en/cars/'));
  await waitForRequests(21);
  releaseProof.resolve();
  await dynamicStarted.promise;
  const hit = await get('/zh/');
  assert.equal(hit.status, 200);
  assert.equal(hit.h['x-hd-cache-document'], 'hit');
  releaseDynamic.resolve();
  const responses = await Promise.all(pending);
  assert.deepEqual(responses.map(response => response.status).sort(),
    [...Array(8).fill(200), ...Array(12).fill(503)]);
  assert.ok(data.reads.filter(read => read.target === '/en/cars/').length < 20);
  assert.equal(data.reads.filter(read => !read.target).length, 8);
});

test('a burst of distinct cold documents is bounded without a second unbounded origin path', { timeout: 5000 }, async t => {
  const { data, get, waitForRequests } = await fixture(t);
  const resume = Promise.withResolvers();
  const privateStarted = Promise.withResolvers();
  data.block = () => {
    if (data.reads.length === 12) privateStarted.resolve();
    return resume.promise;
  };
  const pending = Array.from({ length: 24 }, (_, page) => get(`/en/cars/?page=${page + 1}`));
  await Promise.all([waitForRequests(24), privateStarted.promise]);
  assert.equal(data.reads.length, 12);
  resume.resolve();
  const responses = await Promise.all(pending);
  assert.deepEqual(responses.map(response => response.status).sort(),
    [...Array(20).fill(200), ...Array(4).fill(503)]);
  assert.equal(data.reads.length, 20);
  assert.ok(data.reads.every(read => read.target));
});

test('a failed bounded dynamic retry does not trigger Nginx dynamic routing again', async t => {
  const { data, get } = await fixture(t);
  data.changeProof = value => ({ ...value, healthy: false });
  for (const status of [502, 504]) {
    data.dynamicStatus = status;
    const reply = await get('/ru/cars/');
    assert.equal(reply.status, 503);
    assert.equal(reply.h['retry-after'], '1');
    assert.equal(reply.h['cache-control'], 'no-store');
  }
  assert.equal(data.reads.filter(r => r.target).length, 2);
  assert.equal(data.reads.filter(r => !r.target).length, 2);
});

test('the generation reader uses an atomically replaceable regular file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hd-browse-generation-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const file = join(root, 'generation');
  const pending = join(root, 'pending');
  assert.equal(readBrowseGeneration(file), null);
  await writeFile(file, first + '\n', { mode: 0o644 });
  assert.equal(readBrowseGeneration(file), first);
  await writeFile(pending, second + '\n', { mode: 0o644 });
  await rename(pending, file);
  assert.equal(readBrowseGeneration(file), second);
  await chmod(file, 0o666);
  assert.equal(readBrowseGeneration(file), null);
  await writeFile(file, 'disabled\n');
  assert.equal(readBrowseGeneration(file), null);
  await symlink(file, pending);
  assert.equal(readBrowseGeneration(pending), null);
});
