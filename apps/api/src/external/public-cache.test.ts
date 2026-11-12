import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../errors.js';
import { PublicCatalogCache, readPublicCatalogRevision, type PublicCatalogRevision } from './public-cache.js';
import type { PublicCacheStore } from './redis-cache.js';

const epoch = '00000000-0000-4000-8000-000000000001';
const version = (revision = '1'): PublicCatalogRevision => ({ epoch, revision });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
class Store implements PublicCacheStore {
  values = new Map<string, string>();
  ttls: number[] = [];
  fail = false;
  async get(key: string) { if (this.fail) throw new Error('private storage error'); return this.values.get(key) ?? null; }
  async set(key: string, value: string, ttl: number) { if (this.fail) throw new Error('private storage error'); this.values.set(key, value); this.ttls.push(ttl); }
  async close() {}
}

test('same-key misses merge, cache only public data and clone every caller result', async () => {
  const started = deferred<void>(), release = deferred<void>();
  const cache = new PublicCatalogCache({ namespace: 'hd:test' }, { readRevision: async () => version() });
  let loads = 0;
  const load = async () => { loads++; started.resolve(); await release.promise; return { data: { items: [{ id: 'vehicle' }] }, meta: { requestId: 'private-request', total: 1 } }; };
  const pending = Array.from({ length: 12 }, () => cache.get('list', { locale: 'zh', page: 1 }, load));
  await started.promise; release.resolve();
  const results = await Promise.all(pending);
  assert.equal(loads, 1);
  assert.equal(JSON.stringify(results).includes('private-request'), false);
  results[0]!.data.items[0]!.id = 'caller-mutated';
  assert.equal(results[1]!.data.items[0]!.id, 'vehicle');
  const hit = await cache.get('list', { page: 1, locale: 'zh' }, load);
  assert.equal(hit.data.items[0]!.id, 'vehicle');
  assert.equal(cache.metrics().localHits, 1);
});

test('every hit validates the live epoch/revision; database failure never serves old entries', async () => {
  let revision = version(), broken = false, loads = 0;
  const cache = new PublicCatalogCache({ namespace: 'hd:test' }, { readRevision: async () => { if (broken) throw new Error('private database URL'); return revision; } });
  const load = async () => ({ value: ++loads });
  assert.equal((await cache.get('home', {}, load)).value, 1);
  revision = version('2');
  assert.equal((await cache.get('home', {}, load)).value, 2);
  revision = { epoch: '00000000-0000-4000-8000-000000000002', revision: '2' };
  assert.equal((await cache.get('home', {}, load)).value, 3);
  broken = true;
  await assert.rejects(cache.get('home', {}, load), error => error instanceof ApiError && error.status === 503 && !error.message.includes('private'));
  assert.equal(loads, 3);
});

test('a publication changing during source reads retries once and never tags old data with the new version', async () => {
  let revision = version(), loads = 0;
  const cache = new PublicCatalogCache({ namespace: 'hd:test' }, { readRevision: async () => revision });
  const value = await cache.get('detail', { id: 'one' }, async () => {
    loads++; const observed = revision.revision; if (loads === 1) revision = version('2'); return { observed };
  });
  assert.deepEqual(value, { observed: '2' });
  assert.equal(loads, 2); assert.equal(cache.metrics().versionRetries, 1);
  const unstable = new PublicCatalogCache({ namespace: 'hd:test' }, { readRevision: async () => revision });
  await assert.rejects(unstable.get('detail', {}, async () => { revision = version(String(Number(revision.revision) + 1)); return {}; }), { status: 503 });
});

test('Redis TTL ends before image expiry and an expired URL is never reused', async () => {
  let now = Date.parse('2026-11-10T00:00:00Z'), loads = 0;
  const store = new Store();
  const cache = new PublicCatalogCache({ namespace: 'hd:test', ttlMs: 5000 }, { readRevision: async () => version(), store, now: () => now });
  const expires = new Date(now + 100).toISOString();
  const load = async () => { loads++; return { images: loads === 1 ? [{ remote: { expiresAt: expires } }] : [] }; };
  await cache.get('detail', {}, load);
  assert.deepEqual(store.ttls, [100]);
  now += 101;
  assert.deepEqual(await cache.get('detail', {}, load), { images: [] });
  assert.equal(loads, 2);
  await assert.rejects(cache.get('detail', { id: 'expired-origin' }, async () => ({ images: [{ remote: { expiresAt: expires } }] })), { status: 503 });
});

test('USD hits and in-flight loads validate FX age even when inventory revision is unchanged', async () => {
  let now = Date.parse('2026-11-10T00:00:00Z'), loads = 0;
  let quote = { version: 'first', expiresAt: now+100 };
  const store = new Store();
  const cache = new PublicCatalogCache({ namespace:'hd:test', ttlMs:5000 }, {
    readRevision: async usd => usd ? {...version(),fx:quote.expiresAt>now?quote:null} : version(),
    store, now: () => now,
  });
  const query = {priceView:'usd'};
  const load = async () => { loads++; return { converted:quote.expiresAt>now }; };
  assert.deepEqual(await cache.get('list', query, load, true), {converted:true});
  assert.deepEqual(await cache.get('list', query, load, true), {converted:true});
  assert.deepEqual(store.ttls,[100]);
  now += 101;
  assert.deepEqual(await cache.get('list', query, load, true), {converted:false});
  assert.equal(loads,2);
  quote = {version:'second',expiresAt:now+100};
  assert.deepEqual(await cache.get('detail', query, async () => {
    const value = await load();
    if (value.converted) now += 101;
    return value;
  }, true), {converted:false});
  assert.equal(cache.metrics().versionRetries,1);
});

test('Redis failures allow only bounded live loads; unknown source errors are never cached', async () => {
  const store = new Store(); store.fail = true;
  const started = deferred<void>(), release = deferred<void>();
  const cache = new PublicCatalogCache({ namespace: 'hd:test', maxConcurrentLoads: 1 }, { readRevision: async () => version(), store });
  const first = cache.get('detail', { id: 'one' }, async () => { started.resolve(); await release.promise; return { id: 'one' }; });
  await started.promise;
  await assert.rejects(cache.get('detail', { id: 'two' }, async () => ({ id: 'two' })), { status: 503 });
  release.resolve(); assert.deepEqual(await first, { id: 'one' });
  assert.ok(cache.metrics().redisErrors >= 2); assert.equal(cache.metrics().rejectedLoads, 1);
  let failures = 0;
  for (let i = 0; i < 2; i++) await assert.rejects(cache.get('detail', { id: 'missing' }, async () => { failures++; throw new ApiError(404, 'NOT_FOUND', 'Missing'); }), { status: 404 });
  assert.equal(failures, 2);
});

test('caller timeout retains the actual source concurrency slot until the source settles', async () => {
  const release = deferred<{ ok: boolean }>();
  const cache = new PublicCatalogCache({ namespace: 'hd:test', maxConcurrentLoads: 1, requestTimeoutMs: 15 }, { readRevision: async () => version() });
  await assert.rejects(cache.get('list', {}, () => release.promise), { status: 503 });
  assert.equal(cache.metrics().activeLoads, 1);
  await assert.rejects(cache.get('filters', {}, async () => ({})), { status: 503 });
  release.resolve({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.metrics().activeLoads, 0);
});

test('the scale namespace and upper load limit work while slow revision reads stay bounded', async () => {
  const release = deferred<void>(); let active = 0;
  const cache = new PublicCatalogCache({ namespace: 'hd-ext-scale-review', maxConcurrentLoads: 20 }, { readRevision: async () => version() });
  const pending = Array.from({ length: 20 }, (_, id) => cache.get('detail', { id }, async () => { active++; await release.promise; return { id }; }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(active, 20);
  await assert.rejects(cache.get('detail', { id: 21 }, async () => ({})), { status: 503 });
  release.resolve(); await Promise.all(pending);
  const database = deferred<PublicCatalogRevision>();
  const blocked = new PublicCatalogCache({ namespace: 'hd-ext-scale-review' }, { readRevision: () => database.promise });
  const requests = Promise.allSettled(Array.from({ length: 33 }, (_, id) => blocked.get('detail', { id }, async () => ({ id }))));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(blocked.metrics().activeRevisionReads, 32); assert.equal(blocked.metrics().rejectedLoads, 1);
  database.resolve(version()); await requests;
  assert.equal(blocked.metrics().activeRevisionReads, 0);
});

test('shared slots are bounded and query/locale/route collisions cause misses, never another response', async () => {
  const store = new Store(); let loads = 0;
  const cache = () => new PublicCatalogCache({ namespace: 'hd:test', maxEntries: 2, maxBytes: 400 }, { readRevision: async () => version(), store });
  const one = cache();
  const load = async () => ({ loaded: ++loads });
  const first = await one.get('list', { locale: 'zh' }, load);
  assert.deepEqual(await cache().get('list', { locale: 'zh' }, load), first);
  for (let i = 0; i < 20; i++) await one.get('list', { locale: 'en', page: i }, load);
  assert.ok(store.values.size <= 2); assert.ok(one.metrics().entries <= 2); assert.ok(one.metrics().bytes <= 400);
  const different = await cache().get('filters', { locale: 'zh' }, load);
  assert.notDeepEqual(different, first);
  for (const key of store.values.keys()) store.values.set(key, '{bad json');
  await cache().get('list', { locale: 'zh' }, load);
});

test('oversized values are returned once but cannot consume memory or Redis storage', async () => {
  const store = new Store(); let loads = 0;
  const cache = new PublicCatalogCache({ namespace: 'hd:test', maxValueBytes: 256 }, { readRevision: async () => version(), store });
  for (let i = 0; i < 2; i++) assert.equal((await cache.get('list', {}, async () => { loads++; return { text: 'x'.repeat(1000) }; })).text.length, 1000);
  assert.equal(loads, 2); assert.equal(store.values.size, 0); assert.equal(cache.metrics().entries, 0);
});

test('the revision reader rejects missing, malformed or unavailable state without leaking database errors', async () => {
  const reader = (result: unknown) => ({ pool: { query: async () => result } }) as unknown as Parameters<typeof readPublicCatalogRevision>[0];
  assert.deepEqual(await readPublicCatalogRevision(reader({ rowCount: 1, rows: [version()] })), version());
  for (const result of [{ rowCount: 0, rows: [] }, { rowCount: 1, rows: [{ epoch: 'invalid', revision: '1' }] }, { rowCount: 1, rows: [version('0')] }]) {
    await assert.rejects(readPublicCatalogRevision(reader(result)), { status: 503 });
  }
});

test('response stamps preserve original expiry through L1 and Redis, never extending layered SSR reuse',async()=>{
  let now=Date.parse('2026-11-13T00:00:00Z'),loads=0;const store=new Store();
  const options={namespace:'hd:layered',ttlMs:15000};
  const dependencies={readRevision:async()=>version(),store,now:()=>now};
  const a=new PublicCatalogCache(options,dependencies);
  const first=await a.getVersioned('home',{},async()=>({count:++loads}));
  now+=14000;
  const hit=await a.getVersioned('home',{},async()=>({count:++loads}));
  const b=new PublicCatalogCache(options,dependencies);
  const redis=await b.getVersioned('home',{},async()=>({count:++loads}));
  for(const value of [hit,redis]) {
    assert.equal(value.stamp.validUntil,first.stamp.validUntil);
    assert.equal(Date.parse(value.stamp.validUntil)-Date.parse(value.stamp.checkedAt),1000);
    assert.equal(value.stamp.version,first.stamp.version);
  }
  assert.equal(loads,1);now+=1001;
  assert.equal((await b.getVersioned('home',{},async()=>({count:++loads}))).value.count,2);
});
test('public version is live even with reuse off, scopes deployments and read mode, and bounds media/FX expiry',async()=>{
  const now=Date.parse('2026-11-13T00:00:00Z');let reads=0,revision=version();
  const deps={readRevision:async()=>{reads++;return revision;},now:()=>now};
  const a=new PublicCatalogCache({namespace:'hd:version',enabled:false},deps);
  const initial=await a.currentVersion();await a.currentVersion();assert.equal(reads,2);
  const payload=await a.getVersioned('home',{},async()=>({images:[{remote:{expiresAt:new Date(now+500).toISOString()}}]}));
  assert.equal(payload.stamp.version,initial.version);assert.equal(Date.parse(payload.stamp.validUntil),now+500);
  assert.equal(a.metrics().entries,0);
  for(const options of [{externalCatalog:true},{deployment:{environment:'production',releaseId:'a'.repeat(40)}}]) {
    const scoped=new PublicCatalogCache({namespace:'hd:version',...options},deps);
    assert.notEqual((await scoped.currentVersion()).version,initial.version);
  }
  revision={...version(),fx:{version:'00000000-0000-4000-8000-000000000005',expiresAt:now+100}};
  const usd=await a.currentVersion(true);assert.equal(Date.parse(usd.validUntil),now+100);
  assert.notEqual(usd.version,initial.version);
});

test('formal cold misses bound four running plus sixteen queued keys and drain without exceeding concurrency',async()=>{
  const release=deferred<void>();let active=0,peak=0,loads=0;
  const cache=new PublicCatalogCache({namespace:'hd:queue',maxConcurrentLoads:4,maxQueuedLoads:16}, {readRevision:async()=>version()});
  const requests=Array.from({length:20},(_,id)=>cache.get('detail',{id},async()=>{
    loads++;peak=Math.max(peak,++active);await release.promise;active--;return {id};
  }));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cache.metrics().activeLoads,4);assert.equal(cache.metrics().queuedLoads,16);
  await assert.rejects(cache.get('detail',{id:21},async()=>({id:21})),{status:503});
  release.resolve();const results=await Promise.all(requests);assert.equal(results.length,20);assert.equal(loads,20);assert.equal(peak,4);
  assert.equal(cache.metrics().queuedLoads,0);assert.equal(cache.metrics().activeLoads,0);
});
test('expired queued keys never dispatch after a running source releases its slot',async()=>{
  const release=deferred<void>();let queuedCalls=0;
  const cache=new PublicCatalogCache({namespace:'hd:queue-timeout',maxConcurrentLoads:1,maxQueuedLoads:1,requestTimeoutMs:15}, {readRevision:async()=>version()});
  const first=assert.rejects(cache.get('detail',{id:1},async()=>{await release.promise;return {};}),{status:503});
  await new Promise(resolve=>setImmediate(resolve));
  const second=assert.rejects(cache.get('detail',{id:2},async()=>{queuedCalls++;return {};}),{status:503});
  await Promise.all([first,second]);await new Promise(resolve=>setTimeout(resolve,5));release.resolve();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(queuedCalls,0);assert.equal(cache.metrics().queuedLoads,0);assert.equal(cache.metrics().activeLoads,0);
});

test('cancelling the last waiter removes a queued key; one cancelled joiner cannot cancel other clients',async()=>{
  const release=deferred<void>();let queuedCalls=0;
  const cache=new PublicCatalogCache({namespace:'hd:cancel',maxConcurrentLoads:1,maxQueuedLoads:1},{readRevision:async()=>version()});
  const running=cache.get('detail',{id:1},async()=>{await release.promise;return {id:1};});
  await new Promise(resolve=>setImmediate(resolve));
  const a=new AbortController(),b=new AbortController();
  const first=assert.rejects(cache.get('detail',{id:2},async()=>{queuedCalls++;return {id:2};},false,a.signal),{status:503});
  const second=assert.rejects(cache.get('detail',{id:2},async()=>{throw new Error('must share owner');},false,b.signal),{status:503});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(cache.metrics().queuedLoads,1);
  a.abort();await first;assert.equal(cache.metrics().queuedLoads,1);
  b.abort();await second;await new Promise(resolve=>setImmediate(resolve));assert.equal(cache.metrics().queuedLoads,0);
  const c=new AbortController();
  const cancelled=assert.rejects(cache.get('detail',{id:3},async()=>{queuedCalls++;return {id:3};},false,c.signal),{status:503});
  const survivor=cache.get('detail',{id:3},async()=>{throw new Error('must share owner');});
  await new Promise(resolve=>setImmediate(resolve));c.abort();await cancelled;assert.equal(cache.metrics().queuedLoads,1);
  release.resolve();await running;assert.deepEqual(await survivor,{id:3});assert.equal(queuedCalls,1);
  assert.equal(cache.metrics().queuedLoads,0);assert.equal(cache.metrics().activeLoads,0);
});
