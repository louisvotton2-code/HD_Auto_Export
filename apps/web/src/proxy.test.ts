import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

afterEach(() => vi.unstubAllGlobals());

describe('standalone gateway error document boundary', () => {
  it.each(['zh', 'en', 'ru'])('provides the exact %s fallback without upstream reads or request data', async locale => {
    const fetch = vi.fn(() => { throw new Error('Error documents must not read upstream'); });
    vi.stubGlobal('fetch', fetch);
    const result = proxy(new NextRequest(`http://localhost/404/${locale}/?vehicle=PRIVATE_SENTINEL`, {
      headers: { Cookie: 'private-session', Authorization: 'Bearer private-token' },
    }));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-robots-tag')).toContain('noindex');
    const html = await result.text();
    expect(html).toContain(`<html lang="${locale === 'zh' ? 'zh-Hans' : locale}">`);
    expect(html).toContain('<main id="main">');
    expect(html).not.toMatch(/PRIVATE_SENTINEL|private-session|private-token|<script/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not turn malformed or extended error paths into successful documents', () => {
    for (const path of ['/404/fr/', '/404/en/extra/', '/404/ru', '/404/'])
      expect(proxy(new NextRequest(`http://localhost${path}`)).status).toBe(404);
    expect(proxy(new NextRequest('http://localhost/404/en/', { method: 'POST' })).status).toBe(405);
    expect(proxy(new NextRequest('http://localhost/404/en/', { method: 'HEAD' })).status).toBe(200);
  });

  it('leaves real locale, API, preview and RSC request processing with Next', () => {
    for (const path of ['/en/cars/unknown/', '/ru/cars/', '/api/v1/vehicles/unknown/', '/staff/vehicles/unknown/publication-preview']) {
      const result = proxy(new NextRequest(`http://localhost${path}`, { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } }));
      expect(result.headers.get('x-middleware-next')).toBe('1');
    }
    expect(proxy(new NextRequest('http://localhost/fr/calculator/russia/')).status).toBe(404);
  });
});
