import { createHash } from 'node:crypto';
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
};
export type PublicCacheMetrics = {
  localHits: number; redisHits: number; misses: number; originLoads: number; rejectedLoads: number;
  redisErrors: number; invalidEntries: number; oversizedValues: number; versionRetries: number; timeouts: number;
  activeLoads: number; activeRevisionReads: number; entries: number; bytes: number;
};
type Envelope = { format: 1; key: string; expiresAt: number; value: unknown };
type MemoryEntry = { encoded: string; expiresAt: number; bytes: number };
type Dependencies = { readRevision: (usd: boolean) => Promise<PublicCatalogRevision>; store?: PublicCacheStore; now?: () => number };
const sameRevision = (a: PublicCatalogRevision, b: PublicCatalogRevision) => a.epoch === b.epoch && a.revision === b.revision &&
  a.fx?.version === b.fx?.version && a.fx?.expiresAt === b.fx?.expiresAt;
const bounded = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
const json = (value: unknown) => JSON.stringify(value, (key, item) => key === 'requestId' ? undefined : item);

/** No request IDs or shared mutable DTOs cross request boundaries. Public routes alone may use this cache. */
export class PublicCatalogCache {
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly flights = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxLoads: number;
  private readonly maxRevisionReads: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxValueBytes: number;
  private readonly timeoutMs: number;
  private closed = false;
  private values: PublicCacheMetrics = { localHits: 0, redisHits: 0, misses: 0, originLoads: 0, rejectedLoads: 0,
    redisErrors: 0, invalidEntries: 0, oversizedValues: 0, versionRetries: 0, timeouts: 0,
    activeLoads: 0, activeRevisionReads: 0, entries: 0, bytes: 0 };

  constructor(private readonly options: PublicCatalogCacheOptions, private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 15_000;
    this.maxLoads = options.maxConcurrentLoads ?? 4;
    this.maxRevisionReads = options.maxConcurrentRevisionReads ?? 32;
    this.maxEntries = options.maxEntries ?? 64;
    this.maxBytes = options.maxBytes ?? 16 * 1_048_576;
    this.maxValueBytes = options.maxValueBytes ?? 1_048_576;
    this.timeoutMs = options.requestTimeoutMs ?? 3000;
    if (!/^(?:hd:[A-Za-z0-9:_-]{1,80}|hd-ext-scale-[a-z0-9-]{1,48})$/.test(options.namespace) || !bounded(this.ttlMs, 1, 30_000) || !bounded(this.maxLoads, 1, 20) ||
        !bounded(this.maxEntries, 1, 64) || !bounded(this.maxBytes, 1, 16 * 1_048_576) || !bounded(this.maxValueBytes, 256, 1_048_576) ||
        !bounded(this.timeoutMs, 10, 15_000) || !bounded(this.maxRevisionReads, 1, 128)) throw new Error('Invalid public cache configuration.');
  }

  metrics(): PublicCacheMetrics { return { ...this.values, entries: this.memory.size }; }
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
      for (const child of Object.values(object)) stack.push(child);
    }
    return deadline;
  }
  private async lookup(key: string): Promise<Envelope | null> {
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
  private async load<T>(key: string, revision: PublicCatalogRevision, load: () => Promise<T>, usd: boolean): Promise<T> {
    if (this.closed || this.values.activeLoads >= this.maxLoads) { this.values.rejectedLoads++; throw unavailable(); }
    this.values.activeLoads++; this.values.originLoads++;
    try {
      const value = JSON.parse(json(await load())) as T;
      if (!sameRevision(revision, await this.revision(usd))) { this.values.versionRetries++; throw changedRevision; }
      const expiresAt = Math.min(this.deadline(value), revision.fx?.expiresAt ?? Infinity);
      // A source read which outlives a media URL is not allowed to return an already expired picture.
      if (expiresAt <= this.now()) throw unavailable();
      const encoded = JSON.stringify({ format: 1, key, expiresAt, value } satisfies Envelope);
      if (Buffer.byteLength(encoded) > this.maxValueBytes) { this.values.oversizedValues++; return value; }
      this.remember(key, encoded, expiresAt);
      if (this.dependencies.store) {
        const ttl = Math.floor(expiresAt - this.now());
        if (ttl > 0) try { await this.dependencies.store.set(this.slot(key), encoded, ttl); }
        catch { this.values.redisErrors++; }
      }
      if (expiresAt <= this.now()) throw unavailable();
      return value;
    } finally { this.values.activeLoads--; }
  }
  async get<T>(route: PublicCacheRoute, normalizedInput: unknown, load: () => Promise<T>, usd = false): Promise<T> {
    if (!['list', 'filters', 'detail', 'home'].includes(route) || this.closed) throw unavailable();
    const input = canonicalJson(normalizedInput);
    if (Buffer.byteLength(input) > 16_384) throw unavailable();
    const work = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const revision = await this.revision(usd);
        const keyParts = [1, revision.epoch, revision.revision, route, input];
        if (usd) keyParts.push(revision.fx?.version ?? 'unavailable');
        const key = createHash('sha256').update(canonicalJson(keyParts)).digest('hex');
        const cached = await this.lookup(key);
        if (cached) return cached.value as T;
        this.values.misses++;
        let promise = this.flights.get(key);
        if (!promise) {
          promise = this.load(key, revision, load, usd);
          this.flights.set(key, promise);
          void promise.finally(() => { if (this.flights.get(key) === promise) this.flights.delete(key); }).catch(() => {});
        }
        try { return JSON.parse(json(await promise)) as T; }
        catch (error) { if (error !== changedRevision) throw error; }
      }
      throw unavailable();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The underlying load keeps its concurrency slot until it really settles, even after a caller times out.
    try { return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { this.values.timeouts++; reject(unavailable()); }, this.timeoutMs);
    })]); }
    finally { clearTimeout(timer); }
  }
  async close() { this.closed = true; this.memory.clear(); this.values.bytes = 0; await this.dependencies.store?.close(); }
}
const changedRevision = Symbol('public catalog changed during load');

export async function createPublicCatalogCache(db: DatabaseReader, options: PublicCatalogCacheOptions): Promise<PublicCatalogCache> {
  const store = options.redis ? await createRedisPublicCacheStore(options.redis, options.maxValueBytes ?? 1_048_576) : undefined;
  return new PublicCatalogCache(options, { readRevision: usd => readPublicCatalogRevision(db, usd), store });
}
