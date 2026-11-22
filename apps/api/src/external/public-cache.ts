import { createHash } from 'node:crypto';
import { INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS, PUBLIC_CATALOG_CACHE_MAX_TTL_MS, type PublicCatalogCacheStamp } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';
import { ACTIVE_FX_SQL } from './fx.js';
import { canonicalJson } from './normalize.js';
import { createRedisPublicCacheStore, type PublicCacheStore, type RedisPublicCacheOptions } from './redis-cache.js';

export type PublicCatalogRevision = { epoch: string; revision: string; fx?: { version: string; expiresAt: number } | null };
export type CatalogRevisionProof = (deadline: number, signal: AbortSignal) => Promise<PublicCatalogRevision | null>;
type RevisionScope = 'catalog' | 'filters';
type HomepageRevisions = Record<RevisionScope, PublicCatalogRevision>;
type CacheProtocol = 1 | 2;
const maxLifetime = (protocol: CacheProtocol) => protocol === 2 ? INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS : PUBLIC_CATALOG_CACHE_MAX_TTL_MS;
type DatabaseReader = { pool: Pick<Database['pool'], 'query'> };
type CatalogUnavailableReason = 'revision-read' | 'revision-capacity' | 'revision-changed' | 'load-capacity' |
  'deadline' | 'expired' | 'cancelled' | 'closed' | 'invalid-input';
type RevisionConflict = 'catalog-advanced' | 'epoch-changed' | 'fx-changed' | 'revision-regressed' | 'offset-page-changed';
export class PublicCatalogUnavailableError extends ApiError {
  constructor(readonly reason: CatalogUnavailableReason, readonly revisionConflicts?: readonly RevisionConflict[], readonly sqlState?:'57014') {
    super(503, 'SERVICE_UNAVAILABLE', 'Public catalog is temporarily unavailable.', undefined, true);
  }
}
const unavailable = (reason: CatalogUnavailableReason) => new PublicCatalogUnavailableError(reason);
const validRevision = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
async function readRevisionRow(db: DatabaseReader, usd: boolean, scope: RevisionScope, includeFilters = false) {
  const revisionColumn = scope === 'filters' ? 'filter_revision' : 'revision';
  try {
    const result = await db.pool.query<PublicCatalogRevision & {filter_revision?:string;fx_version?:string|null;fx_expires_at?:Date|null}>(`SELECT s.epoch::text,s.${revisionColumn}::text AS revision
      ${includeFilters ? ',s.filter_revision::text AS filter_revision' : ''}
      ${usd ? ',f.version::text AS fx_version,f.expires_at AS fx_expires_at' : ''} FROM public_catalog_state s
      ${usd ? `LEFT JOIN public_fx_quote f ON ${ACTIVE_FX_SQL}` : ''} WHERE s.id=1`);
    const row = result.rows[0];
    if (result.rowCount !== 1 || !row || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.epoch) || !validRevision(row.revision)) throw unavailable('revision-read');
    const revision:PublicCatalogRevision = {epoch:row.epoch,revision:row.revision};
    if (usd) {
      if (row.fx_version === null && row.fx_expires_at === null) revision.fx = null;
      else if (row.fx_version && row.fx_expires_at instanceof Date && Number.isFinite(row.fx_expires_at.getTime()))
        revision.fx = {version:row.fx_version,expiresAt:row.fx_expires_at.getTime()};
      else throw unavailable('revision-read');
    }
    return { revision, filterRevision:row.filter_revision };
  } catch(error) {
    if(error && typeof error==='object' && 'code' in error && error.code==='57014') {
      throw new PublicCatalogUnavailableError('revision-read',undefined,'57014');
    }
    throw unavailable('revision-read');
  }
}
export async function readPublicCatalogRevision(db: DatabaseReader, usd = false, scope: RevisionScope = 'catalog'): Promise<PublicCatalogRevision> {
  return (await readRevisionRow(db,usd,scope)).revision;
}
async function readHomepageRevisions(db: DatabaseReader): Promise<HomepageRevisions> {
  const {revision,filterRevision}=await readRevisionRow(db,true,'catalog',true);
  if (!validRevision(filterRevision)) throw unavailable('revision-read');
  return { catalog:revision, filters:{...revision,revision:filterRevision} };
}

export type PublicCacheRoute = 'list' | 'filters' | 'detail' | 'home';
export type PublicCacheReadPhase = 'cache_revision' | 'cache_lookup' | 'origin_queue' | 'origin_shared';
type CacheReadObserver = (phase: PublicCacheReadPhase) => void;
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
  uncachedFilterLoads: number; uncachedListLoads: number; detailRevalidations: number;
  activeLoads: number; activeRevisionReads: number; queuedLoads: number; entries: number; bytes: number;
};
type Envelope = { format: 1; key: string; expiresAt: number; value: unknown };
type MemoryEntry = { encoded: string; expiresAt: number; bytes: number };
type PublicSourceResult<T> = { value: T; expiresAt?: number };
type PublicSnapshot<T> = PublicSourceResult<T> & { revision: PublicCatalogRevision; verifyAfterAdvance?: CatalogRevisionProof };
type LoadedEnvelope = Envelope & { revision: PublicCatalogRevision; snapshotOnly?: true };
type Flight = {promise:Promise<LoadedEnvelope>;controller:AbortController;waiters:number};
type Dependencies = { readRevision: (usd: boolean, scope: RevisionScope) => Promise<PublicCatalogRevision>;
  readHomepageRevisions?: () => Promise<HomepageRevisions>; store?: PublicCacheStore; now?: () => number };
const sameEpochAndFx = (a: PublicCatalogRevision, b: PublicCatalogRevision) => a.epoch === b.epoch &&
  a.fx?.version === b.fx?.version && a.fx?.expiresAt === b.fx?.expiresAt;
const sameRevision = (a: PublicCatalogRevision, b: PublicCatalogRevision) => sameEpochAndFx(a,b) && a.revision === b.revision;
function snapshotConflict(start: PublicCatalogRevision, snapshot: PublicCatalogRevision, current: PublicCatalogRevision): RevisionConflict | undefined {
  if (start.epoch !== snapshot.epoch || snapshot.epoch !== current.epoch) return 'epoch-changed';
  if (!sameEpochAndFx(start,snapshot) || !sameEpochAndFx(snapshot,current)) return 'fx-changed';
  if (BigInt(start.revision) > BigInt(snapshot.revision) || BigInt(snapshot.revision) > BigInt(current.revision)) return 'revision-regressed';
}
class ChangedRevision {
  constructor(readonly conflict:RevisionConflict) {}
}
const bounded = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
const json = (value: unknown) => JSON.stringify(value, (key, item) => key === 'requestId' ? undefined : item);
const interrupted = (signal: AbortSignal) => signal.reason instanceof PublicCatalogUnavailableError ? signal.reason : unavailable('cancelled');
async function waitFor<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  if(signal.aborted)throw interrupted(signal);
  let abort!:()=>void;
  try {return await Promise.race([promise,new Promise<never>((_,reject)=>{
    abort=()=>reject(interrupted(signal));signal.addEventListener('abort',abort,{once:true});
  })]);}finally{signal.removeEventListener('abort',abort);}
}

/** No request IDs or shared mutable DTOs cross request boundaries. Public routes alone may use this cache. */
export class PublicCatalogCache {
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly flights = new Map<string, Flight>();
  private readonly redisReads = new Map<string, Promise<Envelope | null>>();
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
    uncachedFilterLoads: 0, uncachedListLoads: 0, detailRevalidations: 0, activeLoads: 0, activeRevisionReads: 0, queuedLoads: 0, entries: 0, bytes: 0 };

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
  private stamp(revision: PublicCatalogRevision, usd: boolean, scope: RevisionScope, protocol: CacheProtocol, expiresAt = Infinity,
    checkedAt = this.now()): PublicCatalogCacheStamp {
    const validUntil = Math.min(expiresAt, checkedAt + maxLifetime(protocol), revision.fx?.expiresAt ?? Infinity);
    if (validUntil <= checkedAt) throw unavailable('expired');
    // Includes deployment read policy: toggling external visibility cannot reuse a broader DTO.
    const version = createHash('sha256').update(canonicalJson([scope === 'filters' ? 7 : 6, revision.epoch, revision.revision,
      this.options.deployment ?? {environment:'test',releaseId:'unreleased'},
      !!this.options.externalCatalog, usd, usd ? revision.fx ?? null : null])).digest('hex');
    return { version, priceView: usd ? 'usd' : 'original',
      fx: usd && revision.fx ? { version: revision.fx.version, expiresAt: new Date(revision.fx.expiresAt).toISOString() } : null,
      checkedAt: new Date(checkedAt).toISOString(), validUntil: new Date(validUntil).toISOString() };
  }
  /** A live, bounded DB read; deliberately never enters L1, Redis or the single-flight map. */
  async currentVersion(usd = false,signal?:AbortSignal,scope:RevisionScope='catalog',protocol:CacheProtocol=1) {
    return this.withDeadline(async () => this.stamp(await this.revision(usd,scope), usd, scope, protocol),signal);
  }
  async currentHomepageVersions(signal?:AbortSignal) {
    return this.withDeadline(async()=>{
      const read=this.dependencies.readHomepageRevisions;
      if(!read)throw unavailable('revision-read');
      const {catalog,filters}=await this.checkedRevisionRead(read);
      const checkedAt=this.now();
      return {catalog:this.stamp(catalog,true,'catalog',2,Infinity,checkedAt),
        filters:this.stamp(filters,true,'filters',2,Infinity,checkedAt)};
    },signal);
  }
  private revision(usd: boolean, scope: RevisionScope) {
    return this.checkedRevisionRead(()=>this.dependencies.readRevision(usd,scope));
  }
  private async checkedRevisionRead<T>(read:()=>Promise<T>) {
    // A slow/unavailable database cannot grow an unbounded pool wait queue through cache lookups.
    if (this.closed || this.values.activeRevisionReads >= this.maxRevisionReads) { this.values.rejectedLoads++; throw unavailable(this.closed?'closed':'revision-capacity'); }
    this.values.activeRevisionReads++;
    try { return await read(); }
    catch { throw unavailable('revision-read'); }
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
  private parse(encoded: string, key: string, protocol: CacheProtocol): Envelope | null {
    try {
      if (Buffer.byteLength(encoded) > this.maxValueBytes) return null;
      const value = JSON.parse(encoded) as Envelope;
      if (value?.format !== 1 || value.key !== key || !Number.isFinite(value.expiresAt) || value.expiresAt <= this.now() ||
          value.expiresAt > this.now() + maxLifetime(protocol) || !Object.hasOwn(value, 'value') || json(value) !== encoded) return null;
      // JSON roundtrip comparison also excludes requestId in poisoned/old cache entries.
      return value;
    } catch { return null; }
  }
  private slot(key: string) { return `${this.options.namespace}:slot:${parseInt(key.slice(0, 8), 16) % this.maxEntries}`; }
  private resourceKey(route: PublicCacheRoute, input: string, revision: PublicCatalogRevision,
    usd: boolean, scope: RevisionScope, protocol: CacheProtocol) {
    const version = this.stamp(revision,usd,scope,protocol).version;
    return createHash('sha256').update(canonicalJson(protocol === 2 ? [version,route,input,protocol] : [version,route,input])).digest('hex');
  }
  private deadline(value: unknown, protocol: CacheProtocol): number {
    let deadline = this.now() + (protocol === 2 ? maxLifetime(protocol) : Math.min(this.ttlMs,maxLifetime(protocol)));
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
  private async lookup(key: string, protocol: CacheProtocol, flightKey: string): Promise<Envelope | null> {
    if (this.options.enabled === false) return null;
    const local = this.memory.get(key);
    if (local) {
      const envelope = this.parse(local.encoded,key,protocol);
      if (envelope) {
        this.memory.delete(key); this.memory.set(key, local); this.values.localHits++; return envelope;
      }
      this.remove(key);
    }
    if (!this.dependencies.store || this.flights.has(flightKey)) return null;
    const pending=this.redisReads.get(key);
    if(pending){const shared=await pending;return shared&&structuredClone(shared);}
    if(this.redisReads.size>=this.maxEntries)return null;
    // Same-version waiters share the bounded Redis read before joining origin work.
    const read=this.lookupRedis(key,protocol,this.dependencies.store);
    this.redisReads.set(key,read);
    try {return await read;}
    finally {this.redisReads.delete(key);}
  }
  private async lookupRedis(key:string,protocol:CacheProtocol,store:PublicCacheStore):Promise<Envelope|null> {
    try {
      const encoded = await store.get(this.slot(key));
      if (encoded === null || this.closed) return null;
      const envelope = this.parse(encoded,key,protocol);
      if (!envelope) { this.values.invalidEntries++; return null; }
      this.remember(key, encoded, envelope.expiresAt); this.values.redisHits++; return envelope;
    } catch { this.values.redisErrors++; return null; }
  }
  private async load<T>(route: PublicCacheRoute, input: string, key: string, revision: PublicCatalogRevision,
    load: (revision: PublicCatalogRevision, deadline: number, signal: AbortSignal) => Promise<PublicSnapshot<T>>,
    usd: boolean, scope: RevisionScope, protocol: CacheProtocol, deadline: number, signal:AbortSignal,
    refreshOffsetOnAdvance: boolean): Promise<LoadedEnvelope> {
    await this.acquireLoad(deadline,signal);
    try {
      const readSource = (observed: PublicCatalogRevision) => {
        if(signal.aborted)throw interrupted(signal);
        if(performance.now()>=deadline)throw unavailable('deadline');
        this.values.originLoads++;
        return load(observed,deadline,signal);
      };
      let snapshot = await readSource(revision);
      let current = await this.revision(usd,scope);
      let refreshedOffset = false;
      const verify = async (proof:CatalogRevisionProof) => {
        if(signal.aborted)throw interrupted(signal);
        if(performance.now()>=deadline)throw unavailable('deadline');
        try {return await proof(deadline,signal);}
        catch(error) {
          if(error&&typeof error==='object'&&(('code' in error&&error.code==='57014')||
            (error instanceof PublicCatalogUnavailableError&&error.sqlState==='57014'))) {
            throw new PublicCatalogUnavailableError('deadline',undefined,'57014');
          }
          throw error;
        }
      };
      if (refreshOffsetOnAdvance && !sameRevision(snapshot.revision,current) && !snapshotConflict(revision,snapshot.revision,current)) {
        // A fresh offset page needs no version-bound cursor. Reopen the read after
        // the observed advance, while retaining the same queue slot and deadline.
        this.values.versionRetries++;
        const beforeRefresh = current;
        snapshot = await readSource(beforeRefresh);
        current = await this.revision(usd,scope);
        const conflict = snapshotConflict(beforeRefresh,snapshot.revision,current);
        if (conflict) throw new PublicCatalogUnavailableError('revision-changed',['catalog-advanced',conflict]);
        if (!sameRevision(snapshot.revision,current)) {
          // A vehicle on this page may have changed during the second read.
          // Inspect only those selected rows instead of running another list.
          const verified=snapshot.verifyAfterAdvance?await verify(snapshot.verifyAfterAdvance):null;
          const lateConflict=verified?snapshotConflict(snapshot.revision,current,verified):'offset-page-changed';
          if (lateConflict) throw new PublicCatalogUnavailableError('revision-changed',['catalog-advanced',lateConflict]);
        }
        refreshedOffset = true;
      }
      if (route === 'detail' && snapshot.verifyAfterAdvance && !sameRevision(snapshot.revision,current)
        && !snapshotConflict(revision,snapshot.revision,current)) {
        // The target and the new catalog version are checked in one authoritative snapshot.
        const verified = await verify(snapshot.verifyAfterAdvance);
        if (verified) {
          const conflict = snapshotConflict(snapshot.revision,current,verified);
          if (conflict) {
            this.values.versionRetries++;
            throw new ChangedRevision(conflict);
          }
          snapshot = { ...snapshot, revision:verified };
          current = verified;
          this.values.detailRevalidations++;
        }
      }
      const matchesLookup = sameRevision(revision,snapshot.revision);
      const stillCurrent = sameRevision(snapshot.revision,current);
      if (!matchesLookup || !stillCurrent) {
        const conflict = snapshotConflict(revision,snapshot.revision,current);
        if (conflict || (!stillCurrent && scope !== 'filters' && !refreshedOffset)) {
          this.values.versionRetries++;
          throw new ChangedRevision(conflict ?? 'catalog-advanced');
        }
      }
      const value = JSON.parse(json(snapshot.value)) as T;
      const expiresAt = Math.min(this.deadline(value,protocol),snapshot.expiresAt ?? Infinity,snapshot.revision.fx?.expiresAt ?? Infinity);
      // A source read which outlives a media URL is not allowed to return an already expired picture.
      if (!(expiresAt > this.now())) throw unavailable('expired');
      if (!stillCurrent || refreshedOffset) {
        // The response is exact for its own read snapshot. It cannot populate either version's cache.
        if (refreshedOffset) this.values.uncachedListLoads++;
        else this.values.uncachedFilterLoads++;
        return { format:1,key,expiresAt,value,revision:snapshot.revision,snapshotOnly:true };
      }
      // A queued miss may only now have opened its transaction. Use the version it
      // actually read and post-validated, even if the original cache key is older.
      const sourceKey = matchesLookup ? key : this.resourceKey(route,input,snapshot.revision,usd,scope,protocol);
      const envelope = { format: 1 as const, key:sourceKey, expiresAt, value };
      const loaded = { ...envelope, revision:snapshot.revision };
      if (this.options.enabled === false) return loaded;
      const encoded = JSON.stringify(envelope);
      if (Buffer.byteLength(encoded) > this.maxValueBytes) { this.values.oversizedValues++; return loaded; }
      this.remember(sourceKey, encoded, expiresAt);
      if (this.dependencies.store) {
        const ttl = Math.floor(expiresAt - this.now());
        if (ttl > 0) try { await this.dependencies.store.set(this.slot(sourceKey), encoded, ttl); }
        catch { this.values.redisErrors++; }
      }
      if (expiresAt <= this.now()) throw unavailable('expired');
      return loaded;
    } finally { this.releaseLoad(); }
  }
  private async acquireLoad(deadline:number,signal:AbortSignal) {
    if(this.closed)throw unavailable('closed');
    if(signal.aborted)throw interrupted(signal);
    if(performance.now()>=deadline)throw unavailable('deadline');
    if(this.values.activeLoads<this.maxLoads){this.values.activeLoads++;return;}
    if(this.queue.length>=this.maxQueuedLoads){this.values.rejectedLoads++;throw unavailable('load-capacity');}
    let abort!:()=>void;
    try {await new Promise<void>((resolve,reject)=>{
      abort=()=>{
        const index=this.queue.indexOf(waiting);
        if(index>=0){clearTimeout(waiting.timer);this.queue.splice(index,1);this.values.queuedLoads--;reject(signal.aborted?interrupted(signal):unavailable('deadline'));}
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
  async getVersioned<T>(route: PublicCacheRoute, normalizedInput: unknown, load: () => Promise<T>, usd = false, signal?:AbortSignal,protocol:CacheProtocol=1): Promise<{value:T;stamp:PublicCatalogCacheStamp}> {
    return this.getBoundedVersioned(route,normalizedInput,async()=>({value:await load()}),usd,signal,protocol);
  }
  async getBoundedVersioned<T>(route: PublicCacheRoute, normalizedInput: unknown, load: (deadline:number,signal:AbortSignal) => Promise<PublicSourceResult<T>>,
    usd = false, signal?: AbortSignal, protocol:CacheProtocol=1, observe?: CacheReadObserver) {
    const result = await this.read(route,normalizedInput,async (revision,deadline,flightSignal)=>({...await load(deadline,flightSignal),revision}),usd,'catalog',protocol,signal,observe);
    return {value:result.value,stamp:this.stamp(result.revision,usd,'catalog',protocol,result.expiresAt)};
  }
  async getCatalogSnapshot<T>(route: Exclude<PublicCacheRoute,'filters'>, normalizedInput: unknown,
    load: () => Promise<PublicSnapshot<T>>, usd = false, signal?: AbortSignal, protocol:CacheProtocol=1, observe?:CacheReadObserver) {
    const result = await this.read(route,normalizedInput,load,usd,'catalog',protocol,signal,observe);
    return {value:result.value,stamp:this.stamp(result.revision,usd,'catalog',protocol,result.expiresAt)};
  }
  async getOffsetListSnapshot<T>(normalizedInput: unknown, load: () => Promise<PublicSnapshot<T>>, usd = false,
    signal?: AbortSignal, protocol: CacheProtocol=1, observe?: CacheReadObserver) {
    const result = await this.read('list',normalizedInput,load,usd,'catalog',protocol,signal,observe,true);
    const stamp=this.stamp(result.revision,usd,'catalog',protocol,result.expiresAt);
    return {value:result.value,stamp:result.snapshotOnly?undefined:stamp,offsetSnapshot:result.snapshotOnly?stamp:undefined};
  }
  async getFilterSnapshot<T>(normalizedInput: unknown, load: (deadline:number,signal:AbortSignal) => Promise<PublicSnapshot<T>>, usd = false, signal?: AbortSignal,
    protocol:CacheProtocol=1, observe?: CacheReadObserver) {
    const result = await this.read('filters',normalizedInput,(_,deadline,flightSignal)=>load(deadline,flightSignal),usd,'filters',protocol,signal,observe);
    if (result.snapshotOnly && result.expiresAt <= this.now()) throw unavailable('expired');
    return { value: result.value, stamp: result.snapshotOnly ? undefined : this.stamp(result.revision,usd,'filters',protocol,result.expiresAt) };
  }
  private async read<T>(route: PublicCacheRoute, normalizedInput: unknown, load: (revision: PublicCatalogRevision, deadline: number, signal: AbortSignal) => Promise<PublicSnapshot<T>>,
    usd: boolean, scope: RevisionScope, protocol: CacheProtocol, signal?: AbortSignal, observe?: CacheReadObserver, offsetList = false) {
    const deadline=performance.now()+this.timeoutMs;
    if (this.closed) throw unavailable('closed');
    if (!['list', 'filters', 'detail', 'home'].includes(route)) throw unavailable('invalid-input');
    const input = canonicalJson(normalizedInput);
    if (Buffer.byteLength(input) > 16_384) throw unavailable('invalid-input');
    const work = async (requestSignal:AbortSignal) => {
      const conflicts:RevisionConflict[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        observe?.('cache_revision');
        const revision = await this.revision(usd,scope);
        if(requestSignal.aborted)throw interrupted(requestSignal);
        const key = this.resourceKey(route,input,revision,usd,scope,protocol);
        const refreshOffset = offsetList && attempt === 0;
        // Older SSR readers require a validated stamp and cannot join a fallback flight.
        const flightKey = refreshOffset ? `${key}:offset` : key;
        observe?.('cache_lookup');
        const cached = await this.lookup(key,protocol,flightKey);
        if(requestSignal.aborted)throw interrupted(requestSignal);
        if (cached) return { value: cached.value as T, revision, expiresAt: cached.expiresAt, snapshotOnly: false };
        this.values.misses++;
        let flight = this.flights.get(flightKey);
        observe?.(flight ? 'origin_shared' : 'origin_queue');
        if (!flight) {
          const controller=new AbortController();
          flight={promise:this.load(route,input,key,revision,load,usd,scope,protocol,deadline,controller.signal,refreshOffset),controller,waiters:0};
          this.flights.set(flightKey, flight);
          const own=flight;
          void own.promise.finally(() => { if (this.flights.get(flightKey) === own) this.flights.delete(flightKey); }).catch(() => {});
        }
        flight.waiters++;
        try {
          const envelope = await waitFor(flight.promise,requestSignal);
          return { value: JSON.parse(json(envelope.value)) as T, revision:envelope.revision, expiresAt:envelope.expiresAt, snapshotOnly:!!envelope.snapshotOnly };
        }
        catch (error) {
          if (!(error instanceof ChangedRevision)) throw error;
          conflicts.push(error.conflict);
        }
        finally {if(--flight.waiters===0)flight.controller.abort();}
      }
      throw new PublicCatalogUnavailableError('revision-changed',conflicts);
    };
    return this.withDeadline(work,signal);
  }
  private async withDeadline<T>(work: (signal:AbortSignal) => Promise<T>, external?:AbortSignal): Promise<T> {
    const controller=new AbortController(),abort=()=>controller.abort();
    if(external?.aborted)throw unavailable('cancelled');
    external?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{this.values.timeouts++;controller.abort(unavailable('deadline'));},this.timeoutMs);
    // The underlying load keeps its concurrency slot until it really settles, even after a caller times out.
    try { return await waitFor(work(controller.signal),controller.signal); }
    finally { clearTimeout(timer);external?.removeEventListener('abort',abort); }
  }
  async close() {
    this.closed = true;
    for(const waiting of this.queue.splice(0)){clearTimeout(waiting.timer);waiting.reject(unavailable('closed'));}
    this.values.queuedLoads=0;this.memory.clear();this.values.bytes=0;await this.dependencies.store?.close();
  }
}
export async function createPublicCatalogCache(db: DatabaseReader, options: PublicCatalogCacheOptions): Promise<PublicCatalogCache> {
  const store = options.redis ? await createRedisPublicCacheStore(options.redis, options.maxValueBytes ?? 1_048_576) : undefined;
  return new PublicCatalogCache(options, { readRevision: (usd,scope) => readPublicCatalogRevision(db, usd,scope),
    readHomepageRevisions:()=>readHomepageRevisions(db), store });
}
