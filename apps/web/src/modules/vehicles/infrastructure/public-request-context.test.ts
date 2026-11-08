import { afterEach, describe, expect, it, vi } from 'vitest';
import { headers } from 'next/headers';
import { publicRequestHeaders, trustedVisitorHeaders } from './public-request-context';
import { requestPublicApi, publicRetryAfter, PublicApiError } from './public-api';
import { proxyPublicRequest } from './public-proxy';
import { retryAfterSeconds } from '@/shared/lib/retry-after';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('opt-in visitor identity and public rate limits', () => {
  it('preserves the longest initial 429 delay when only a parallel facets read is limited', () => {
    const ok = { status: 'fulfilled', value: {} } as const;
    expect(publicRetryAfter(ok, { status: 'rejected', reason: new PublicApiError(429, '2') })).toBe(
      2,
    );
    expect(
      publicRetryAfter(
        { status: 'rejected', reason: new PublicApiError(429, '4') },
        { status: 'rejected', reason: new PublicApiError(429, '2') },
      ),
    ).toBe(4);
    expect(publicRetryAfter(ok, { status: 'rejected', reason: new PublicApiError(503) })).toBe(0);
  });
  it('ignores even the dedicated header by default, without reading SSR headers', async () => {
    const incoming = new Headers({
      'X-HD-Visitor-IP': '198.51.100.42',
      'X-Forwarded-For': '203.0.113.8',
    });
    expect(trustedVisitorHeaders(incoming)).toEqual({});
    expect(await publicRequestHeaders()).toEqual({});
    expect(headers).not.toHaveBeenCalled();
  });
  it.each(['198.51.100.42', '2001:db8::42'])(
    'constructs a single validated value from a private gateway: %s',
    (ip) => {
      vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'true');
      const incoming = new Headers({
        'X-HD-Visitor-IP': ip,
        'X-Forwarded-For': '203.0.113.8, 192.0.2.9',
        Forwarded: 'for=192.0.2.9',
        Cookie: 'private=1',
        Authorization: 'Bearer private',
      });
      expect(trustedVisitorHeaders(incoming)).toEqual({ 'X-Forwarded-For': ip });
    },
  );
  it('does not trust alternate headers, IP lists, ports, zones or malformed dedicated values', () => {
    vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'true');
    for (const value of [
      '',
      'unknown',
      '198.51.100.1, 198.51.100.2',
      '198.51.100.1:80',
      '[2001:db8::1]',
      'fe80::1%eth0',
      '198.51.100.999',
    ])
      expect(trustedVisitorHeaders(new Headers({ 'X-HD-Visitor-IP': value }))).toEqual({});
    expect(
      trustedVisitorHeaders(
        new Headers({ 'X-Forwarded-For': '198.51.100.1', 'X-Real-IP': '198.51.100.1' }),
      ),
    ).toEqual({});
  });
  it('obtains the dedicated identity from the request context during SSR', async () => {
    vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'true');
    vi.mocked(headers).mockResolvedValue(
      new Headers({ 'X-HD-Visitor-IP': '198.51.100.42' }) as Awaited<ReturnType<typeof headers>>,
    );
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    await requestPublicApi('/api/v1/home/vehicles?locale=en', fetcher);
    expect(fetcher.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json, image/*;q=0.9',
      'X-Forwarded-For': '198.51.100.42',
    });
  });
  it('uses the same validation for BFF media without forwarding browser credentials', async () => {
    vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'true');
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/webp' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPublicRequest(
      new Request('http://web.test/api/v1/media/image/', {
        headers: {
          'X-HD-Visitor-IP': '198.51.100.42',
          'X-Forwarded-For': '192.0.2.1',
          Cookie: 'private=1',
        },
      }),
      ['media', 'image'],
    );
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json, image/*;q=0.9',
      'X-Forwarded-For': '198.51.100.42',
    });
    expect(response.headers.get('x-forwarded-for')).toBeNull();
  });
  it.each(['home/vehicles', 'vehicles', 'media/image'])(
    'keeps 429 and a bounded Retry-After for %s',
    async (path) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('private upstream details', {
            status: 429,
            headers: { 'Retry-After': '2', 'Set-Cookie': 'private=1', 'X-Internal': 'private' },
          }),
        ),
      );
      const response = await proxyPublicRequest(
        new Request(
          `http://web.test/api/v1/${path}/?${path.startsWith('media') ? '' : 'locale=en'}`,
        ),
        path.split('/'),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('2');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('x-internal')).toBeNull();
      const json = await response.json();
      expect(json.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
      expect(JSON.stringify(json)).not.toContain('private');
      expect(json.data).toBeUndefined();
    },
  );
  it('bounds retry delta-seconds and uses a safe default for invalid values', () => {
    for (const value of [
      null,
      undefined,
      '',
      '-1',
      '1.5',
      '999999',
      'Wed, 01 Jan 2030 00:00:00 GMT',
    ])
      expect(retryAfterSeconds(value)).toBe(60);
    expect(retryAfterSeconds('2')).toBe(2);
    expect(retryAfterSeconds('0')).toBe(0);
    expect(retryAfterSeconds('3600')).toBe(3600);
  });
});
