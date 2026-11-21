import type { Locale } from '@/i18n/routing';
import { localizedPageUrl, seoLanguageLinks } from './page-seo';

export type SitemapEntry = { path: string; locales: readonly Locale[]; lastModified?: string };

const maxUrls = 10_000;
const maxBytes = 50 * 1024 * 1024;

function xml(value: string) {
  const entities: Record<string, string> = { '&': '&amp;', '"': '&quot;', "'": '&apos;', '<': '&lt;', '>': '&gt;' };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function buildSitemapXml(entries: readonly SitemapEntry[]) {
  if (entries.reduce((sum, entry) => sum + entry.locales.length, 0) > maxUrls)
    throw new Error('Sitemap exceeds the single-file URL limit');
  const urls = entries.flatMap(({ path, locales, lastModified }) => {
    const links = Object.entries(seoLanguageLinks(path, locales))
      .map(([language, href]) => `<xhtml:link rel="alternate" hreflang="${xml(language)}" href="${xml(href)}"/>`)
      .join('');
    const lastmod = lastModified ? `<lastmod>${xml(lastModified)}</lastmod>` : '';
    return locales.map((locale) => `<url><loc>${xml(localizedPageUrl(locale, path))}</loc>${links}${lastmod}</url>`);
  }).join('');
  const document = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`;
  if (Buffer.byteLength(document, 'utf8') > maxBytes) throw new Error('Sitemap exceeds the uncompressed byte limit');
  return document;
}
