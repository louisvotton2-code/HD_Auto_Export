import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { siteConfig } from '@/shared/config/site';
import { publicVehicleDocumentFailure } from '@/app/[locale]/cars/[slug]/document-status';

vi.mock('@/app/[locale]/cars/[slug]/document-status', () => ({ publicVehicleDocumentFailure: vi.fn() }));
const defaultIndexable = siteConfig.indexable;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(publicVehicleDocumentFailure).mockReset();
  siteConfig.indexable = defaultIndexable;
});

describe('standalone gateway error document boundary', () => {
  it.each(['zh', 'en', 'ru'])('provides the exact %s fallback without upstream reads or request data', async locale => {
    const fetch = vi.fn(() => { throw new Error('Error documents must not read upstream'); });
    vi.stubGlobal('fetch', fetch);
    const result = await proxy(new NextRequest(`http://localhost/404/${locale}/?vehicle=PRIVATE_SENTINEL`, {
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

  it('does not turn malformed or extended error paths into successful documents', async () => {
    for (const path of ['/404/fr/', '/404/en/extra/', '/404/ru', '/404/'])
      expect((await proxy(new NextRequest(`http://localhost${path}`))).status).toBe(404);
    expect((await proxy(new NextRequest('http://localhost/404/en/', { method: 'POST' }))).status).toBe(405);
    expect((await proxy(new NextRequest('http://localhost/404/en/', { method: 'HEAD' }))).status).toBe(200);
  });

  it('leaves real locale, API, preview and RSC request processing with Next', async () => {
    siteConfig.indexable = true;
    for (const path of ['/en/cars/unknown/', '/ru/cars/', '/api/v1/vehicles/unknown/', '/staff/vehicles/unknown/publication-preview']) {
      const result = await proxy(new NextRequest(`http://localhost${path}?_rsc=abc`, {
        headers: { Accept: '*/*', 'Sec-Fetch-Dest': 'empty', RSC: '1', 'Next-Router-Prefetch': '1' },
      }));
      expect(result.headers.get('x-middleware-next')).toBe('1');
    }
    expect(publicVehicleDocumentFailure).not.toHaveBeenCalled();
    expect((await proxy(new NextRequest('http://localhost/fr/calculator/russia/'))).status).toBe(404);
  });

  it('leaves browser RSC navigation with Next after internal request markers are removed', async () => {
    siteConfig.indexable = true;
    const result = await proxy(new NextRequest('http://localhost/en/cars/vehicle-1/', {
      headers: { Accept: '*/*', 'Sec-Fetch-Dest': 'empty' },
    }));
    expect(result.headers.get('x-middleware-next')).toBe('1');
    expect(publicVehicleDocumentFailure).not.toHaveBeenCalled();
  });

  it.each([404, 429, 503] as const)
    ('returns a native %s before rendering a public detail document', async (status) => {
      siteConfig.indexable = true;
      const path = '/ru/cars/vehicle-1/';
      vi.mocked(publicVehicleDocumentFailure).mockResolvedValueOnce(status === 404 ? { status } :
        { status, problem: { path, message: 'Данные временно недоступны.', reload: 'Обновить' },
          retryAfter: status === 429 ? '19' : '60' });
      const incoming = new NextRequest('http://localhost/ru/cars/vehicle-1/?campaign=private-value&_rsc=spoof', {
        headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'empty' },
      });
      const result = await proxy(incoming);
      expect(publicVehicleDocumentFailure).toHaveBeenCalledWith('vehicle-1', 'ru', path, incoming.headers);
      expect(result.status).toBe(status);
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(result.headers.get('x-robots-tag')).toContain('noindex');
      expect(result.headers.get('retry-after')).toBe(status === 404 ? null : status === 429 ? '19' : '60');
      const document = await result.text();
      expect(document).toContain('<html lang="ru">');
      expect(document).not.toContain('private-value');
      if (status !== 404) expect(document).toContain('<a href="/ru/cars/vehicle-1/">Обновить</a>');
    });
});
