import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSsrPublicHomepage } from './ssr-public-api';

const request = vi.hoisted(() => ({ visitor: '203.0.113.7' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({
    'x-hd-visitor-ip': request.visitor,
    'x-forwarded-for': '192.0.2.45',
    Cookie: 'private-cookie',
  }),
}));
vi.mock('@/shared/config/ssr-service-secret', () => ({
  getSsrServiceSecret: () => 'synthetic-home-filter-service-key',
}));

const responseHeaders = (protocol: 2 | 3, precise = protocol === 3) => ({
  'Cache-Control': 'no-store', 'X-HD-Cache-Protocol': String(protocol),
  ...(precise ? { 'X-HD-Catalog-Homepage': 'exact-v1' } : {}),
});
const facets = { catalog: 'curated', total: 7, makes: [], models: [], powertrains: [] };
const stamp = (version: string, validMinutes: 5 | 10) => ({
  checkedAt: '2030-01-01T00:00:00Z', validUntil: `2030-01-01T00:${String(validMinutes).padStart(2, '0')}:00Z`,
  version: version.repeat(64), priceView: 'usd', fx: null,
});
const home = { sections: [] };

beforeEach(() => {
  request.visitor = '203.0.113.7';
  vi.stubEnv('VEHICLE_API_BASE_URL', 'http://api.example.invalid');
  vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'true');
  vi.stubEnv('HD_DEPLOYMENT_ENV', 'test');
  vi.stubEnv('HD_RELEASE_ID', randomUUID());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([2, 3] as const)('protocol %s checks both live scopes once while warm DTOs remain anonymous', async protocol => {
  const minutes = protocol === 3 ? 10 : 5;
  const pairedVersions = { catalog: stamp('c', minutes), filters: stamp('a', minutes) };
  const versionVisitors: (string | null)[] = [];
  const projections: (string | null)[] = [];
  const fetcher = vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    expect(headers.get('x-hd-ssr-key')).toBe('synthetic-home-filter-service-key');
    expect(headers.get('x-hd-cache-protocol')).toBe(String(protocol));
    expect(headers.has('cookie')).toBe(false);
    if (url.pathname === '/internal/public-catalog/version') {
      expect(url.search).toBe(protocol === 3 ? '?priceView=usd&scope=homepage&locale=zh' : '?priceView=usd&scope=homepage');
      expect(headers.has('x-hd-catalog-homepage')).toBe(false);
      const visitor = headers.get('x-forwarded-for');
      versionVisitors.push(visitor);
      return Response.json({ data: pairedVersions, meta: { requestId: visitor } }, { headers: responseHeaders(protocol) });
    }
    expect(headers.has('x-forwarded-for')).toBe(false);
    const isHome = url.pathname === '/internal/public-catalog/home/vehicles';
    if (!isHome) expect(url.pathname).toBe('/internal/public-catalog/vehicle-filters');
    expect(headers.get('x-hd-catalog-homepage')).toBe(protocol === 3 ? 'exact-v1' : null);
    expect(url.searchParams.get('locale')).toBe('zh');
    expect(headers.get('x-hd-catalog-scope')).toBe(isHome ? null : 'filters');
    projections.push(isHome ? 'home' : url.searchParams.get('projection'));
    return Response.json({ data: isHome ? home : facets,
      meta: { requestId: 'resource', catalogCache: isHome ? pairedVersions.catalog : pairedVersions.filters } },
      { headers: responseHeaders(protocol) });
  });
  vi.stubGlobal('fetch', fetcher);

  const first = await Promise.all(getSsrPublicHomepage('zh', protocol));
  expect(first.map(value => value.meta.requestId)).toEqual(Array(3).fill('203.0.113.7'));
  request.visitor = '203.0.113.8';
  const warm = await Promise.all(getSsrPublicHomepage('zh', protocol));
  expect(warm.map(value => value.meta.requestId)).toEqual(Array(3).fill('203.0.113.8'));
  expect(versionVisitors).toEqual(['203.0.113.7', '203.0.113.8']);
  expect(projections.sort()).toEqual(['home', 'home-models', 'overview']);
});

it.each([2, 3] as const)('protocol %s retries a conflict with a fresh version without retrying the other resources', async protocol => {
  const minutes = protocol === 3 ? 10 : 5;
  const pairedVersions = { catalog: stamp('c', minutes), filters: stamp('a', minutes) };
  const nextFilters = stamp('b', minutes);
  const scopes: (string | null)[] = [];
  const counts = { home: 0, overview: 0, models: 0 };
  const fetcher = vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/internal/public-catalog/version') {
      const headers = new Headers(options.headers);
      expect(headers.get('x-forwarded-for')).toBe(request.visitor);
      expect(headers.get('x-hd-cache-protocol')).toBe(String(protocol));
      expect(url.searchParams.get('locale')).toBe(protocol === 3 ? 'zh' : null);
      const scope = url.searchParams.get('scope');
      scopes.push(scope);
      const data = scope === 'homepage' ? { ...pairedVersions, filters: scopes.length === 1 ? pairedVersions.filters : nextFilters } : nextFilters;
      return Response.json({ data, meta: { requestId: `version-${scopes.length}` } }, { headers: responseHeaders(protocol) });
    }
    if (url.pathname === '/internal/public-catalog/home/vehicles') {
      counts.home++;
      return Response.json({ data: home, meta: { requestId: 'resource', catalogCache: pairedVersions.catalog } },
        { headers: responseHeaders(protocol) });
    }
    expect(url.pathname).toBe('/internal/public-catalog/vehicle-filters');
    const projection = url.searchParams.get('projection');
    expect(['overview', 'home-models']).toContain(projection);
    if (projection === 'home-models') counts.models++;
    else counts.overview++;
    const catalogCache = projection === 'home-models' ? pairedVersions.filters
      : counts.overview === 1 && protocol === 2 ? { ...pairedVersions.filters, priceView: 'original' } : nextFilters;
    return Response.json({ data: facets, meta: { requestId: 'resource', catalogCache } },
      { headers: responseHeaders(protocol) });
  });
  vi.stubGlobal('fetch', fetcher);

  const result = await Promise.all(getSsrPublicHomepage('zh', protocol));
  expect(result.map(value => value.meta.requestId)).toEqual(['version-1', 'version-2', 'version-1']);
  expect(scopes).toEqual(['homepage', protocol === 3 ? 'homepage' : 'filters']);
  expect(counts).toEqual({ home: 1, overview: 2, models: 1 });
});

it.each([400, 429, 503])('protocol 3 does not downgrade an unsuccessful live read (%s)', async status => {
  const fetcher = vi.fn(async () => new Response(null, { status, headers: { 'Retry-After': '7' } }));
  vi.stubGlobal('fetch', fetcher);
  const results = await Promise.allSettled(getSsrPublicHomepage('zh', 3));
  for (const result of results) {
    expect(result).toMatchObject({ status: 'rejected', reason: { status: status === 429 ? 429 : 503 } });
    if (status === 429) expect(result).toMatchObject({ reason: { retryAfter: '7' } });
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([2, 3] as const)('protocol 3 rejects a resource with protocol %s and no exact scope confirmation', async resourceProtocol => {
  const pairedVersions = { catalog: stamp('c', 5), filters: stamp('a', 5) };
  const fetcher = vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/version')) return Response.json({ data: pairedVersions, meta: { requestId: 'version' } },
      { headers: responseHeaders(3) });
    const isHome = path.endsWith('/home/vehicles');
    return Response.json({ data: isHome ? home : facets,
      meta: { requestId: 'resource', catalogCache: isHome ? pairedVersions.catalog : pairedVersions.filters } },
      { headers: isHome ? responseHeaders(resourceProtocol, false) : responseHeaders(3) });
  });
  vi.stubGlobal('fetch', fetcher);
  const [featured, overview, models] = await Promise.allSettled(getSsrPublicHomepage('zh', 3));
  expect(featured).toMatchObject({ status: 'rejected', reason: { status: 503 } });
  expect(overview.status).toBe('fulfilled');
  expect(models.status).toBe('fulfilled');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('protocol 3 does not accept a coarse version pair without exact scope confirmation', async () => {
  const pairedVersions = { catalog: stamp('c', 5), filters: stamp('a', 5) };
  const fetcher = vi.fn(async () => Response.json({ data: pairedVersions, meta: { requestId: 'coarse-version' } },
    { headers: responseHeaders(3, false) }));
  vi.stubGlobal('fetch', fetcher);
  const results = await Promise.allSettled(getSsrPublicHomepage('zh', 3));
  for (const result of results) expect(result).toMatchObject({ status: 'rejected', reason: { status: 503 } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
