import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PublicCatalogCacheStampSchema, PublicHomeSectionsSchema, PublicVehicleResponseSchema,
  type PublicCatalogCacheStamp, type PublicHomeSections,
} from '@hd/contracts/public';
import { makeImportedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicApiError } from './public-http';
import { SsrDtoCache } from './ssr-dto-cache';
import { anonymousPublicEnvelope, canonicalPublicPath, createSsrPublicReader, type SsrPublicDescriptor, type SsrPublicEnvelope, type SsrAnonymousReader } from './ssr-public-reader';

const checked = Date.parse('2030-01-01T00:00:00Z');
function stamp(version = 'a'.repeat(64), remaining = 15_000, fx: PublicCatalogCacheStamp['fx'] = null) {
  return PublicCatalogCacheStampSchema.parse({ version, priceView: 'usd', fx,
    checkedAt: new Date(checked).toISOString(), validUntil: new Date(checked + remaining).toISOString() });
}
const descriptor: SsrPublicDescriptor<PublicHomeSections> = {
  path: canonicalPublicPath('/api/v1/home/vehicles', { locale: 'en', view: 'localized', priceView: 'usd' }),
  priceView: 'usd', schema: PublicHomeSectionsSchema,
};
const identity = { deploymentEnv: 'test', releaseId: 'reader-fixture', apiOrigin: 'http://api.example.invalid' };
class InspectableCache extends SsrDtoCache {
  readonly loaded: string[] = [];
  override read<T>(key: string, load: () => Promise<{ value: T; expiresAt: number }>): Promise<T> {
    return super.read(key, async () => {
      const result = await load();
      this.loaded.push(JSON.stringify({ key, value: result.value }));
      return result;
    });
  }
}
function setup() {
  let time = 100;
  let current = stamp();
  let versionReads = 0;
  const now = () => time;
  const cache = new InspectableCache({ now });
  const readVersion = vi.fn(async () => ({ data: current, meta: { requestId: `current-${++versionReads}` } }));
  const readAnonymous = vi.fn(async <T extends SsrPublicEnvelope>(request: SsrPublicDescriptor<T>) =>
    anonymousPublicEnvelope(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'UPSTREAM_TRACE_SENTINEL', catalogCache: current } })));
  // Restore the handler's declared generic relation erased by Vitest's Mock call signature.
  const anonymousReader = readAnonymous as SsrAnonymousReader;
  const read = createSsrPublicReader({ identity, cache, now, readVersion, readAnonymous: anonymousReader });
  return { read, cache, now, readVersion, readAnonymous, anonymousReader,
    setTime: (value: number) => { time = value; }, setStamp: (value: PublicCatalogCacheStamp) => { current = value; } };
}
afterEach(() => vi.restoreAllMocks());

describe('SSR-only versioned anonymous data reader', () => {
  it('checks current version on warm hits while returning a new trace and isolated DTO each time', async () => {
    const state = setup();
    const first = await state.read(descriptor);
    first.meta.catalogCache!.version = 'f'.repeat(64);
    const second = await state.read(descriptor);
    expect(state.readVersion).toHaveBeenCalledTimes(2);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    expect([first.meta.requestId, second.meta.requestId]).toEqual(['current-1', 'current-2']);
    expect(second.meta.catalogCache!.version).toBe('a'.repeat(64));
    expect(state.cache.loaded).toHaveLength(1);
    expect(state.cache.loaded[0]).not.toMatch(/requestId|UPSTREAM_TRACE_SENTINEL|current-1/);
  });

  it('coalesces matching DTO loads without coalescing visitor version checks or traces', async () => {
    const state = setup();
    const original = state.readAnonymous.getMockImplementation()!;
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    state.readAnonymous.mockImplementation(async request => { await wait; return original(request); });
    const requests = [state.read(descriptor), state.read(descriptor)];
    await vi.waitFor(() => expect(state.readVersion).toHaveBeenCalledTimes(2));
    release();
    const responses = await Promise.all(requests);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    expect(new Set(responses.map(value => value.meta.requestId)).size).toBe(2);
  });

  it('isolates environment, release, origin, route and effective query namespaces', async () => {
    const state = setup();
    await state.read(descriptor);
    for (const changed of [{ ...identity, deploymentEnv: 'local' }, { ...identity, releaseId: 'another' }, { ...identity, apiOrigin: 'http://other.example.invalid' }]) {
      await createSsrPublicReader({ identity: changed, cache: state.cache, now: state.now, readVersion: state.readVersion, readAnonymous: state.anonymousReader })(descriptor);
    }
    await state.read({ ...descriptor, path: descriptor.path.replace('locale=en', 'locale=ru') });
    await state.read({ ...descriptor, path: descriptor.path + '&page=2' });
    expect(state.readAnonymous).toHaveBeenCalledTimes(6);
    expect(canonicalPublicPath('/api/v1/vehicles', { page: 2, locale: 'ru', make: 'byd' }))
      .toBe(canonicalPublicPath('/api/v1/vehicles', { make: 'byd', locale: 'ru', page: 2 }));
  });

  it('does not reuse an old public version or a different FX identity', async () => {
    const state = setup();
    await state.read(descriptor);
    state.setStamp(stamp('b'.repeat(64)));
    await state.read(descriptor);
    const fx = { version: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(checked + 10_000).toISOString() };
    state.setStamp(stamp('b'.repeat(64), 8000, fx));
    await state.read(descriptor);
    state.setStamp(stamp('b'.repeat(64), 8000, { ...fx, version: '00000000-0000-4000-8000-000000000002' }));
    await state.read(descriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(4);
  });

  it('discards a mismatched DTO and retries once using a newly checked version', async () => {
    const state = setup();
    const newer = stamp('b'.repeat(64));
    state.readAnonymous.mockImplementation(async request => {
      state.setStamp(newer);
      return anonymousPublicEnvelope(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored', catalogCache: newer } }));
    });
    const result = await state.read(descriptor);
    expect(result.meta.catalogCache!.version).toBe(newer.version);
    expect(state.readVersion).toHaveBeenCalledTimes(2);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.cache.stats.entries).toBe(1);
  });

  it('fails closed after the second mismatch and never writes the wrong key', async () => {
    const state = setup();
    state.readAnonymous.mockImplementation(async request => anonymousPublicEnvelope(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored', catalogCache: stamp('b'.repeat(64)) } })));
    await expect(state.read(descriptor)).rejects.toMatchObject({ status: 503 });
    expect(state.readVersion).toHaveBeenCalledTimes(2);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.cache.stats.entries).toBe(0);
  });

  it.each([503, 429])('does not fall back to a warm value when the current version check returns %s', async status => {
    const state = setup();
    await state.read(descriptor);
    state.readVersion.mockRejectedValue(new PublicApiError(status, status === 429 ? '2' : undefined));
    await expect(state.read(descriptor)).rejects.toMatchObject({ status, retryAfter: status === 429 ? '2' : undefined });
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
  });

  it('retains a rate-limit result shared across independently bundled error constructors', async () => {
    const state = setup();
    const foreign = new PublicApiError(429, '1');
    Object.setPrototypeOf(foreign, Error.prototype);
    expect(foreign).not.toBeInstanceOf(PublicApiError);
    state.readAnonymous.mockRejectedValue(foreign);
    await expect(state.read(descriptor)).rejects.toMatchObject({ status: 429, retryAfter: '1' });
    expect(state.cache.stats.entries).toBe(0);
  });

  it('does not store a missing stamp or a failed resource', async () => {
    const state = setup();
    state.readAnonymous.mockRejectedValueOnce(new PublicApiError(404));
    await expect(state.read(descriptor)).rejects.toMatchObject({ status: 404 });
    state.readAnonymous.mockImplementation(async request => anonymousPublicEnvelope(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored' } })));
    await expect(state.read(descriptor)).rejects.toMatchObject({ status: 503 });
    expect(state.cache.stats.entries).toBe(0);
  });

  it('keeps the original remaining lifetime instead of renewing a fourteen-second-old upstream value', async () => {
    const state = setup();
    const original = state.readAnonymous.getMockImplementation()!;
    let loads = 0;
    state.readAnonymous.mockImplementation(async request => {
      loads++;
      state.setStamp(stamp('a'.repeat(64), loads === 1 ? 1000 : 15_000));
      state.setTime(state.now() + 200);
      const result = await original(request);
      state.setStamp(stamp());
      return result;
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('1990-01-01T00:00:00Z'));
    await state.read(descriptor);
    state.setTime(1099);
    await state.read(descriptor);
    expect(loads).toBe(1);
    state.setTime(1100);
    await state.read(descriptor);
    expect(loads).toBe(2);
  });

  it('rejects a version or resource whose network time consumes its remaining budget', async () => {
    const version = setup();
    version.readVersion.mockImplementation(async () => {
      version.setTime(2100);
      return { data: stamp('a'.repeat(64), 1000), meta: { requestId: 'current' } };
    });
    await expect(version.read(descriptor)).rejects.toMatchObject({ status: 503 });
    expect(version.readAnonymous).not.toHaveBeenCalled();
    const resource = setup();
    resource.readAnonymous.mockImplementation(async request => {
      resource.setTime(2100);
      return anonymousPublicEnvelope(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored', catalogCache: stamp('a'.repeat(64), 1000) } }));
    });
    await expect(resource.read(descriptor)).rejects.toMatchObject({ status: 503 });
    expect(resource.cache.stats.entries).toBe(0);
  });

  it('also clips reuse to an earlier media expiry rather than trusting a longer upstream budget', async () => {
    const state = setup();
    const vehicle = makeImportedPublicVehicleFixture('en', 'supplier', true);
    vehicle.images[0]!.remote!.expiresAt = new Date(checked + 500).toISOString();
    const mediaDescriptor: SsrPublicDescriptor<ReturnType<typeof PublicVehicleResponseSchema.parse>> = {
      path: `/api/v1/vehicles/${vehicle.id}?locale=en`, priceView: 'usd', schema: PublicVehicleResponseSchema, media: value => value.data.images,
    };
    state.readAnonymous.mockImplementation(async request => anonymousPublicEnvelope(request.schema.parse({ data: vehicle, meta: { requestId: 'ignored', catalogCache: stamp() } })));
    await state.read(mediaDescriptor);
    state.setTime(599);
    await state.read(mediaDescriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    state.setTime(600);
    await state.read(mediaDescriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
  });
});
