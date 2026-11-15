import { createHash } from 'node:crypto';
import { PUBLIC_CATALOG_CACHE_MAX_TTL_MS, type PublicCatalogCacheStamp } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';
import { ACTIVE_FX_SQL } from './fx.js';
import { canonicalJson } from './normalize.js';
import { createRedisPublicCacheStore, type PublicCacheStore, type RedisPublicCacheOptions } from './redis-cache.js';

export const PUBLIC_CATALOG_REVISION_SQL = 'SELECT epoch::text,revision::text FROM public_catalog_state WHERE id=1';
const USD_CATALOG_REVISION_SQL = `SELECT s.epoch::text,s.revision::text,f.version::text AS fx_version,f.expires_at AS fx_expires_at
  FROM public_catalog_state s LEFT JOIN public_fx_quote f ON ${ACTIVE_FX_SQL}
  WHERE s.id=1`;
export type PublicCatalogRevision = { epoch: string; revision: string; fx?: { version: string; expiresAt: number } | null };
type DatabaseReader = Pick<Database, 'pool'>;
const unavailable = () => new ApiError(503, 'SERVICE_UNAVAILABLE', 'Public catalog is temporarily unavailable.', undefined, true);
export async function readPublicCatalogRevision(db: DatabaseReader, usd = false): Promise<PublicCatalogRevision> {
  try {
    const result = await db.pool.query<PublicCatalogRevision & {fx_version?:string|null;fx_expires_at?:Date|null}>(usd ? USD_CATALOG_REVISION_SQL : PUBLIC_CATALOG_REVISION_SQL);
    const row = result.rows[0];
    if (result.rowCount !== 1 || !row || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.epoch) || !/^[1-9][0-9]{0,18}$/.test(row.revision)) throw unavailable();
    const revision:PublicCatalogRevision = {epoch:row.epoch,revision:row.revision};
    if (usd) {
      if (row.fx_version === null && row.fx_expires_at === null) revision.fx = null;
      else if (row.fx_version && row.fx_expires_at instanceof Date && Number.isFinite(row.fx_expires_at.getTime()))
        revision.fx = {version:row.fx_version,expiresAt:row.fx_expires_at.getTime()};
      else throw unavailable();
    }
    return revision;
  } catch { throw unavailable(); }
}

export type PublicCacheRoute = 'list' | 'filters' | 'detail' | 'home';
export type PublicCatalogCacheOptions = {
  namespace: string; redis?: RedisPublicCacheOptions; ttlMs?: number; maxConcurrentLoads?: number; maxConcurrentRevisionReads?: number;
  maxEntries?: number; maxBytes?: number; maxValueBytes?: number; requestTimeoutMs?: number;
  maxQueuedLoads?: number;
  enabled?: boolean; externalCatalog?: boolean;
  deployment?: {environment:string;releaseId:string};
};
export type PublicCacheMetrics = {
  localHits: number; redisHits: number; misses: number; originLoads: number; rejectedLoads: number;
  redisErrors: number; invalidEntries: number; oversizedValues: number; versionRetries: number; timeouts: number;
  activeLoads: number; activeRevisionReads: number; queuedLoads: number; entries: number; bytes: number;
};
type Envelope = { format: 1; key: string; expiresAt: number; value: unknown };
type MemoryEntry = { encoded: string; expiresAt: number; bytes: number };
type Flight = {promise:Promise<Envelope>;controller:AbortController;waiters:number};
type Dependencies = { readRevision: (usd: boolean) => Promise<PublicCatalogRevision>; store?: PublicCacheStore; now?: () => number };
const sameRevision = (a: PublicCatalogRevision, b: PublicCatalogRevision) => a.epoch === b.epoch && a.revision === b.revision &&
  a.fx?.version === b.fx?.version && a.fx?.expiresAt === b.fx?.expiresAt;
const bounded = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
const json = (value: unknown) => JSON.stringify(value, (key, item) => key === 'requestId' ? undefined : item);
async function waitFor<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  if(signal.aborted)throw unavailable();
  let abort!:()=>void;
  try {return await Promise.race([promise,new Promise<never>((_,reject)=>{
    abort=()=>reject(unavailable());signal.addEventListener('abort',abort,{once:true});
  })]);}finally{signal.removeEventListener('abort',abort);}
}

/** No request IDs or shared mutable DTOs cross request boundaries. Public routes alone may use this cache. */
export class PublicCatalogCache {
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly flights = new Map<string, Flight>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxLoads: number;
  private readonly maxQueuedLoads: number;
  private readonly queue: Array<{resolve:()=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>}> = [];
  private readonly maxRevisionReads: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxValueBytes: number;
  private readonly timeoutMs: number;
  private closed = false;
  private values: PublicCacheMetrics = { localHits: 0, redisHits: 0, misses: 0, originLoads: 0, rejectedLoads: 0,
    redisErrors: 0, invalidEntries: 0, oversizedValues: 0, versionRetries: 0, timeouts: 0,
    activeLoads: 0, activeRevisionReads: 0, queuedLoads: 0, entries: 0, bytes: 0 };

  constructor(private readonly options: PublicCatalogCacheOptions, private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 15_000;
    this.maxLoads = options.maxConcurrentLoads ?? 4;
    this.maxQueuedLoads = options.maxQueuedLoads ?? 0;
    this.maxRevisionReads = options.maxConcurrentRevisionReads ?? 32;
    this.maxEntries = options.maxEntries ?? 64;
    this.maxBytes = options.maxBytes ?? 16 * 1_048_576;
    this.maxValueBytes = options.maxValueBytes ?? 1_048_576;
    this.timeoutMs = options.requestTimeoutMs ?? 3000;
    if (!/^(?:hd:[A-Za-z0-9:_-]{1,80}|hd-ext-scale-[a-z0-9-]{1,48})$/.test(options.namespace) || !bounded(this.ttlMs, 1, 30_000) || !bounded(this.maxLoads, 1, 20) ||
        !bounded(this.maxEntries, 1, 64) || !bounded(this.maxBytes, 1, 16 * 1_048_576) || !bounded(this.maxValueBytes, 256, 1_048_576) ||
        !bounded(this.timeoutMs, 10, 15_000) || !bounded(this.maxRevisionReads, 1, 128) || !bounded(this.maxQueuedLoads,0,32)) throw new Error('Invalid public cache configuration.');
  }

  metrics(): PublicCacheMetrics { return { ...this.values, entries: this.memory.size }; }
  private stamp(revision: PublicCatalogRevision, usd: boolean, expiresAt = Infinity): PublicCatalogCacheStamp {
    const checkedAt = this.now();
    const validUntil = Math.min(expiresAt, checkedAt + PUBLIC_CATALOG_CACHE_MAX_TTL_MS, revision.fx?.expiresAt ?? Infinity);
    if (validUntil <= checkedAt) throw unavailable();
    // Includes deployment read policy: toggling external visibility cannot reuse a broader DTO.
    const version = createHash('sha256').update(canonicalJson([4, revision.epoch, revision.revision,
      this.options.deployment ?? {environment:'test',releaseId:'unreleased'},
      !!this.options.externalCatalog, usd, usd ? revision.fx ?? null : null])).digest('hex');
    return { version, priceView: usd ? 'usd' : 'original',
      fx: usd && revision.fx ? { version: revision.fx.version, expiresAt: new Date(revision.fx.expiresAt).toISOString() } : null,
      checkedAt: new Date(checkedAt).toISOString(), validUntil: new Date(validUntil).toISOString() };
  }
  /** A live, bounded DB read; deliberately never enters L1, Redis or the single-flight map. */
  async currentVersion(usd = false,signal?:AbortSignal) {
    return this.withDeadline(async () => this.stamp(await this.revision(usd), usd),signal);
  }
  private async revision(usd: boolean) {
    // A slow/unavailable database cannot grow an unbounded pool wait queue through cache lookups.
    if (this.closed || this.values.activeRevisionReads >= this.maxRevisionReads) { this.values.rejectedLoads++; throw unavailable(); }
    this.values.activeRevisionReads++;
    try { return await this.dependencies.readRevision(usd); }
    catch { throw unavailable(); }
    finally { this.values.activeRevisionReads--; }
  }
  private remove(key: string) {
    const old = this.memory.get(key);
    if (old) { this.values.bytes -= old.bytes; this.memory.delete(key); }
  }
  private remember(key: string, encoded: string, expiresAt: number) {
    const bytes = Buffer.byteLength(encoded);
    if (bytes > this.maxValueBytes || bytes > this.maxBytes || expiresAt <= this.now()) return;
    this.remove(key);
    for (const [oldKey, entry] of this.memory) if (entry.expiresAt <= this.now()) this.remove(oldKey);
    while (this.memory.size >= this.maxEntries || this.values.bytes + bytes > this.maxBytes) this.remove(this.memory.keys().next().value!);
    this.memory.set(key, { encoded, expiresAt, bytes }); this.values.bytes += bytes;
  }
  private parse(encoded: string, key: string): Envelope | null {
    try {
      if (Buffer.byteLength(encoded) > this.maxValueBytes) return null;
      const value = JSON.parse(encoded) as Envelope;
      if (value?.format !== 1 || value.key !== key || !Number.isFinite(value.expiresAt) || value.expiresAt <= this.now() ||
          value.expiresAt > this.now() + 30_000 || !Object.hasOwn(value, 'value') || json(value) !== encoded) return null;
      // JSON roundtrip comparison also excludes requestId in poisoned/old cache entries.
      return value;
    } catch { return null; }
  }
  private slot(key: string) { return `${this.options.namespace}:slot:${parseInt(key.slice(0, 8), 16) % this.maxEntries}`; }
  private deadline(value: unknown): number {
    let deadline = this.now() + this.ttlMs;
    const stack: unknown[] = [value];
    while (stack.length) {
      const item = stack.pop();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item)) { for (const child of item) stack.push(child); continue; }
      const object = item as Record<string, unknown>;
      const remote = object.remote as Record<string, unknown> | undefined;
      if (remote && typeof remote === 'object' && remote.expiresAt != null) {
        const expiry = typeof remote.expiresAt === 'string' ? Date.parse(remote.expiresAt) : NaN;
        if (!Number.isFinite(expiry)) return 0;
        deadline = Math.min(deadline, expiry);
      }
      const report = object.reportAccess as Record<string, unknown> | undefined;
      if (report && typeof report === 'object' && (report.status === 'available' || report.status === 'unavailable')) {
        const expiry = typeof report.expiresAt === 'string' ? Date.parse(report.expiresAt) : NaN;
        if (!Number.isFinite(expiry)) return 0;
        deadline = Math.min(deadline, expiry);
      }
      for (const child of Object.values(object)) stack.push(child);
    }
    return deadline;
  }
  private async lookup(key: string): Promise<Envelope | null> {
    if (this.options.enabled === false) return null;
    const local = this.memory.get(key);
    if (local) {
      const envelope = this.parse(local.encoded, key);
      if (envelope) {
        this.memory.delete(key); this.memory.set(key, local); this.values.localHits++; return envelope;
      }
      this.remove(key);
    }
    if (!this.dependencies.store) return null;
    try {
      const encoded = await this.dependencies.store.get(this.slot(key));
      if (encoded === null) return null;
      const envelope = this.parse(encoded, key);
      if (!envelope) { this.values.invalidEntries++; return null; }
      this.remember(key, encoded, envelope.expiresAt); this.values.redisHits++; return envelope;
    } catch { this.values.redisErrors++; return null; }
  }
  private async load<T>(key: string, revision: PublicCatalogRevision, load: () => Promise<T>, usd: boolean, deadline: number, signal:AbortSignal): Promise<Envelope> {
    await this.acquireLoad(deadline,signal);
    try {
      if(signal.aborted || performance.now()>=deadline)throw unavailable();
      this.values.originLoads++;
      const value = JSON.parse(json(await load())) as T;
      if (!sameRevision(revision, await this.revision(usd))) { this.values.versionRetries++; throw changedRevision; }
      const expiresAt = Math.min(this.deadline(value), this.now() + PUBLIC_CATALOG_CACHE_MAX_TTL_MS, revision.fx?.expiresAt ?? Infinity);
      // A source read which outlives a media URL is not allowed to return an already expired picture.
      if (expiresAt <= this.now()) throw unavailable();
      const envelope = { format: 1 as const, key, expiresAt, value };
      if (this.options.enabled === false) return envelope;
      const encoded = JSON.stringify(envelope);
      if (Buffer.byteLength(encoded) > this.maxValueBytes) { this.values.oversizedValues++; return envelope; }
      this.remember(key, encoded, expiresAt);
      if (this.dependencies.store) {
        const ttl = Math.floor(expiresAt - this.now());
        if (ttl > 0) try { await this.dependencies.store.set(this.slot(key), encoded, ttl); }
        catch { this.values.redisErrors++; }
      }
      if (expiresAt <= this.now()) throw unavailable();
      return envelope;
    } finally { this.releaseLoad(); }
  }
  private async acquireLoad(deadline:number,signal:AbortSignal) {
    if(this.closed || signal.aborted || performance.now()>=deadline)throw unavailable();
    if(this.values.activeLoads<this.maxLoads){this.values.activeLoads++;return;}
    if(this.queue.length>=this.maxQueuedLoads){this.values.rejectedLoads++;throw unavailable();}
    let abort!:()=>void;
    try {await new Promise<void>((resolve,reject)=>{
      abort=()=>{
        const index=this.queue.indexOf(waiting);
        if(index>=0){clearTimeout(waiting.timer);this.queue.splice(index,1);this.values.queuedLoads--;reject(unavailable());}
      };
      const waiting={resolve,reject,timer:setTimeout(abort,Math.max(1,deadline-performance.now()))};
      this.queue.push(waiting);this.values.queuedLoads++;
      signal.addEventListener('abort',abort,{once:true});
    });}finally{signal.removeEventListener('abort',abort);}
  }
  private releaseLoad() {
    this.values.activeLoads--;
    const waiting=this.queue.shift();
    if(waiting){clearTimeout(waiting.timer);this.values.queuedLoads--;this.values.activeLoads++;waiting.resolve();}
  }
  async get<T>(route: PublicCacheRoute, normalizedInput: unknown, load: () => Promise<T>, usd = false, signal?:AbortSignal): Promise<T> {
    return (await this.getVersioned(route, normalizedInput, load, usd, signal)).value;
  }
  async getVersioned<T>(route: PublicCacheRoute, normalizedInput: unknown, load: () => Promise<T>, usd = false, signal?:AbortSignal): Promise<{value:T;stamp:PublicCatalogCacheStamp}> {
    const deadline=performance.now()+this.timeoutMs;
    if (!['list', 'filters', 'detail', 'home'].includes(route) || this.closed) throw unavailable();
    const input = canonicalJson(normalizedInput);
    if (Buffer.byteLength(input) > 16_384) throw unavailable();
    const work = async (requestSignal:AbortSignal) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const revision = await this.revision(usd);
        if(requestSignal.aborted)throw unavailable();
        const keyParts = [this.stamp(revision, usd).version, route, input];
        const key = createHash('sha256').update(canonicalJson(keyParts)).digest('hex');
        const cached = await this.lookup(key);
        if(requestSignal.aborted)throw unavailable();
        if (cached) return { value: cached.value as T, stamp: this.stamp(revision, usd, cached.expiresAt) };
        this.values.misses++;
        let flight = this.flights.get(key);
        if (!flight) {
          const controller=new AbortController();
          flight={promise:this.load(key, revision, load, usd, deadline,controller.signal),controller,waiters:0};
          this.flights.set(key, flight);
          const own=flight;
          void own.promise.finally(() => { if (this.flights.get(key) === own) this.flights.delete(key); }).catch(() => {});
        }
        flight.waiters++;
        try {
          const envelope = await waitFor(flight.promise,requestSignal);
          return { value: JSON.parse(json(envelope.value)) as T, stamp: this.stamp(revision, usd, envelope.expiresAt) };
        }
        catch (error) { if (error !== changedRevision) throw error; }
        finally {if(--flight.waiters===0)flight.controller.abort();}
      }
      throw unavailable();
    };
    return this.withDeadline(work,signal);
  }
  private async withDeadline<T>(work: (signal:AbortSignal) => Promise<T>, external?:AbortSignal): Promise<T> {
    const controller=new AbortController(),abort=()=>controller.abort();
    if(external?.aborted)throw unavailable();
    external?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{this.values.timeouts++;controller.abort();},this.timeoutMs);
    // The underlying load keeps its concurrency slot until it really settles, even after a caller times out.
    try { return await waitFor(work(controller.signal),controller.signal); }
    finally { clearTimeout(timer);external?.removeEventListener('abort',abort); }
  }
  async close() {
    this.closed = true;
    for(const waiting of this.queue.splice(0)){clearTimeout(waiting.timer);waiting.reject(unavailable());}
    this.values.queuedLoads=0;this.memory.clear();this.values.bytes=0;await this.dependencies.store?.close();
  }
}
const changedRevision = Symbol('public catalog changed during load');

export async function createPublicCatalogCache(db: DatabaseReader, options: PublicCatalogCacheOptions): Promise<PublicCatalogCache> {
  const store = options.redis ? await createRedisPublicCacheStore(options.redis, options.maxValueBytes ?? 1_048_576) : undefined;
  return new PublicCatalogCache(options, { readRevision: usd => readPublicCatalogRevision(db, usd), store });
}
