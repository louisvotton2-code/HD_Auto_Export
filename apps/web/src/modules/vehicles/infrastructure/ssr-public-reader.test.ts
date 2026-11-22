import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InternalPublicCatalogCacheStampSchema, PublicCatalogCacheStampSchema, PublicHomeSectionsSchema, PublicVehicleCardListSchema, PublicVehicleFiltersSchema, PublicVehicleResponseSchema, PublicVehicleInlineResponseSchema,
  type PublicCatalogCacheStamp, type PublicHomeSections,
} from '@hd/contracts/public';
import { makeImportedPublicVehicleFixture, makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicApiError } from './public-http';
import { SsrDtoCache } from './ssr-dto-cache';
import { anonymousPublicEnvelope, canonicalPublicPath, createSsrPublicReader, type SsrPublicDescriptor, type SsrPublicEnvelope, type SsrAnonymousReader, type SsrCacheProtocol } from './ssr-public-reader';

const checked = Date.parse('2030-01-01T00:00:00Z');
function stamp(version = 'a'.repeat(64), remaining = 15_000, fx: PublicCatalogCacheStamp['fx'] = null) {
  return PublicCatalogCacheStampSchema.parse({ version, priceView: 'usd', fx,
    checkedAt: new Date(checked).toISOString(), validUntil: new Date(checked + remaining).toISOString() });
}
function dto<T extends SsrPublicEnvelope>(value: T, protocol: SsrCacheProtocol = 1) {
  return { protocol, value: anonymousPublicEnvelope(value) };
}
function versionDto(value: PublicCatalogCacheStamp, requestId: string, protocol: SsrCacheProtocol = 1) {
  return { protocol, value: { data: value, meta: { requestId } } };
}
const descriptor: SsrPublicDescriptor<PublicHomeSections> = {
  path: canonicalPublicPath('/api/v1/home/vehicles', { locale: 'en', view: 'localized', priceView: 'usd' }),
  priceView: 'usd', schema: PublicHomeSectionsSchema,
};
const filters = {
  path: '/api/v1/vehicle-filters?locale=en&view=localized&priceView=usd&projection=overview',
  priceView: 'usd' as const, scope: 'filters' as const, schema: PublicVehicleFiltersSchema,
};
const filterData = { catalog: 'curated', total: 7, makes: [], models: [], powertrains: [] };
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
  const readVersion = vi.fn(async () => versionDto(current, `current-${++versionReads}`));
  const readAnonymous = vi.fn(async <T extends SsrPublicEnvelope>(request: SsrPublicDescriptor<T>) =>
    dto(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'UPSTREAM_TRACE_SENTINEL', catalogCache: current } })));
  // Restore the handler's declared generic relation erased by Vitest's Mock call signature.
  const anonymousReader = readAnonymous as SsrAnonymousReader;
  const wallNow = () => checked + time - 100;
  const onStamp = vi.fn();
  const read = createSsrPublicReader({ identity, cache, now, wallNow, readVersion, readAnonymous: anonymousReader, onStamp });
  return { read, cache, now, readVersion, readAnonymous, anonymousReader, onStamp,
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

  it('uses the actual shared check start time for a reader that joins later', async () => {
    const state = setup();
    const initial = () => ({ startedAt: 100, result: Promise.resolve(versionDto(stamp(), 'shared-version')) });
    state.setTime(15_099);
    await state.read(descriptor, initial);
    state.setTime(15_100);
    await expect(state.read(descriptor, initial)).rejects.toMatchObject({ status: 503 });
    expect(state.readVersion).not.toHaveBeenCalled();
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
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

  it('does not merge in-flight old/inline detail loads or reuse their cache values at the same public version', async () => {
    const state = setup();
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    vehicle.displayPrice = { status: 'ready', kind: 'asking', money: { amount: '23500.00', currency: 'USD' }, conversion: null };
    const oldDetail = {
      path: canonicalPublicPath(`/api/v1/vehicles/${vehicle.id}`, { locale: 'en', view: 'localized', priceView: 'usd' }),
      priceView: 'usd' as const, schema: PublicVehicleResponseSchema,
    };
    const inlineDetail = {
      path: canonicalPublicPath(`/api/v1/vehicles/${vehicle.id}`, { locale: 'en', view: 'localized', priceView: 'usd', projection: 'detail-inline-v1' }),
      priceView: 'usd' as const, schema: PublicVehicleInlineResponseSchema,
    };
    const inlineVehicle = {
      ...vehicle, projection: 'detail-inline-v1', configurationInline: [],
      inspectionSummary: { status: 'no_report', contentLocale: null, checked: null, faults: null, categories: [] },
      inspectionInline: { conclusions: [], defects: [], normalItemCount: 0, hasMoreConclusions: false, hasMoreDefects: false },
    };
    let release!: () => void;
    const pendingLoad = new Promise<void>(resolve => { release = resolve; });
    state.readAnonymous.mockImplementation(async request => {
      await pendingLoad;
      const data = request.path === inlineDetail.path ? inlineVehicle : vehicle;
      return dto(request.schema.parse({ data, meta: { requestId: 'ignored', catalogCache: stamp() } }));
    });
    const pending = [state.read(oldDetail), state.read(inlineDetail), state.read(oldDetail), state.read(inlineDetail)];
    try {
      await vi.waitFor(() => expect(state.readAnonymous).toHaveBeenCalledTimes(2));
    } finally {
      release();
    }
    const values = await Promise.all(pending);
    expect(values[0]!.data).not.toHaveProperty('projection');
    expect(values[1]!.data).toMatchObject({ projection: 'detail-inline-v1', configurationInline: [] });
    expect(values[2]!.data).not.toHaveProperty('projection');
    expect(values[3]!.data).toMatchObject({ projection: 'detail-inline-v1' });
    expect(state.cache.stats.entries).toBe(2);
    expect(state.cache.loaded).toHaveLength(2);
    const [oldWarm, inlineWarm] = await Promise.all([state.read(oldDetail), state.read(inlineDetail)]);
    expect(oldWarm.data).not.toHaveProperty('projection');
    expect(inlineWarm.data.projection).toBe('detail-inline-v1');
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.readVersion).toHaveBeenCalledTimes(6);
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

  it('renders an explicitly acknowledged inline detail after a revision advance without caching it', async () => {
    const state = setup();
    const vehicle = makeLocalizedPublicVehicleFixture('en');
    const inline = {
      path: canonicalPublicPath(`/api/v1/vehicles/${vehicle.id}`, { locale: 'en', view: 'localized', priceView: 'usd', projection: 'detail-inline-v1', pixelView: 'eligible' }),
      priceView: 'usd' as const, allowInlineSnapshot: true as const, schema: PublicVehicleInlineResponseSchema,
    };
    const data = {
      ...vehicle, projection: 'detail-inline-v1', pixelEnabled: true, configurationInline: [],
      inspectionSummary: { status: 'no_report', contentLocale: null, checked: null, faults: null, categories: [] },
      inspectionInline: { conclusions: [], defects: [], normalItemCount: 0, hasMoreConclusions: false, hasMoreDefects: false },
    };
    const newer = stamp('b'.repeat(64), 500);
    const response = (catalogCache: PublicCatalogCacheStamp) => dto(inline.schema.parse({ data, meta: { requestId: 'upstream', catalogCache } }), 2);
    state.readAnonymous.mockImplementation(async () => ({ ...response(newer), inlineSnapshot: true }));
    expect((await state.read(inline)).data).toMatchObject({ id: vehicle.id, projection: 'detail-inline-v1', pixelEnabled: true });
    expect((await state.read(inline)).meta.catalogCache).toBeUndefined();
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.cache.stats).toMatchObject({ entries: 0, inFlight: 0 });
    expect(state.onStamp).toHaveBeenLastCalledWith(null, undefined);
    state.readAnonymous.mockResolvedValue(response(newer));
    await expect(state.read(inline)).rejects.toMatchObject({ status: 503 });
    const fx = { version: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(checked + 60_000).toISOString() };
    state.readAnonymous.mockImplementation(async () => ({ ...response({ ...newer, fx }), inlineSnapshot: true }));
    await expect(state.read(inline)).rejects.toMatchObject({ status: 503 });
    state.readAnonymous.mockImplementation(async () => {
      state.setTime(state.now() + 600);
      return { ...response(newer), inlineSnapshot: true };
    });
    await expect(state.read(inline)).rejects.toMatchObject({ status: 503 });
    expect(state.cache.stats.entries).toBe(0);
  });

  it('discards a mismatched DTO and retries once using a newly checked version', async () => {
    const state = setup();
    const newer = stamp('b'.repeat(64));
    state.readAnonymous.mockImplementation(async request => {
      state.setStamp(newer);
      return dto(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored', catalogCache: newer } }));
    });
    const result = await state.read(descriptor);
    expect(result.meta.catalogCache!.version).toBe(newer.version);
    expect(state.readVersion).toHaveBeenCalledTimes(2);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.cache.stats.entries).toBe(1);
  });

  it('fails closed after the second mismatch and never writes the wrong key', async () => {
    const state = setup();
    state.readAnonymous.mockImplementation(async request => dto(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored', catalogCache: stamp('b'.repeat(64)) } })));
    await expect(state.read(descriptor)).rejects.toMatchObject({ status: 503 });
    expect(state.readVersion).toHaveBeenCalledTimes(2);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.cache.stats.entries).toBe(0);
  });

  it.each([undefined, stamp('b'.repeat(64))])('returns a validated one-off facet during version churn without making it reusable', async catalogCache => {
    const state = setup();
    state.readAnonymous.mockImplementation(async request => dto(request.schema.parse({
      data: filterData, meta: { requestId: 'ignored', ...(catalogCache ? { catalogCache } : {}) },
    })));
    const first = await state.read(filters);
    const second = await state.read(filters);
    expect(first.data.total).toBe(7);
    expect(second.data).toEqual(first.data);
    expect([first.meta.requestId, second.meta.requestId]).toEqual(['current-1', 'current-2']);
    expect(state.readVersion.mock.calls).toEqual([['usd', 'filters'], ['usd', 'filters']]);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.cache.stats).toMatchObject({ entries: 0, inFlight: 0 });
  });

  it('renders an acknowledged offset snapshot without a reusable DTO or HTML proof', async () => {
    const state = setup();
    const offset = { path: '/api/v1/vehicles?locale=en&view=localized&projection=card', priceView: 'usd' as const,
      allowOffsetSnapshot: true as const, schema: PublicVehicleCardListSchema };
    const data = { items: [], page: 1, pageSize: 24, hasMore: false };
    const envelope = { data, meta: { requestId: 'upstream', catalog: 'curated', total: 0, totalKind: 'exact',
      accessibleTotal: 0, dataAsOf: new Date(checked).toISOString(), freshness: 'fresh' } };
    const stateResponse = dto(offset.schema.parse(envelope), 2);
    const snapshot = stamp('b'.repeat(64), 500);
    state.readAnonymous.mockImplementation(async () => ({ ...stateResponse, offsetSnapshot: snapshot }));
    expect((await state.read(offset)).data).toEqual(data);
    expect((await state.read(offset)).meta.catalogCache).toBeUndefined();
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.cache.stats).toMatchObject({ entries: 0, inFlight: 0 });
    expect(state.onStamp).toHaveBeenLastCalledWith(null, undefined);
    state.readAnonymous.mockResolvedValue(stateResponse);
    await expect(state.read(offset)).rejects.toMatchObject({ status: 503 });
    const fx = { version: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(checked + 60_000).toISOString() };
    state.readAnonymous.mockImplementation(async () => ({ ...stateResponse, offsetSnapshot: stamp('b'.repeat(64), 500, fx) }));
    await expect(state.read(offset)).rejects.toMatchObject({ status: 503 });
    state.readAnonymous.mockImplementation(async () => {
      state.setTime(state.now() + 600);
      return { ...stateResponse, offsetSnapshot: snapshot };
    });
    await expect(state.read(offset)).rejects.toMatchObject({ status: 503 });
    expect(state.cache.stats.entries).toBe(0);
  });

  it('reuses a matching scoped facet and never accepts an expired or wrong-currency scope response', async () => {
    const state = setup();
    const version = stamp();
    state.readAnonymous.mockImplementation(async request => dto(request.schema.parse({
      data: filterData, meta: { requestId: 'ignored', catalogCache: version },
    })));
    await state.read(filters);
    await state.read(filters);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    expect(state.cache.stats.entries).toBe(1);

    state.setStamp(stamp('c'.repeat(64)));
    state.readAnonymous.mockImplementation(async request => dto(request.schema.parse({
      data: filterData, meta: { requestId: 'ignored', catalogCache: { ...version, priceView: 'original' } },
    })));
    await expect(state.read(filters)).rejects.toMatchObject({ status: 503 });
    state.readAnonymous.mockImplementation(async request => {
      state.setTime(300);
      return dto(request.schema.parse({
        data: filterData, meta: { requestId: 'ignored', catalogCache: stamp('d'.repeat(64), 100) },
      }));
    });
    await expect(state.read(filters)).rejects.toMatchObject({ status: 503 });
    expect(state.cache.stats.entries).toBe(1);
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
    state.readAnonymous.mockImplementation(async request => dto(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored' } })));
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
      return versionDto(stamp('a'.repeat(64), 1000), 'current');
    });
    await expect(version.read(descriptor)).rejects.toMatchObject({ status: 503 });
    expect(version.readAnonymous).not.toHaveBeenCalled();
    const resource = setup();
    resource.readAnonymous.mockImplementation(async request => {
      resource.setTime(2100);
      return dto(request.schema.parse({ data: { sections: [] }, meta: { requestId: 'ignored', catalogCache: stamp('a'.repeat(64), 1000) } }));
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
    state.readAnonymous.mockImplementation(async request => dto(request.schema.parse({ data: vehicle, meta: { requestId: 'ignored', catalogCache: stamp() } })));
    await state.read(mediaDescriptor);
    state.setTime(599);
    await state.read(mediaDescriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    state.setTime(600);
    await state.read(mediaDescriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
  });

  it('records the actual negotiated DTO stamp on cold and warm reads without extending its deadline', async () => {
    const state = setup();
    const live = InternalPublicCatalogCacheStampSchema.parse({ ...stamp(),
      validUntil: new Date(checked + 300_000).toISOString() });
    const actual = InternalPublicCatalogCacheStampSchema.parse({ ...live,
      checkedAt: new Date(checked + 1000).toISOString(), validUntil: new Date(checked + 120_000).toISOString() });
    state.readVersion.mockResolvedValue(versionDto(live, 'live', 2));
    state.readAnonymous.mockImplementation(async request => {
      state.setTime(state.now() + 250);
      const payload = request.schema.parse({ data: { sections: [] }, meta: { requestId: 'data' } });
      return dto({ ...payload, meta: { ...payload.meta, catalogCache: actual } }, 2);
    });

    await state.read(descriptor);
    state.setTime(118_000);
    await state.read(descriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    expect(state.onStamp.mock.calls).toEqual([[actual, checked + 119_000], [actual, checked + 119_000]]);
  });

  it('reuses the initial v2 value up to its original five-minute deadline, not the latest version check', async () => {
    const state = setup();
    const fresh = () => {
      const start = checked + state.now() - 100;
      return InternalPublicCatalogCacheStampSchema.parse({ ...stamp(), checkedAt: new Date(start).toISOString(),
        validUntil: new Date(start + 300_000).toISOString() });
    };
    state.readVersion.mockImplementation(async () => versionDto(fresh(), 'live', 2));
    state.readAnonymous.mockImplementation(async request => {
      const value = request.schema.parse({ data: { sections: [] }, meta: { requestId: 'data' } });
      return dto({ ...value, meta: { ...value.meta, catalogCache: fresh() } }, 2);
    });
    await state.read(descriptor);
    state.setTime(300_099);
    await state.read(descriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    expect(state.onStamp.mock.calls[1]?.[1]).toBe(checked + 300_000);
    state.setTime(300_100);
    await state.read(descriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.onStamp.mock.calls[2]?.[1]).toBe(checked + 600_000);
  });

  it.each([[1, 2], [2, 1]] as const)('caps mixed protocols %s/%s to 15 seconds and omits HTML proof', async (versionProtocol, resourceProtocol) => {
    const state = setup();
    const legacy = stamp();
    const long = InternalPublicCatalogCacheStampSchema.parse({ ...legacy, validUntil: new Date(checked + 300_000).toISOString() });
    state.readVersion.mockResolvedValue(versionDto(versionProtocol === 2 ? long : legacy, 'live', versionProtocol));
    state.readAnonymous.mockImplementation(async request => {
      const value = request.schema.parse({ data: { sections: [] }, meta: { requestId: 'data' } });
      return dto({ ...value, meta: { ...value.meta, catalogCache: resourceProtocol === 2 ? long : legacy } }, resourceProtocol);
    });
    await state.read(descriptor);
    state.setTime(15_100);
    await state.read(descriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.onStamp.mock.calls).toEqual([[null, undefined], [null, undefined]]);
  });

  it('respects earlier absolute FX and media expiry in the actual v2 match', async () => {
    const state = setup();
    const live = InternalPublicCatalogCacheStampSchema.parse({ ...stamp(), validUntil: new Date(checked + 120_000).toISOString(),
      fx: { version: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(checked + 120_000).toISOString() } });
    const vehicle = makeImportedPublicVehicleFixture('en', 'supplier', true);
    vehicle.images[0]!.remote!.expiresAt = new Date(checked + 50_000).toISOString();
    const mediaDescriptor: SsrPublicDescriptor<ReturnType<typeof PublicVehicleResponseSchema.parse>> = {
      path: `/api/v1/vehicles/${vehicle.id}?locale=en`, priceView: 'usd', schema: PublicVehicleResponseSchema, media: value => value.data.images,
    };
    state.readVersion.mockResolvedValue(versionDto(live, 'live', 2));
    state.readAnonymous.mockImplementation(async request => {
      const value = request.schema.parse({ data: vehicle, meta: { requestId: 'data' } });
      return dto({ ...value, meta: { ...value.meta, catalogCache: live } }, 2);
    });
    await state.read(mediaDescriptor);
    state.setTime(50_099);
    await state.read(mediaDescriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(1);
    expect(state.onStamp.mock.calls).toEqual([[live, checked + 50_000], [live, checked + 50_000]]);
    state.setTime(50_100);
    await state.read(mediaDescriptor);
    expect(state.readAnonymous).toHaveBeenCalledTimes(2);
    expect(state.onStamp).toHaveBeenLastCalledWith(null, undefined);
  });

  it.each([undefined, stamp('b'.repeat(64))])('never supplies HTML proof for a one-off negotiated filter', async catalogCache => {
    const state = setup();
    state.readVersion.mockResolvedValue(versionDto(stamp(), 'live', 2));
    state.readAnonymous.mockImplementation(async request => dto(request.schema.parse({
      data: filterData, meta: { requestId: 'data', ...(catalogCache ? { catalogCache } : {}) },
    }), 2));
    await expect(state.read(filters)).resolves.toMatchObject({ data: filterData });
    expect(state.onStamp).toHaveBeenCalledExactlyOnceWith(null, undefined);
    expect(state.cache.stats.entries).toBe(0);
  });

  it('reports no proof if a required dependency fails', async () => {
    const state = setup();
    state.readVersion.mockRejectedValueOnce(new PublicApiError(503));
    await expect(state.read(descriptor)).rejects.toMatchObject({ status: 503 });
    expect(state.onStamp).toHaveBeenCalledExactlyOnceWith(null, undefined);
  });

});
