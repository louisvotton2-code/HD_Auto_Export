import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { BuyingGuidePage } from '@/modules/buying-guide/ui/buying-guide-page';
import { buyingGuideConfig } from '@/modules/buying-guide/config';
import { pageMetadata, publicPageSchema } from '@/shared/lib/page-seo';
import { JsonLd } from '@/shared/ui/json-ld';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'BuyingGuide' });
  return pageMetadata({
    locale, path: '/buy/',
    title: t('metaTitle'),
    description: t('metaDescription', { deposit: buyingGuideConfig.depositUsd }),
  });
}

export default async function BuyPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'BuyingGuide' });
  return <>
    <JsonLd data={publicPageSchema(locale, '/buy/', t('metaTitle'), 'WebPage',
      t('metaDescription', { deposit: buyingGuideConfig.depositUsd }))} />
    <BuyingGuidePage locale={locale} />
  </>;
}
