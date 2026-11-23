import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicHtmlCacheVersions } from './public-html-cache-version';

const { key } = vi.hoisted(() => ({ key: 'synthetic-ssr-service-credential' }));
vi.mock('@/shared/config/ssr-service-secret', () => ({ getSsrServiceSecret: () => key }));

const visitor = '203.0.113.7';
const root = 'http://api.example.invalid/internal/public-catalog/version?priceView=usd';
const protocol = { 'Cache-Control': 'no-store', 'X-HD-Cache-Protocol': '2' };
const meta = { requestId: 'version-trace' };

function scopePair(lifetimeMs = 60_000) {
  const checkedAt = new Date();
  const validUntil = new Date(+checkedAt + lifetimeMs).toISOString();
  const stamp = { priceView: 'usd', fx: null, checkedAt: checkedAt.toISOString(), validUntil };
  return { catalog: { ...stamp, version: 'a'.repeat(64) }, filters: { ...stamp, version: 'b'.repeat(64) } };
}

function read(ip = visitor, mode: 2 | 3 = 2) {
  return getPublicHtmlCacheVersions(ip, new AbortController().signal, 'ru', mode);
}

function rejectedBodyResponse(status: number, headers?: HeadersInit) {
  return new Response(new ReadableStream({ cancel() { throw new Error('Fixture body cancellation failed'); } }), { status, headers });
}

beforeEach(() => {
  vi.stubEnv('VEHICLE_API_BASE_URL', 'http://api.example.invalid');
  vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'true');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('homepage HTML version preflight', () => {
  it('requests both strict scopes over one authenticated no-store call', async () => {
    const data = scopePair();
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data, meta }, { headers: protocol }));
    vi.stubGlobal('fetch', fetcher);
    await expect(read()).resolves.toEqual(data);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(root + '&scope=homepage', expect.objectContaining({
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: {
        Accept: 'application/json', 'Cache-Control': 'no-store', 'x-hd-cache-protocol': '2',
        'X-HD-SSR-Key': key, 'X-Forwarded-For': visitor,
      },
    }));
  });

  it('authorizes the precise pair for the requested language and its longer deadline', async () => {
    const data = scopePair(600_000);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data, meta }, { headers: {
      'Cache-Control': 'no-store', 'X-HD-Cache-Protocol': '3', 'X-HD-Catalog-Homepage': 'exact-v1',
    } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(read(visitor, 3)).resolves.toEqual(data);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(root + '&scope=homepage&locale=ru', expect.objectContaining({
      headers: expect.objectContaining({ 'x-hd-cache-protocol': '3', 'X-Forwarded-For': visitor }),
    }));
  });

  it('reuses the trusted visitor and the original deadline for the two legacy reads after HTTP 400', async () => {
    const data = scopePair();
    data.filters.checkedAt = new Date(Date.parse(data.catalog.checkedAt) + 100).toISOString();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rejectedBodyResponse(400))
      .mockResolvedValueOnce(Response.json({ data: data.catalog, meta }, { headers: protocol }))
      .mockResolvedValueOnce(Response.json({ data: data.filters, meta }, { headers: protocol }));
    vi.stubGlobal('fetch', fetcher);
    await expect(read()).resolves.toEqual(data);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      root + '&scope=homepage', root, root + '&scope=filters',
    ]);
    const options = fetcher.mock.calls.map(([, value]) => value);
    expect(options[1]).toEqual(options[0]);
    expect(options[2]).toEqual(options[0]);
    expect(options[1].signal).toBe(options[0].signal);
    expect(options[2].signal).toBe(options[0].signal);
  });

  it('rejects legacy samples taken with different FX snapshots', async () => {
    const data = scopePair();
    const fx = { version: '11111111-1111-4111-8111-111111111111', expiresAt: data.filters.validUntil };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ data: data.catalog, meta }, { headers: protocol }))
      .mockResolvedValueOnce(Response.json({ data: { ...data.filters, fx }, meta }, { headers: protocol }));
    vi.stubGlobal('fetch', fetcher);
    await expect(read()).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('preserves the longest Retry-After if the legacy API limits both reads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '7' } }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '11' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(read()).rejects.toMatchObject({ status: 429, retryAfter: '11' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 404, 429, 503])('fails closed without fallback on HTTP %s', async status => {
    const fetcher = vi.fn().mockResolvedValue(rejectedBodyResponse(status, { 'Retry-After': '17' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(read()).rejects.toMatchObject(status === 429 ? { status, retryAfter: '17' } : { status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-scope', 'extra-scope', 'bad-meta', 'no-protocol', 'no-no-store', 'different-fx', 'different-checked-at', 'wrong-price'])(
    'rejects %s on a successful response without fallback', async reason => {
      const data = scopePair();
      const fx = { version: '11111111-1111-4111-8111-111111111111', expiresAt: data.catalog.validUntil };
      if (reason === 'different-checked-at') data.filters.checkedAt = new Date(Date.parse(data.catalog.checkedAt) + 100).toISOString();
      if (reason === 'wrong-price') data.filters.priceView = 'original';
      const body = {
        data: reason === 'missing-scope' ? { catalog: data.catalog }
          : reason === 'extra-scope' ? { ...data, extra: data.filters }
          : reason === 'different-fx' ? { ...data, filters: { ...data.filters, fx } } : data,
        meta: reason === 'bad-meta' ? { requestId: '', extra: 'private' } : meta,
      };
      const headers = new Headers(protocol);
      if (reason === 'no-protocol') headers.delete('X-HD-Cache-Protocol');
      if (reason === 'no-no-store') headers.delete('Cache-Control');
      const fetcher = vi.fn().mockResolvedValue(Response.json(body, { headers }));
      vi.stubGlobal('fetch', fetcher);
      await expect(read()).rejects.toMatchObject({ status: 503 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a forwarded chain or disabled trusted-IP setup before calling the API', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(read(visitor + ',203.0.113.9')).rejects.toMatchObject({ status: 503 });
    vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'false');
    await expect(read()).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
