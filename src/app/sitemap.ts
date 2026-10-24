import type { MetadataRoute } from 'next';
import { countries } from '@/modules/calculator/config/countries';
import { routing } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteConfig.indexable) return [];
  return routing.locales.flatMap((locale) => [
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
}
