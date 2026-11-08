import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { getPublicVehicle, parseCatalogQuery, requestPublicApi } from './public-api';
import { proxyPublicRequest } from './public-proxy';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('public HTTP adapter and same-origin proxy', () => {
  it('normalizes supported URL filters and refuses invalid/repeated pagination', () => {
    expect(parseCatalogQuery({ make: 'byd', page: '2' }, 'ru')).toMatchObject({
      make: 'byd',
      page: 2,
      pageSize: 24,
    });
    for (const page of ['0', '-1', '1.5', '0x10', ['1', '2']])
      expect(parseCatalogQuery({ page }, 'en')).toBeNull();
    expect(parseCatalogQuery({ powertrain: 'electric' }, 'en')).toBeNull();
  });
  it('requests a validated public DTO uncached without browser credentials', async () => {
    const vehicle = makePublicVehicleFixture();
    vehicle.detailPath = `/en/cars/${vehicle.id}/`;
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ data: vehicle, meta: { requestId: 'fixture' } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPublicRequest(
      new Request(`http://website.test/api/v1/vehicles/${vehicle.id}?locale=en`, {
        headers: { Cookie: 'staff=PRIVATE', Authorization: 'Bearer PRIVATE' },
      }),
      ['vehicles', vehicle.id],
    );
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ Accept: 'application/json, image/*;q=0.9' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('blocks administrative, absolute and malformed paths before any upstream request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const parts of [
      ['admin', 'vehicles'],
      ['auth', 'session'],
      ['media', '..'],
      ['vehicles/x/admin'],
    ]) {
      const response = await proxyPublicRequest(
        new Request('http://website.test/api/v1/anything'),
        parts,
      );
      expect(response.status).toBe(404);
    }
    expect(
      (
        await proxyPublicRequest(
          new Request('http://website.test/api/v1/vehicles?locale=en&locale=ru'),
          ['vehicles'],
        )
      ).status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps missing vehicles distinct from outages and removes internal error details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockRejectedValue(new Error('secret 127.0.0.1 internal')),
    );
    expect(await getPublicVehicle('missing', 'en')).toBeNull();
    const response = await proxyPublicRequest(
      new Request('http://website.test/api/v1/vehicles?locale=en'),
      ['vehicles'],
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|127\.0\.0\.1|internal/);
  });
  it('treats an upstream invalid identifier as a missing detail, not a successful outage page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));
    expect(await getPublicVehicle('not-a-uuid', 'en')).toBeNull();
  });
  it('forwards a literal keyword and only the fixed thumbnail variant', async () => {
    expect(parseCatalogQuery({ q: '  BYD_50%  ' }, 'en')?.q).toBe('BYD_50%');
    expect(parseCatalogQuery({ q: 'x'.repeat(101) }, 'en')).toBeNull();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/webp' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    const valid = await proxyPublicRequest(
      new Request('http://website.test/api/v1/media/image/?variant=thumb'),
      ['media', 'image'],
    );
    expect(valid.status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toMatch(/\/api\/v1\/media\/image\?variant=thumb$/);
    for (const query of ['variant=large', 'width=100', 'variant=thumb&variant=thumb']) {
      expect(
        (
          await proxyPublicRequest(
            new Request(`http://website.test/api/v1/media/image/?${query}`),
            ['media', 'image'],
          )
        ).status,
      ).toBe(400);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects redirects and non-image media rather than exposing HTML through the image path', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('<script>unsafe</script>', { headers: { 'Content-Type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPublicRequest(
      new Request('http://website.test/api/v1/media/image'),
      ['media', 'image'],
    );
    expect(response.status).toBe(503);
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });
  it('does not accept a caller-controlled server origin or unsafe protocols', async () => {
    vi.stubEnv('VEHICLE_API_BASE_URL', 'file:///etc/');
    await expect(requestPublicApi('/api/v1/vehicles')).rejects.toThrow();
  });
});
