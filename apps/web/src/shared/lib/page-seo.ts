import type { Metadata } from 'next';
import { routing, type Locale } from '@/i18n/routing';
import { siteConfig, staticSearchPaths } from '@/shared/config/site';

const searchLanguage = { zh: 'zh-Hans', en: 'en', ru: 'ru' } satisfies Record<Locale, string>;
const socialLanguage = { zh: 'zh_CN', en: 'en_US', ru: 'ru_RU' } satisfies Record<Locale, string>;

export function localizedPageUrl(locale: Locale, path: string) {
  return new URL(`/${locale}${path}`, siteConfig.origin).href;
}

export function seoLanguageLinks(path: string, languages: readonly Locale[] = routing.locales): Record<string, string> {
  const preferred = languages.includes(routing.defaultLocale)
    ? routing.defaultLocale
    : routing.locales.find((locale) => languages.includes(locale));
  if (!preferred) return {};
  return {
    ...Object.fromEntries(languages.map((locale) => [searchLanguage[locale], localizedPageUrl(locale, path)])),
    'x-default': localizedPageUrl(preferred, path),
  };
}

type PageSeo = {
  locale: Locale;
  path: string;
  title: string;
  description?: string;
  eligible?: boolean;
  languages?: readonly Locale[];
  image?: { src: string; width?: number; height?: number };
};

export function pageMetadata({
  locale, path, title, description, eligible = true, languages = routing.locales,
  image = siteConfig.brand.logo,
}: PageSeo): Metadata {
  const indexable = siteConfig.indexable || (siteConfig.staticIndexable && staticSearchPaths.includes(path));
  const index = indexable && eligible && languages.includes(locale);
  const canonical = localizedPageUrl(locale, path);
  return {
    title,
    description,
    robots: { index, follow: index },
    alternates: { canonical, languages: eligible && languages.includes(locale) ? seoLanguageLinks(path, languages) : {} },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: siteConfig.name,
      locale: socialLanguage[locale],
      alternateLocale: eligible ? languages.filter((candidate) => candidate !== locale).map((candidate) => socialLanguage[candidate]) : [],
      images: [{ url: new URL(image.src, siteConfig.origin).href, width: image.width, height: image.height, alt: title }],
    },
  };
}

export function publicPageSchema(locale: Locale, path: string, title: string,
  type: 'WebSite' | 'WebPage' | 'AboutPage' | 'CollectionPage' | 'WebApplication',
  description?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    name: title,
    description,
    url: localizedPageUrl(locale, path),
    inLanguage: searchLanguage[locale],
    ...(type === 'WebSite' || type === 'AboutPage' ? {
      publisher: {
        '@type': 'Organization',
        name: siteConfig.name,
        url: siteConfig.origin,
        logo: new URL(siteConfig.brand.logo.src, siteConfig.origin).href,
        sameAs: [siteConfig.contacts.facebook.href, siteConfig.contacts.instagram.href],
      },
    } : {}),
  };
}

export function jsonLdText(data: object) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
