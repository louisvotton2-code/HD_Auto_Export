import type { MetadataRoute } from 'next';
import { siteConfig } from '@/shared/config/site';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: siteConfig.indexable
      ? { userAgent: '*', allow: '/', disallow: '/api/' }
      : { userAgent: '*', disallow: '/' },
    sitemap: `${siteConfig.origin}/sitemap.xml`,
  };
}
