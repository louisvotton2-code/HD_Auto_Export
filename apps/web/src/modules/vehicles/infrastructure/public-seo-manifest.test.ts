import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicSeoManifest } from '@hd/contracts/public';
import { getPublicSeoManifest } from './public-api';

const first = { id: '00000000-0000-4000-8000-000000000001', locales: ['zh', 'ru'] as const };
const second = { id: 'ext-00000000-0000-4000-8000-000000000002', locales: ['en'] as const };
const now = new Date('2026-11-21T00:00:00Z');
const expiry = '2026-11-21T00:01:00Z';

function manifest(patch: Partial<PublicSeoManifest> = {}) {
  return new Response(JSON.stringify({
    data: { enabled: true, revision: 'v1', validUntil: expiry, items: [], nextCursor: null, ...patch },
    meta: { requestId: 'seo-fixture' },
  }), { headers: { 'Content-Type': 'application/json' } });
}

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('VEHICLE_API_TRUST_PROXY_IP', 'false');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('SEO manifest pagination', () => {
  it('returns a complete revision and validates the supplied expiry', async () => {
    const fetcher = setup();
    const items = [first, second].map((item) => ({ ...item, locales: [...item.locales], lastModified: now.toISOString() }));
    fetcher.mockResolvedValueOnce(manifest({ items: [items[0]], nextCursor: 'next' }))
      .mockResolvedValueOnce(manifest({ items: [items[1]] }));
    await expect(getPublicSeoManifest()).resolves.toEqual({ items, validUntil: expiry });
    expect(fetcher.mock.calls[1][0]).toContain('cursor=next');
  });

  it.each([{ validUntil: '2026-11-20T23:59:59Z' }, { validUntil: null }, { revision: 'v2' }])
    ('does not publish a partial revision when the next page changes its validity', async patch => {
      const fetcher = setup();
      fetcher.mockResolvedValueOnce(manifest({ nextCursor: 'next' })).mockResolvedValueOnce(manifest(patch));
      await expect(getPublicSeoManifest()).rejects.toMatchObject({ status: 503 });
    });
});
