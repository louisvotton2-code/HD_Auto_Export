import { describe, expect, it, vi } from 'vitest';
import {
  SsrDtoCache,
  SsrDtoCacheBusyError,
  SsrDtoCacheExpiredError,
  SsrDtoCacheValueError,
} from './ssr-dto-cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('bounded anonymous SSR DTO cache', () => {
  it('reuses a fresh snapshot without extending its original deadline', async () => {
    let now = 0;
    const cache = new SsrDtoCache({ now: () => now });
    const load = vi.fn(async () => ({ value: { revision: 1 }, expiresAt: 15_000 }));
    expect(await cache.read('cars', load)).toEqual({ revision: 1 });
    now = 14_999;
    expect(await cache.read('cars', load)).toEqual({ revision: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    now = 15_000;
    expect(await cache.read('cars', async () => ({ value: { revision: 2 }, expiresAt: 30_000 })))
      .toEqual({ revision: 2 });
  });

  it('uses the default 64-entry LRU bound and keeps recently read values', async () => {
    const cache = new SsrDtoCache({ now: () => 0 });
    for (let i = 0; i < 64; i++) await cache.read(`car-${i}`, async () => ({ value: i, expiresAt: 1000 }));
    const unexpected = vi.fn(async () => { throw new Error('A retained snapshot was lost'); });
    expect(await cache.read('car-0', unexpected)).toBe(0);
    await cache.read('car-64', async () => ({ value: 64, expiresAt: 1000 }));
    expect(cache.stats.entries).toBe(64);
    expect(await cache.read('car-0', unexpected)).toBe(0);
    expect(await cache.read('car-1', async () => ({ value: 'reloaded', expiresAt: 1000 }))).toBe('reloaded');
    expect(unexpected).not.toHaveBeenCalled();
  });

  it('bounds default ready storage to 16 MiB including keys and evicts by bytes', async () => {
    const cache = new SsrDtoCache({ now: () => 0 });
    // A one-byte key plus this JSON string occupies exactly 8 MiB.
    const value = 'x'.repeat(8 * 1024 * 1024 - 3);
    const load = async () => ({ value, expiresAt: 1000 });
    await cache.read('a', load);
    await cache.read('b', load);
    expect(cache.stats.bytes).toBe(16 * 1024 * 1024);
    await cache.read('c', async () => ({ value: 'small', expiresAt: 1000 }));
    expect(cache.stats.entries).toBe(2);
    expect(cache.stats.bytes).toBeLessThan(16 * 1024 * 1024);
    expect(await cache.read('b', async () => { throw new Error('Newest large entry should remain'); })).toHaveLength(value.length);
    expect(await cache.read('a', async () => ({ value: 'reloaded', expiresAt: 1000 }))).toBe('reloaded');
  });

  it('charges UTF-8 bytes of both key and payload at the exact byte boundary', async () => {
    const load = vi.fn(async () => ({ value: '车', expiresAt: 100 }));
    const tooSmall = new SsrDtoCache({ now: () => 0, maxBytes: 7 });
    expect(await tooSmall.read('国', load)).toBe('车');
    expect(await tooSmall.read('国', load)).toBe('车');
    expect(load).toHaveBeenCalledTimes(2);
    expect(tooSmall.stats.entries).toBe(0);
    const exact = new SsrDtoCache({ now: () => 0, maxBytes: 8 });
    await exact.read('国', load);
    await exact.read('国', load);
    expect(load).toHaveBeenCalledTimes(3);
    expect(exact.stats.bytes).toBe(8);
  });

  it('returns detached copies even for values too large to retain', async () => {
    const cache = new SsrDtoCache({ now: () => 0, maxBytes: 16 });
    const source = { items: [{ name: 'larger than the configured budget' }] };
    const load = vi.fn(async () => ({ value: source, expiresAt: 100 }));
    const first = await cache.read('large', load);
    first.items[0]!.name = 'changed';
    expect(source.items[0]!.name).toBe('larger than the configured budget');
    expect((await cache.read('large', load)).items[0]!.name).toBe('larger than the configured budget');
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.stats).toEqual({ entries: 0, bytes: 0, inFlight: 0 });
  });

  it('coalesces concurrent loads without sharing mutable returned objects', async () => {
    const cache = new SsrDtoCache({ now: () => 0 });
    const result = deferred<{ value: { items: { name: string }[] }; expiresAt: number }>();
    const load = vi.fn(() => result.promise);
    const first = cache.read('same', load);
    const second = cache.read('same', load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats.inFlight).toBe(1);
    result.resolve({ value: { items: [{ name: 'original' }] }, expiresAt: 100 });
    const [a, b] = await Promise.all([first, second]);
    a.items[0]!.name = 'changed';
    expect(b.items[0]!.name).toBe('original');
    expect((await cache.read('same', load)).items[0]!.name).toBe('original');
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats.inFlight).toBe(0);
  });

  it('shares a failed load, clears it, and allows the next request to try again', async () => {
    const cache = new SsrDtoCache({ now: () => 0 });
    const result = deferred<{ value: string; expiresAt: number }>();
    const failure = new Error('upstream failed');
    const load = vi.fn(() => result.promise);
    const requests = Promise.allSettled([cache.read('same', load), cache.read('same', load)]);
    result.reject(failure);
    const outcomes = await requests;
    expect(outcomes).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats).toEqual({ entries: 0, bytes: 0, inFlight: 0 });
    expect(await cache.read('same', async () => ({ value: 'recovered', expiresAt: 100 }))).toBe('recovered');
  });

  it('also clears a loader that throws before returning a promise', async () => {
    const cache = new SsrDtoCache({ now: () => 0 });
    const load = vi.fn(() => { throw new Error('synchronous failure'); });
    const outcomes = await Promise.allSettled([cache.read('same', load), cache.read('same', load)]);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.stats.inFlight).toBe(0);
  });

  it('rejects a late expired load, including expiry exactly at the boundary', async () => {
    let now = 0;
    const cache = new SsrDtoCache({ now: () => now });
    const result = deferred<{ value: string; expiresAt: number }>();
    const request = cache.read('expired', () => result.promise);
    now = 10;
    result.resolve({ value: 'old', expiresAt: 10 });
    await expect(request).rejects.toBeInstanceOf(SsrDtoCacheExpiredError);
    expect(cache.stats).toEqual({ entries: 0, bytes: 0, inFlight: 0 });
    expect(await cache.read('expired', async () => ({ value: 'fresh', expiresAt: 20 }))).toBe('fresh');
    await expect(cache.read('zero', async () => ({ value: 'invalid', expiresAt: 0 }))).rejects.toBeInstanceOf(SsrDtoCacheExpiredError);
  });

  it('does not return a cached value when decoding crosses its deadline', async () => {
    let phase = 0;
    let reads = 0;
    const cache = new SsrDtoCache({ now: () => phase === 0 ? 0 : reads++ === 0 ? 9 : 10 });
    await cache.read('deadline', async () => ({ value: { text: 'snapshot' }, expiresAt: 10 }));
    phase = 1;
    await expect(cache.read('deadline', async () => { throw new Error('Must not reload implicitly'); }))
      .rejects.toBeInstanceOf(SsrDtoCacheExpiredError);
    expect(cache.stats.entries).toBe(0);
  });

  it('prevents a pre-clear task from writing back or deleting a newer same-key task', async () => {
    const cache = new SsrDtoCache({ now: () => 0 });
    const old = deferred<{ value: { revision: number }; expiresAt: number }>();
    const fresh = deferred<{ value: { revision: number }; expiresAt: number }>();
    const oldRequest = cache.read('same', () => old.promise);
    cache.clear();
    const newLoad = vi.fn(() => fresh.promise);
    const newRequest = cache.read('same', newLoad);
    old.resolve({ value: { revision: 1 }, expiresAt: 100 });
    expect(await oldRequest).toEqual({ revision: 1 });
    expect(cache.stats).toEqual({ entries: 0, bytes: 0, inFlight: 1 });
    const joined = cache.read('same', newLoad);
    fresh.resolve({ value: { revision: 2 }, expiresAt: 100 });
    expect(await Promise.all([newRequest, joined])).toEqual([{ revision: 2 }, { revision: 2 }]);
    expect(newLoad).toHaveBeenCalledTimes(1);
    expect(await cache.read('same', newLoad)).toEqual({ revision: 2 });
  });

  it('limits in-flight keys and reopens capacity after one finishes', async () => {
    const cache = new SsrDtoCache({ now: () => 0, maxEntries: 2 });
    const a = deferred<{ value: string; expiresAt: number }>();
    const b = deferred<{ value: string; expiresAt: number }>();
    const first = cache.read('a', () => a.promise);
    const second = cache.read('b', () => b.promise);
    const rejectedLoad = vi.fn(async () => ({ value: 'c', expiresAt: 100 }));
    await expect(cache.read('c', rejectedLoad)).rejects.toBeInstanceOf(SsrDtoCacheBusyError);
    expect(rejectedLoad).not.toHaveBeenCalled();
    expect(cache.stats.inFlight).toBe(2);
    a.resolve({ value: 'a', expiresAt: 100 });
    expect(await first).toBe('a');
    expect(await cache.read('c', rejectedLoad)).toBe('c');
    b.resolve({ value: 'b', expiresAt: 100 });
    await second;
    expect(cache.stats.entries).toBe(2);
  });

  it('rejects non-JSON values without retaining their errors or silently changing them', async () => {
    const cache = new SsrDtoCache({ now: () => 0 });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const values = [undefined, { missing: undefined }, { count: Number.NaN }, { count: 1n }, cyclic, () => 'function'];
    for (const [index, value] of values.entries()) {
      const load = vi.fn(async () => ({ value, expiresAt: 100 }));
      await expect(cache.read(`bad-${index}`, load)).rejects.toBeInstanceOf(SsrDtoCacheValueError);
      await expect(cache.read(`bad-${index}`, load)).rejects.toBeInstanceOf(SsrDtoCacheValueError);
      expect(load).toHaveBeenCalledTimes(2);
      expect(cache.stats).toEqual({ entries: 0, bytes: 0, inFlight: 0 });
    }
  });

  it('rejects invalid resource limits, oversized keys and invalid clock/deadline values', async () => {
    for (const options of [{ maxEntries: 65 }, { maxEntries: 0 }, { maxBytes: 16 * 1024 * 1024 + 1 }]) {
      expect(() => new SsrDtoCache(options)).toThrow(RangeError);
    }
    const cache = new SsrDtoCache({ now: () => 0, maxBytes: 2 });
    const load = vi.fn(async () => ({ value: 1, expiresAt: 100 }));
    await expect(cache.read('long key', load)).rejects.toBeInstanceOf(SsrDtoCacheValueError);
    expect(load).not.toHaveBeenCalled();
    await expect(cache.read('x', async () => ({ value: 1, expiresAt: Infinity }))).rejects.toBeInstanceOf(SsrDtoCacheValueError);
    const badClock = new SsrDtoCache({ now: () => Number.NaN });
    await expect(badClock.read('x', load)).rejects.toBeInstanceOf(SsrDtoCacheValueError);
  });
});
