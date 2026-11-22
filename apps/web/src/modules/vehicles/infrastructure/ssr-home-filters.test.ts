import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSsrPublicHomeFilters } from './ssr-public-api';

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

it('each homepage filter pair shares a live check while warm DTOs remain anonymous', async () => {
  const versionVisitors: (string | null)[] = [];
  const projections: (string | null)[] = [];
  const fetcher = vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(options.headers);
    expect(headers.get('x-hd-ssr-key')).toBe('synthetic-home-filter-service-key');
    expect(headers.get('x-hd-cache-protocol')).toBe('2');
    expect(headers.has('cookie')).toBe(false);
    if (url.pathname === '/internal/public-catalog/version') {
      expect(url.search).toBe('?priceView=usd&scope=filters');
      const visitor = headers.get('x-forwarded-for');
      versionVisitors.push(visitor);
      return Response.json({ data: stamp('a'), meta: { requestId: visitor } }, { headers: responseHeaders });
    }
    expect(url.pathname).toBe('/internal/public-catalog/vehicle-filters');
    expect(headers.get('x-hd-catalog-scope')).toBe('filters');
    expect(headers.has('x-forwarded-for')).toBe(false);
    projections.push(url.searchParams.get('projection'));
    return Response.json({ data: facets, meta: { requestId: 'resource', catalogCache: stamp('a') } },
      { headers: responseHeaders });
  });
  vi.stubGlobal('fetch', fetcher);

  const first = await Promise.all(getSsrPublicHomeFilters('zh'));
  expect(first.map(value => value.meta.requestId)).toEqual(['203.0.113.7', '203.0.113.7']);
  request.visitor = '203.0.113.8';
  const warm = await Promise.all(getSsrPublicHomeFilters('zh'));
  expect(warm.map(value => value.meta.requestId)).toEqual(['203.0.113.8', '203.0.113.8']);
  expect(versionVisitors).toEqual(['203.0.113.7', '203.0.113.8']);
  expect(projections.sort()).toEqual(['home-models', 'overview']);
});

it('a conflicting resource retries with a fresh live version without retrying the sibling resource', async () => {
  const counts = { versions: 0, overview: 0, models: 0 };
  const fetcher = vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/internal/public-catalog/version') {
      expect(new Headers(options.headers).get('x-forwarded-for')).toBe(request.visitor);
      const attempt = ++counts.versions;
      return Response.json({ data: stamp(attempt === 1 ? 'a' : 'b'), meta: { requestId: 'version-' + attempt } },
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

  const [overview, models] = await Promise.all(getSsrPublicHomeFilters('zh'));
  expect(overview.meta.requestId).toBe('version-2');
  expect(models.meta.requestId).toBe('version-1');
  expect(counts).toEqual({ versions: 2, overview: 2, models: 1 });
});
