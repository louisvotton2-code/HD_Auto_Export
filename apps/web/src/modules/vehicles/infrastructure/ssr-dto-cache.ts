import { Buffer } from 'node:buffer';

const MAX_ENTRIES = 64;
const MAX_BYTES = 16 * 1024 * 1024;

export class SsrDtoCacheBusyError extends Error {
  constructor() { super('Anonymous data cache is busy'); }
}

export class SsrDtoCacheExpiredError extends Error {
  constructor() { super('Anonymous data snapshot expired'); }
}

export class SsrDtoCacheValueError extends Error {
  constructor() { super('Anonymous data is not a valid JSON snapshot'); }
}

type Snapshot = { body: Buffer; expiresAt: number };
type StoredSnapshot = Snapshot & { bytes: number };
type PendingSnapshot = { promise: Promise<Snapshot> };

type CacheOptions = {
  now?: () => number;
  maxEntries?: number;
  maxBytes?: number;
};

function encode(value: unknown): Buffer {
  try {
    // Only plain JSON is supported: silently dropping values or calling a custom
    // toJSON could change a DTO between its first read and subsequent reads.
    const json = JSON.stringify(value, function (key, item: unknown) {
      const original: unknown = (this as Record<string, unknown>)[key];
      if (original !== null && typeof original === 'object') {
        const prototype: unknown = Object.getPrototypeOf(original);
        if ((!Array.isArray(original) && prototype !== Object.prototype && prototype !== null)
          || typeof (original as { toJSON?: unknown }).toJSON === 'function') throw new Error();
      }
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol'
        || typeof item === 'bigint' || typeof item === 'number' && !Number.isFinite(item)) throw new Error();
      return item;
    });
    if (json === undefined) throw new Error();
    return Buffer.from(json, 'utf8');
  } catch { throw new SsrDtoCacheValueError(); }
}

/** Process-local storage for caller-validated anonymous DTOs. Deadlines are
 * absolute values from the caller's monotonic clock, never wall-clock dates. */
export class SsrDtoCache {
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ready = new Map<string, StoredSnapshot>();
  private readonly inFlight = new Map<string, PendingSnapshot>();
  private bytes = 0;
  private generation = 0;

  constructor({ now = () => performance.now(), maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES }: CacheOptions = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) {
      throw new RangeError('Anonymous data cache limits exceed the supported bounds');
    }
    this.now = now;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  /** Counts are detached; callers never receive the buffers or stored values. */
  get stats(): Readonly<{ entries: number; bytes: number; inFlight: number }> {
    this.prune(this.time());
    return { entries: this.ready.size, bytes: this.bytes, inFlight: this.inFlight.size };
  }

  clear(): void {
    this.generation += 1;
    this.ready.clear();
    this.inFlight.clear();
    this.bytes = 0;
  }

  async read<T>(key: string, load: () => Promise<{ value: T; expiresAt: number }>): Promise<T> {
    const now = this.time();
    this.prune(now);
    const hit = this.ready.get(key);
    if (hit) {
      const value = this.decode<T>(hit);
      this.ready.delete(key);
      this.ready.set(key, hit);
      return value;
    }

    const existing = this.inFlight.get(key);
    if (existing) return this.decode<T>(await existing.promise);
    if (this.inFlight.size >= this.maxEntries) throw new SsrDtoCacheBusyError();
    const keyBytes = Buffer.byteLength(key, 'utf8');
    if (keyBytes > this.maxBytes) throw new SsrDtoCacheValueError();

    const generation = this.generation;
    // Start loading in a microtask, after its identity is installed in the map.
    // That also turns synchronous loader failures into the shared rejection.
    let pending: PendingSnapshot;
    const promise = Promise.resolve().then(load).then(({ value, expiresAt }) => {
      if (!Number.isFinite(expiresAt)) throw new SsrDtoCacheValueError();
      if (expiresAt <= this.time()) throw new SsrDtoCacheExpiredError();
      const snapshot = { body: encode(value), expiresAt };
      const finished = this.time();
      if (expiresAt <= finished) throw new SsrDtoCacheExpiredError();
      const bytes = keyBytes + snapshot.body.byteLength;
      if (generation === this.generation && this.inFlight.get(key) === pending && bytes <= this.maxBytes) {
        this.prune(finished);
        while (this.ready.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
          this.remove(this.ready.keys().next().value!);
        }
        this.ready.set(key, { ...snapshot, bytes });
        this.bytes += bytes;
      }
      return snapshot;
    });
    pending = { promise };
    this.inFlight.set(key, pending);
    try { return this.decode<T>(await promise); }
    finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  private time(): number {
    const value = this.now();
    if (!Number.isFinite(value)) throw new SsrDtoCacheValueError();
    return value;
  }

  private decode<T>(snapshot: Snapshot): T {
    const value = JSON.parse(snapshot.body.toString('utf8')) as T;
    if (snapshot.expiresAt <= this.time()) {
      // No previously valid value may escape merely because parsing crossed its deadline.
      this.prune(this.time());
      throw new SsrDtoCacheExpiredError();
    }
    return value;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.ready) if (entry.expiresAt <= now) this.remove(key);
  }

  private remove(key: string): void {
    const entry = this.ready.get(key);
    if (!entry) return;
    this.ready.delete(key);
    this.bytes -= entry.bytes;
  }
}
