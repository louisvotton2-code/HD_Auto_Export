import { countries } from '@/modules/calculator/config/countries';
import { getPublicSeoManifest } from '@/modules/vehicles/server';
import { routing } from '@/i18n/routing';
import { siteConfig, staticSearchPaths } from '@/shared/config/site';
import { buildSitemapXml, type SitemapEntry } from '@/shared/lib/public-sitemap';

export const dynamic = 'force-dynamic';

const basePages = ['/', '/cars/', '/buy/', '/about/', '/market-prices/', ...countries.map((country) => `/calculator/${country.slug}/`)];
const unavailable = () => new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });

export async function GET() {
  try {
    const entries: SitemapEntry[] = [];
    let validUntil: string | null = null;
    if (siteConfig.staticIndexable) {
      for (const path of staticSearchPaths) entries.push({ path, locales: routing.locales });
    }
    if (siteConfig.indexable) {
      const vehicles = await getPublicSeoManifest();
      if (vehicles !== null) {
        validUntil = vehicles.validUntil;
        for (const path of basePages) entries.push({ path, locales: routing.locales });
        entries.push(...vehicles.items.map(({ id, locales, lastModified }) => ({
          path: `/cars/${id}/`, locales, lastModified,
        })));
      }
    }
    const xml = buildSitemapXml(entries);
    if (validUntil !== null && Date.parse(validUntil) <= Date.now()) return unavailable();
    return new Response(xml, { headers: {
      'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store',
    } });
  } catch {
    // The production gateway serves sharded generations atomically. If the live
    // fallback cannot produce a complete set, do not publish partial URLs.
    return unavailable();
  }
}
