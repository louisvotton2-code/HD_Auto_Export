import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/routing';

afterEach(() => vi.unstubAllEnvs());

async function configure(enabled: boolean | 'static') {
  vi.stubEnv('SITE_INDEXABLE', String(enabled));
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://seo.example.com');
  vi.resetModules();
  return import('./page-seo');
}

describe('public search metadata', () => {
  it('keeps a closed site noindex and shares a canonical localized route', async () => {
    const { pageMetadata } = await configure(false);
    const metadata = pageMetadata({ locale: 'ru', path: '/cars/', title: 'Автомобили из Китая' });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBe('https://seo.example.com/ru/cars/');
  });

  it('only advertises eligible vehicle languages and selects a valid default', async () => {
    const { pageMetadata } = await configure(true);
    const path = '/cars/qualified/';
    const languages: Locale[] = ['zh', 'en'];
    const details = { path, title: 'Selected car', languages };
    const accepted = pageMetadata({ ...details, locale: 'en' });
    expect(accepted).toMatchObject({
      robots: { index: true, follow: true },
      alternates: { canonical: 'https://seo.example.com/en/cars/qualified/', languages: {
        'zh-Hans': 'https://seo.example.com/zh/cars/qualified/',
        en: 'https://seo.example.com/en/cars/qualified/',
        'x-default': 'https://seo.example.com/zh/cars/qualified/',
      } },
      openGraph: { url: 'https://seo.example.com/en/cars/qualified/', locale: 'en_US', alternateLocale: ['zh_CN'] },
    });
    expect(pageMetadata({ ...details, locale: 'ru' })).toMatchObject({
      robots: { index: false, follow: false }, alternates: { languages: {} },
    });
  });

  it('omits alternates on filtered pages and escapes structured text within script tags', async () => {
    const { jsonLdText, pageMetadata } = await configure(true);
    const filtered = pageMetadata({ locale: 'zh', path: '/cars/', title: '汽车目录', eligible: false });
    expect(filtered).toMatchObject({ robots: { index: false, follow: false }, alternates: {
      canonical: 'https://seo.example.com/zh/cars/', languages: {},
    } });
    const unsafe = { name: '</script><script>alert(1)</script>' };
    const safe = jsonLdText(unsafe);
    expect(safe).not.toContain('<');
    expect(JSON.parse(safe)).toEqual(unsafe);
  });

  it('keeps static search eligibility, robots and sitemap on the same paths without reading vehicle SEO', async () => {
    const { pageMetadata } = await configure('static');
    const robots = (await import('@/app/robots')).default();
    const manifest = vi.fn().mockRejectedValue(new Error('Vehicle SEO is disabled'));
    vi.doMock('@/modules/vehicles/server', () => ({ getPublicSeoManifest: manifest }));
    try {
      const response = await (await import('@/app/sitemap.xml/route')).GET();
      expect(response.status).toBe(200);
      expect(manifest).not.toHaveBeenCalled();
      const xml = await response.text();
      const advertised = [...xml.matchAll(/<loc>https:\/\/seo\.example\.com([^<]+)<\/loc>/g)]
        .map((match) => match[1]).sort();
      expect(advertised).toEqual(['/en/about/', '/en/buy/', '/ru/about/', '/ru/buy/', '/zh/about/', '/zh/buy/']);
      expect(robots.rules).toMatchObject({
        disallow: '/',
        allow: expect.arrayContaining([...advertised.map((path) => `${path}$`), '/sitemap-*.xml$', '/flags/']),
      });
      for (const path of ['/about/', '/buy/']) {
        expect(pageMetadata({ path, locale: 'ru', title: 'Title' })).toMatchObject({
          robots: { index: true, follow: true },
          alternates: { canonical: `https://seo.example.com/ru${path}`, languages: {
            'zh-Hans': `https://seo.example.com/zh${path}`, en: `https://seo.example.com/en${path}`,
            ru: `https://seo.example.com/ru${path}`, 'x-default': `https://seo.example.com/ru${path}`,
          } },
        });
      }
      for (const path of ['/', '/cars/', '/cars/qualified/', '/calculator/russia/']) {
        expect(pageMetadata({ path, locale: 'ru', title: 'Title' }).robots).toEqual({ index: false, follow: false });
      }
    } finally {
      vi.doUnmock('@/modules/vehicles/server');
    }
  });

  it('publishes only manifest locales and rejects an oversized fallback sitemap', async () => {
    await configure(true);
    const { buildSitemapXml } = await import('./public-sitemap');
    const item = { path: '/cars/qualified/', locales: ['en', 'ru'] as const, lastModified: '2026-11-21T00:00:00Z' };
    const xml = buildSitemapXml([item]);
    expect(xml).toContain('<loc>https://seo.example.com/en/cars/qualified/</loc>');
    expect(xml).toContain('<loc>https://seo.example.com/ru/cars/qualified/</loc>');
    expect(xml).not.toContain('/zh/cars/');
    expect(xml).toContain('hreflang="x-default" href="https://seo.example.com/ru/cars/qualified/"');
    expect(xml).toContain('<lastmod>2026-11-21T00:00:00Z</lastmod>');
    expect(() => buildSitemapXml(Array.from({ length: 5001 }, () => item))).toThrow('URL limit');
  });
});
