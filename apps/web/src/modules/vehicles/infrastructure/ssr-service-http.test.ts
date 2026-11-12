import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicCatalogCacheStampSchema, PublicHomeSectionsSchema } from '@hd/contracts/public';
import { internalCatalogPath, readAnonymousPublicResource, readSsrServiceVersion } from './ssr-service-http';
import { type SsrPublicDescriptor } from './ssr-public-reader';

const { serviceKey } = vi.hoisted(() => ({ serviceKey: 'fixture-service-key-'.repeat(3) }));
vi.mock('@/shared/config/ssr-service-secret', () => ({ getSsrServiceSecret: () => serviceKey }));
const stamp = PublicCatalogCacheStampSchema.parse({ version: 'a'.repeat(64), priceView: 'usd', fx: null,
  checkedAt: '2030-01-01T00:00:00Z', validUntil: '2030-01-01T00:00:15Z' });
const headers = { 'Cache-Control': 'no-store' };
const descriptor: SsrPublicDescriptor<ReturnType<typeof PublicHomeSectionsSchema.parse>> = {
  path: '/api/v1/home/vehicles?locale=en&view=localized&priceView=usd', priceView: 'usd', schema: PublicHomeSectionsSchema,
};
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('authenticated server-only catalog transport', () => {
  it('uses the fixed internal version endpoint and only the already-trusted visitor IP outside the cache', async () => {
    vi.stubEnv('VEHICLE_API_BASE_URL', 'http://api.example.invalid:3320');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: stamp, meta: { requestId: 'current-request' } }, { headers }));
    vi.stubGlobal('fetch', fetcher);
    expect((await readSsrServiceVersion('usd', { 'X-Forwarded-For': '203.0.113.7', Cookie: 'PRIVATE_COOKIE', Authorization: 'PRIVATE_AUTH', requestId: 'PRIVATE_TRACE' })).data).toEqual(stamp);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('http://api.example.invalid:3320/internal/public-catalog/version?priceView=usd');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error' });
    expect(options.headers).toEqual({ Accept: 'application/json', 'Cache-Control': 'no-store', 'X-HD-SSR-Key': serviceKey, 'X-Forwarded-For': '203.0.113.7' });
    expect(JSON.stringify(options)).not.toMatch(/PRIVATE_COOKIE|PRIVATE_AUTH|PRIVATE_TRACE/);
  });

  it('loads anonymous data with static identity only and strips upstream traces before returning to the cache', async () => {
    vi.stubEnv('VEHICLE_API_BASE_URL', 'http://api.example.invalid');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { sections: [] }, meta: { requestId: 'UPSTREAM_TRACE', catalogCache: stamp } }, { headers: { ...headers, 'Set-Cookie': 'UPSTREAM_COOKIE', 'X-Private': 'UPSTREAM_PRIVATE' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await readAnonymousPublicResource(descriptor);
    expect(fetcher.mock.calls[0][0]).toBe('http://api.example.invalid/internal/public-catalog/home/vehicles?locale=en&view=localized&priceView=usd');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ Accept: 'application/json', 'Cache-Control': 'no-store', 'X-HD-SSR-Key': serviceKey });
    expect(result).toEqual({ data: { sections: [] }, meta: { catalogCache: stamp } });
    expect(JSON.stringify(result)).not.toMatch(/UPSTREAM_TRACE|UPSTREAM_COOKIE|UPSTREAM_PRIVATE|fixture-service-key/);
  });

  it('only maps the four public JSON resource routes, never media, private routes, arbitrary hosts or fragments', async () => {
    expect(internalCatalogPath('/api/v1/vehicles/car_1?locale=ru')).toBe('/internal/public-catalog/vehicles/car_1?locale=ru');
    expect(internalCatalogPath('/api/v1/vehicle-filters')).toBe('/internal/public-catalog/vehicle-filters');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const path of ['https://other.invalid/api/v1/vehicles', '//other.invalid/api/v1/vehicles', '/api/v1/admin/vehicles', '/api/v1/media/foo', '/api/v1/external-media/foo/failure', '/api/v1/vehicles/../admin', '/api/v1/vehicles/car%2fadmin', '/api/v1/vehicles/car#fragment', '/internal/public-catalog/version']) {
      await expect(readAnonymousPublicResource({ ...descriptor, path })).rejects.toMatchObject({ status: 503 });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([400, 404, 503])('maps a failed version control request (%s) to an outage rather than a missing vehicle', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(readSsrServiceVersion('usd', {})).rejects.toMatchObject({ status: 503 });
  });

  it('retains bounded Retry-After for rate limits on version and data reads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '1' } })));
    await expect(readSsrServiceVersion('usd', {})).rejects.toMatchObject({ status: 429, retryAfter: '1' });
    await expect(readAnonymousPublicResource(descriptor)).rejects.toMatchObject({ status: 429, retryAfter: '1' });
  });

  it('requires noncached JSON and refuses private or malformed payloads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: stamp, meta: { requestId: 'test' } }, { headers: { 'Cache-Control': 'public,max-age=15' } }))
      .mockResolvedValueOnce(new Response('<html>login</html>', { headers: { ...headers, 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(Response.json({ data: { sections: [], purchaseCost: 'PRIVATE' }, meta: { requestId: 'test' } }, { headers }));
    vi.stubGlobal('fetch', fetcher);
    await expect(readSsrServiceVersion('usd', {})).rejects.toMatchObject({ status: 503 });
    await expect(readAnonymousPublicResource(descriptor)).rejects.toMatchObject({ status: 503 });
    await expect(readAnonymousPublicResource(descriptor)).rejects.toMatchObject({ status: 503 });
  });

  it('cancels an oversized version body without exposing response contents', async () => {
    let canceled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20_000)); }, cancel() { canceled = true; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { ...headers, 'Content-Type': 'application/json' } })));
    await expect(readSsrServiceVersion('usd', {})).rejects.toMatchObject({ status: 503 });
    expect(canceled).toBe(true);
  });
});
