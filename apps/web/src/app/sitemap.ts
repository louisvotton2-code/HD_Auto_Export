import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { countries } from '@/modules/calculator/config/countries';
import { getPublicCatalog, PublicApiError } from '@/modules/vehicles/server';
import { routing } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  if (!siteConfig.indexable) return [];
  const result: MetadataRoute.Sitemap = routing.locales.flatMap((locale) => [
    { url: `${siteConfig.origin}/${locale}/`, changeFrequency: 'monthly' as const, priority: 1 },
    {
      url: `${siteConfig.origin}/${locale}/buy/`,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    },
    ...countries.map((country) => ({
      url: `${siteConfig.origin}/${locale}/calculator/${country.slug}/`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ]);
  for (const locale of routing.locales) {
    let hasMore = true;
    for (let page = 1; hasMore && page <= 100; page++) {
      const list = await getPublicCatalog({ locale, catalog: 'curated', page, pageSize: 48 });
      for (const vehicle of list.data.items) {
        if (vehicle.source.kind !== 'manual' || vehicle.availability !== 'available') continue;
        result.push({
          url: new URL(vehicle.detailPath, siteConfig.origin).href,
          lastModified: vehicle.publishedAt,
          changeFrequency: 'daily',
          priority: 0.6,
        });
      }
      hasMore = list.data.hasMore;
    }
    if (hasMore) throw new PublicApiError(503); // Never publish a silently truncated sitemap.
  }
  return result;
}
