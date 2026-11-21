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
  await assert.rejects(cache.get('home', {}, load), { status: 503, reason: 'revision-read', message: 'Public catalog is temporarily unavailable.' });
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
  await assert.rejects(unstable.get('detail', {}, async () => { revision = version(String(Number(revision.revision) + 1)); return {}; }), { status: 503, reason: 'revision-changed' });
});

test('filters return a coherent uncached snapshot during repeated directory commits, then cache a stable read', async () => {
  let revision = version(), loads = 0;
  const store = new Store();
  const cache = new PublicCatalogCache({ namespace: 'hd:test' }, { readRevision: async () => revision, store });
  const run = (commit: boolean) => cache.getFilterSnapshot({ locale:'zh' },async () => {
    const snapshot = revision;
    loads++;
    if (commit) revision = version(String(Number(revision.revision) + 1));
    return { value:{ total:Number(snapshot.revision) },revision:snapshot };
  });
  assert.deepEqual(await run(true),{value:{total:1},stamp:undefined});
  assert.deepEqual(await run(true),{value:{total:2},stamp:undefined});
  assert.equal(cache.metrics().uncachedFilterLoads,2);
  assert.equal(cache.metrics().localHits,0);
  assert.equal(store.values.size,0);
  const steady = await run(false);
  assert.equal(steady.value.total,3);
  assert.ok(steady.stamp);
  assert.equal(steady.stamp.version,(await cache.currentVersion(false,undefined,'filters')).version);
  assert.notEqual(steady.stamp.version,(await cache.currentVersion()).version);
  assert.equal((await run(true)).value.total,3);
  assert.equal(loads,3);
  assert.equal(store.values.size,1);
});

test('uncached filter snapshots still reject a changed FX quote, restore epoch or failed version read', async () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  let revision: PublicCatalogRevision = { ...version(),fx:{version:'first',expiresAt:now+1000} };
  const cache = new PublicCatalogCache({ namespace:'hd:test' },{ now:()=>now,readRevision:async()=>revision });
  for (const mode of ['fx','epoch','failed-read'] as const) {
    let attempts = 0;
    const reader = mode === 'failed-read' ? new PublicCatalogCache({namespace:'hd:test'},{now:()=>now,readRevision:async()=>{
      if (attempts) throw new Error('unavailable');
      return revision;
    }}) : cache;
    await assert.rejects(reader.getFilterSnapshot({},async()=>{
      const snapshot=revision;
      attempts++;
      revision=mode==='fx' ? {...revision,fx:{version:String(attempts),expiresAt:now+1000}} :
        {...revision,epoch:attempts===1?epoch.replace(/1$/,'2'):epoch};
      return {value:{total:1},revision:snapshot};
    },true),{status:503,reason:mode==='failed-read'?'revision-read':'revision-changed'});
    assert.equal(attempts,mode==='failed-read'?1:2);
    assert.equal(reader.metrics().uncachedFilterLoads,0);
    revision={ ...version(),fx:{version:'first',expiresAt:now+1000} };
  }
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

test('negotiated internal entries retain their absolute Redis lifetime without renewing or crossing into v1', async () => {
  let now = Date.parse('2026-11-18T00:00:00Z'), loads = 0;
  const store = new Store();
  const options = { namespace:'hd:test',maxEntries:64 };
  const origin = { readRevision:async()=>version(),store,now:()=>now };
  const cache = new PublicCatalogCache(options,origin), replica = new PublicCatalogCache(options,origin);
  const load = async () => ({ load:++loads });
  const read = (reader:PublicCatalogCache, protocol:1|2) => reader.getVersioned('home',{},load,false,undefined,protocol);
  const extended=await read(cache,2), legacy=await read(cache,1);
  assert.equal(extended.stamp.version,legacy.stamp.version);
  assert.deepEqual([extended.value.load,legacy.value.load],[1,2]);
  assert.deepEqual(store.ttls,[300_000,15_000]);
  now+=20_000;
  const old=await read(cache,1);
  assert.equal(old.value.load,3);
  const cached=await read(replica,2);
  assert.equal(cached.value.load,1);
  assert.equal(cached.stamp.validUntil,extended.stamp.validUntil);
  assert.equal(Date.parse(cached.stamp.validUntil)-Date.parse(cached.stamp.checkedAt),280_000);
  assert.equal(replica.metrics().redisHits,1);
  now+=280_000;
  assert.equal((await read(cache,2)).value.load,4);
});

test('internal facet lifetime incorporates an omitted cover dependency and the active FX cutoff', async () => {
  const now=Date.parse('2026-11-18T00:00:00Z');
  const revision={...version(),fx:{version:'rate',expiresAt:now+70_000}};
  const store=new Store();
  const cache=new PublicCatalogCache({namespace:'hd:test'}, {readRevision:async()=>revision,store,now:()=>now});
  const withCover=await cache.getFilterSnapshot({projection:'home-models'},async()=>({
    value:{models:[]},revision,expiresAt:now+43_000,
  }),true,undefined,2);
  const withFx=await cache.getFilterSnapshot({projection:'overview'},async()=>({value:{total:20},revision}),true,undefined,2);
  const unscoped=await cache.getBoundedVersioned('filters',{projection:'home-models'},async()=>({
    value:{models:[]},expiresAt:now+32_000,
  }),true,undefined,2);
  assert.equal(Date.parse(withCover.stamp!.validUntil),now+43_000);
  assert.equal(Date.parse(withFx.stamp!.validUntil),now+70_000);
  assert.equal(Date.parse(unscoped.stamp.validUntil),now+32_000);
  assert.deepEqual(store.ttls,[43_000,70_000,32_000]);
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

test('cold same-key callers share one Redis attempt and one bounded origin load during a Redis outage',async()=>{
  const redis=deferred<void>(),origin=deferred<void>(),originStarted=deferred<void>();
  const store=new Store();
  let gets=0,loads=0;
  store.get=async()=>{gets++;await redis.promise;throw new Error('Private Redis outage');};
  store.fail=true;
  const cache=new PublicCatalogCache({namespace:'hd:redis-burst',maxConcurrentLoads:1},{readRevision:async()=>version(),store});
  const request=()=>cache.get('filters',{locale:'ru',projection:'overview'},async()=>{
    loads++;originStarted.resolve();await origin.promise;return {total:1};
  });
  const waiting=Array.from({length:20},request);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gets,1);
  redis.resolve();
  await originStarted.promise;
  const joiner=request();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gets,1);
  assert.equal(cache.metrics().activeLoads,1);
  origin.resolve();
  for(const result of await Promise.all([...waiting,joiner]))assert.deepEqual(result,{total:1});
  assert.equal(loads,1);
  assert.equal(cache.metrics().activeLoads,0);
  assert.equal(cache.metrics().rejectedLoads,0);
});

test('same-key coalesced Redis hits keep caller DTOs independent',async()=>{
  const store=new Store();
  const options={namespace:'hd:redis-coalesced-hit'},dependencies={readRevision:async()=>version(),store};
  const writer=new PublicCatalogCache(options,dependencies);
  await writer.get('list',{locale:'ru'},async()=>({items:[{id:'valid'}]}));
  const original=store.get.bind(store),release=deferred<void>();
  let gets=0;
  store.get=async key=>{gets++;await release.promise;return original(key);};
  const reader=new PublicCatalogCache(options,dependencies);
  const load=async()=>{throw new Error('Unexpected origin fetch');};
  const first=reader.get<{items:{id:string}[]}>('list',{locale:'ru'},load);
  const second=reader.get<{items:{id:string}[]}>('list',{locale:'ru'},load);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gets,1);
  release.resolve();
  const [a,b]=await Promise.all([first,second]);
  a.items[0]!.id='caller edit';
  assert.equal(b.items[0]!.id,'valid');
});

test('caller timeout retains the actual source concurrency slot until the source settles', async () => {
  const release = deferred<{ ok: boolean }>();
  const cache = new PublicCatalogCache({ namespace: 'hd:test', maxConcurrentLoads: 1, requestTimeoutMs: 15 }, { readRevision: async () => version() });
  await assert.rejects(cache.get('list', {}, () => release.promise), { status: 503, reason: 'deadline' });
  assert.equal(cache.metrics().activeLoads, 1);
  await assert.rejects(cache.get('filters', {}, async () => ({})), { status: 503, reason: 'load-capacity' });
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

test('English title, inline and legacy details cannot share cache entries or in-flight work',async()=>{
 const cache=new PublicCatalogCache({namespace:'hd:test-inline'},{readRevision:async()=>version()});
 const query={id:'vehicle',locale:'ru',view:'localized'},release=deferred<void>();let oldLoads=0,newLoads=0,titleLoads=0;
 const old=()=>cache.get('detail',query,async()=>{oldLoads++;await release.promise;return {shape:'legacy'};});
 const inline=()=>cache.get('detail',{...query,projection:'detail-inline-v1'},async()=>{newLoads++;await release.promise;return {shape:'inline'};});
 const title=()=>cache.get('detail',{...query,projection:'detail-inline-v1',titleView:'english'},async()=>{titleLoads++;await release.promise;return {shape:'title'};});
 const pending=[old(),inline(),title(),old(),inline(),title()];release.resolve();
 assert.deepEqual((await Promise.all(pending)).map(value=>value.shape),['legacy','inline','title','legacy','inline','title']);
 assert.equal((await old()).shape,'legacy');assert.equal((await inline()).shape,'inline');assert.equal((await title()).shape,'title');
 assert.equal(oldLoads,1);assert.equal(newLoads,1);assert.equal(titleLoads,1);await cache.close();
});
