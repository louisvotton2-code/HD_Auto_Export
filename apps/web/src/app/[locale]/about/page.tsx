import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { AboutPage } from '@/modules/about/about-page';
import { getAboutContent } from '@/modules/about/content';
import { localizedAlternates } from '@/shared/config/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const copy = getAboutContent(locale);
  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: { canonical: `/${locale}/about/`, languages: localizedAlternates('/about/') },
  };
}

export default async function AboutRoute({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <AboutPage locale={locale} />;
}
