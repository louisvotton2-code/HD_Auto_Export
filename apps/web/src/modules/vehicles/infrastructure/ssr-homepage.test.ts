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

const responseHeaders = { 'Cache-Control': 'no-store', 'X-HD-Cache-Protocol': '2' };
const facets = { catalog: 'curated', total: 7, makes: [], models: [], powertrains: [] };
const stamp = (version: string, priceView = 'usd') => ({
  version: version.repeat(64), priceView, fx: null,
  checkedAt: '2030-01-01T00:00:00Z', validUntil: '2030-01-01T00:05:00Z',
});
const pairedVersions = { catalog: stamp('c'), filters: stamp('a') };
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

it('each homepage reads both live scopes once while warm DTOs remain anonymous', async () => {
  const versionVisitors: (string | null)[] = [];
  const projections: (string | null)[] = [];
  const fetcher = vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    expect(headers.get('x-hd-ssr-key')).toBe('synthetic-home-filter-service-key');
    expect(headers.get('x-hd-cache-protocol')).toBe('2');
    expect(headers.has('cookie')).toBe(false);
    if (url.pathname === '/internal/public-catalog/version') {
      expect(url.search).toBe('?priceView=usd&scope=homepage');
      const visitor = headers.get('x-forwarded-for');
      versionVisitors.push(visitor);
      return Response.json({ data: pairedVersions, meta: { requestId: visitor } }, { headers: responseHeaders });
    }
    expect(headers.has('x-forwarded-for')).toBe(false);
    const isHome = url.pathname === '/internal/public-catalog/home/vehicles';
    if (!isHome) expect(url.pathname).toBe('/internal/public-catalog/vehicle-filters');
    expect(headers.get('x-hd-catalog-scope')).toBe(isHome ? null : 'filters');
    projections.push(isHome ? 'home' : url.searchParams.get('projection'));
    return Response.json({ data: isHome ? home : facets,
      meta: { requestId: 'resource', catalogCache: isHome ? pairedVersions.catalog : pairedVersions.filters } },
      { headers: responseHeaders });
  });
  vi.stubGlobal('fetch', fetcher);

  const first = await Promise.all(getSsrPublicHomepage('zh'));
  expect(first.map(value => value.meta.requestId)).toEqual(Array(3).fill('203.0.113.7'));
  request.visitor = '203.0.113.8';
  const warm = await Promise.all(getSsrPublicHomepage('zh'));
  expect(warm.map(value => value.meta.requestId)).toEqual(Array(3).fill('203.0.113.8'));
  expect(versionVisitors).toEqual(['203.0.113.7', '203.0.113.8']);
  expect(projections.sort()).toEqual(['home', 'home-models', 'overview']);
});

it('a conflicting resource retries with a fresh live version without retrying the other resources', async () => {
  const scopes: (string | null)[] = [];
  const counts = { home: 0, overview: 0, models: 0 };
  const fetcher = vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/internal/public-catalog/version') {
      expect(new Headers(options.headers).get('x-forwarded-for')).toBe(request.visitor);
      const scope = url.searchParams.get('scope');
      scopes.push(scope);
      return Response.json({ data: scope === 'homepage' ? pairedVersions : stamp('b'), meta: { requestId: `version-${scope}` } },
        { headers: responseHeaders });
    }
    if (url.pathname === '/internal/public-catalog/home/vehicles') {
      counts.home++;
      return Response.json({ data: home, meta: { requestId: 'resource', catalogCache: pairedVersions.catalog } },
        { headers: responseHeaders });
    }
    expect(url.pathname).toBe('/internal/public-catalog/vehicle-filters');
    const projection = url.searchParams.get('projection');
    expect(['overview', 'home-models']).toContain(projection);
    if (projection === 'home-models') counts.models++;
    else counts.overview++;
    const catalogCache = projection === 'home-models' ? stamp('a')
      : counts.overview === 1 ? stamp('a', 'original') : stamp('b');
    return Response.json({ data: facets, meta: { requestId: 'resource', catalogCache } },
      { headers: responseHeaders });
  });
  vi.stubGlobal('fetch', fetcher);

  const result = await Promise.all(getSsrPublicHomepage('zh'));
  expect(result.map(value => value.meta.requestId)).toEqual(['version-homepage', 'version-filters', 'version-homepage']);
  expect(scopes).toEqual(['homepage', 'filters']);
  expect(counts).toEqual({ home: 1, overview: 2, models: 1 });
});
