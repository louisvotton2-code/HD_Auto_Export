import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { SiteHeader } from '@/shared/ui/site-header';
import { SiteFooter } from '@/shared/ui/site-footer';
import { InteractionMotion } from '@/shared/ui/interaction-motion';
import { PublicNavigationFreshness } from '@/shared/ui/public-navigation-freshness';
import { getShellMessages } from '@/i18n/client-messages';
import '../globals.css';
import '@/shared/ui/brand.css';
import '@/shared/ui/navigation.css';
import '@/modules/calculator/ui/calculator-refinement.css';
import '@/modules/calculator/ui/reference-calculator.css';
import '@/shared/ui/interaction-motion.css';

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'Meta' });
  return {
    metadataBase: new URL(siteConfig.origin),
    title: { default: t('title'), template: '%s' },
    description: t('description'),
    robots: { index: siteConfig.indexable, follow: siteConfig.indexable },
    applicationName: siteConfig.name,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = getShellMessages(await getMessages());
  return (
    <html lang={locale === 'zh' ? 'zh-Hans' : locale} data-scroll-behavior="smooth">
      <body>
        <NextIntlClientProvider messages={messages}>
          <div className="site-navigation-progress" aria-hidden="true" />
          <a href="#main" className="skip-link">
            {locale === 'zh'
              ? '跳至主要内容'
              : locale === 'ru'
                ? 'К основному содержимому'
                : 'Skip to content'}
          </a>
          <SiteHeader />
          {children}
          <SiteFooter />
          <InteractionMotion />
          <PublicNavigationFreshness />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
