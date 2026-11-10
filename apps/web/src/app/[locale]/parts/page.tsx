import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { localizedAlternates } from '@/shared/config/site';
import { PartsCatalog, partsContent, parsePartsQuery } from '@/modules/parts';
import { listParts } from '@/modules/parts/server';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return { title: partsContent[locale].catalog, description: partsContent[locale].metaDescription,
    robots: { index: false, follow: false }, alternates: { canonical: `/${locale}/parts/`, languages: localizedAlternates('/parts/') } };
}
export default async function PartsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const parsed = parsePartsQuery(await searchParams);
  return <PartsCatalog locale={locale} parts={await listParts()} initialQuery={parsed.query} invalid={parsed.invalid} />;
}
