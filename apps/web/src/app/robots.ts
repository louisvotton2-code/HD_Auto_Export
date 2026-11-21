import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { siteConfig, staticSearchPaths } from '@/shared/config/site';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  if (siteConfig.staticIndexable) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
        allow: [
          '/sitemap.xml$', '/sitemap-*.xml$', '/_next/static/', '/brand/', '/flags/', '/fonts/', '/media/about/',
          ...staticSearchPaths.flatMap((path) => routing.locales.map((locale) => `/${locale}${path}$`)),
        ],
      },
      sitemap: `${siteConfig.origin}/sitemap.xml`,
    };
  }
  return {
    rules: siteConfig.indexable
      ? { userAgent: '*', allow: '/', disallow: ['/api/', '/internal/', '/admin/', '/staff/'] }
      : { userAgent: '*', disallow: '/' },
    sitemap: `${siteConfig.origin}/sitemap.xml`,
  };
}
