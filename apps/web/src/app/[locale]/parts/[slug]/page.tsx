import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { localizedAlternates } from '@/shared/config/site';
import { PartDetail, partsContent, partHref, parsePartQuantity } from '@/modules/parts';
import { getPart, listParts } from '@/modules/parts/server';

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const dynamicParams = true;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const part = await getPart(slug);
  if (!part) return { robots: { index: false, follow: false } };
  return { title: `${part.oem} · ${part.name[locale]}`, description: partsContent[locale].fitmentBody,
    robots: { index: false, follow: false }, alternates: { canonical: partHref(locale, part.slug), languages: localizedAlternates(`/parts/${part.slug}/`) } };
}
export default async function PartPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const part = await getPart(slug);
  if (!part) notFound();
  const quantityValue = (await searchParams).quantity;
  const quantity = quantityValue === undefined ? 1 : parsePartQuantity(quantityValue);
  if (quantity === null) notFound();
  const all = await listParts();
  const related = all.filter((item) => item.slug !== part.slug && item.category === part.category).slice(0, 4);
  return <PartDetail key={`${part.slug}:${quantity}`} part={part} locale={locale} related={related} knownPartIds={all.map((item) => item.slug)} initialQuantity={quantity} />;
}
