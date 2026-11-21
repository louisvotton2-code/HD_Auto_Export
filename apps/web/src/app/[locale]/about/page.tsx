import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { AboutPage } from '@/modules/about/about-page';
import { getAboutContent } from '@/modules/about/content';
import { pageMetadata, publicPageSchema } from '@/shared/lib/page-seo';
import { JsonLd } from '@/shared/ui/json-ld';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const copy = getAboutContent(locale);
  return pageMetadata({ locale, path: '/about/', title: copy.metaTitle, description: copy.metaDescription,
    image: { src: '/media/about/company-film.webp' } });
}

export default async function AboutRoute({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const copy = getAboutContent(locale);
  return <>
    <JsonLd data={publicPageSchema(locale, '/about/', copy.metaTitle, 'AboutPage', copy.metaDescription)} />
    <AboutPage locale={locale} />
  </>;
}
