import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { BuyingGuidePage } from '@/modules/buying-guide/ui/buying-guide-page';
import { buyingGuideConfig } from '@/modules/buying-guide/config';
import { localizedAlternates } from '@/shared/config/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'BuyingGuide' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription', { deposit: buyingGuideConfig.depositUsd }),
    alternates: { canonical: `/${locale}/buy/`, languages: localizedAlternates('/buy/') },
  };
}

export default async function BuyPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <BuyingGuidePage locale={locale} />;
}
