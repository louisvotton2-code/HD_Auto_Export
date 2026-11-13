import { afterEach, expect, it, vi } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { ApiErrorSchema } from '@hd/contracts/public';
import { proxyPublicRequest } from './public-proxy';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const vehicle = makePublicVehicleFixture();
const payload = { data: { vehicleId: vehicle.id, locale: 'ru', revision: 'a'.repeat(64), total: 1, items: vehicle.images.slice(0, 1), nextCursor: null }, meta: { requestId: 'upstream' } };

it('only forwards the formal segment path/query and anonymous visitor policy', async () => {
  const fetcher = vi.fn(async () => Response.json(payload, { headers: { 'cache-control': 'no-store' } }));
  vi.stubGlobal('fetch', fetcher);
  const request = new Request(`https://site.invalid/api/v1/vehicles/${vehicle.id}/gallery?locale=ru&limit=50&cursor=opaque`, { headers: { Cookie: 'secret', Authorization: 'Bearer secret' } });
  const result = await proxyPublicRequest(request, ['vehicles', vehicle.id, 'gallery']);
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const actual = new URL(url);
  expect(actual.pathname).toBe(`/api/v1/vehicles/${vehicle.id}/gallery`);
  expect(Object.fromEntries(actual.searchParams)).toEqual({ locale: 'ru', limit: '50', cursor: 'opaque' });
  expect(new Headers(options.headers).has('cookie')).toBe(false);
  expect(new Headers(options.headers).has('authorization')).toBe(false);
  expect(options.cache).toBe('no-store');
});

it('rejects arbitrary subresources and malformed/repeated segment queries without upstream access', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const path of ['reports', 'activity', 'admin', 'gallery/private'])
    expect((await proxyPublicRequest(new Request('https://site.invalid/'), ['vehicles', vehicle.id, ...path.split('/')])).status).toBe(404);
  for (const query of ['locale=ru&view=localized', 'locale=ru&priceView=usd', 'limit=101', 'locale=ru&locale=en', 'cursor='])
    expect((await proxyPublicRequest(new Request(`https://site.invalid/?${query}`), ['vehicles', vehicle.id, 'gallery'])).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([404, 409, 429, 503])('preserves %s without caching errors or emitting upstream details', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('PRIVATE_UPSTREAM', { status, headers: { 'Retry-After': '3' } })));
  const result = await proxyPublicRequest(new Request('https://site.invalid/?locale=ru'), ['vehicles', vehicle.id, 'gallery']);
  expect(result.status).toBe(status);
  expect(result.headers.get('cache-control')).toBe('no-store');
  if (status === 429) expect(result.headers.get('retry-after')).toBe('3');
  const body = await result.json();
  expect(() => ApiErrorSchema.parse(body)).not.toThrow();
  if (status === 409) expect(body.error.code).toBe('VERSION_CONFLICT');
  expect(JSON.stringify(body)).not.toContain('PRIVATE_UPSTREAM');
});

it('rejects mismatched or privately extended upstream pages as unavailable', async () => {
  for (const extra of [{ vehicleId: 'another' }, { locale: 'en' }, { staffId: 'private' }]) {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...payload, data: { ...payload.data, ...extra } })));
    expect((await proxyPublicRequest(new Request('https://site.invalid/?locale=ru'), ['vehicles', vehicle.id, 'gallery'])).status).toBe(503);
  }
});
