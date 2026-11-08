import type { Metadata } from 'next';
import { connection } from 'next/server';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { PublicDetailResource, publicVehicleMessages } from '@/modules/vehicles';
import { countries } from '@/modules/calculator/config/countries';
import { getPublicVehicleById, PublicApiError } from '@/modules/vehicles/server';
import { localizedAlternates, siteConfig } from '@/shared/config/site';

type Props = { params: Promise<{ locale: string; slug: string }> };
export const dynamicParams = true;
async function load(params: Props['params']) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  await connection();
  let vehicle;
  try {
    vehicle = await getPublicVehicleById(slug, locale);
  } catch (error) {
    if (error instanceof PublicApiError)
      return {
        locale,
        slug,
        vehicle: null,
        retryAfter: error.status === 429 ? Number(error.retryAfter ?? 60) : 0,
      };
    throw error;
  }
  if (!vehicle) notFound();
  return { locale, slug, vehicle, retryAfter: 0 };
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, vehicle } = await load(params);
  if (!vehicle)
    return {
      title: publicVehicleMessages(locale).unavailable,
      robots: { index: false, follow: false },
    };
  const path = `/cars/${vehicle.id}/`;
  const index =
    siteConfig.indexable &&
    vehicle.source.kind === 'manual' &&
    vehicle.availability === 'available';
  return {
    title: vehicle.content.title.text,
    description: vehicle.content.description?.text.slice(0, 300),
    robots: { index, follow: index },
    alternates: { canonical: vehicle.detailPath, languages: localizedAlternates(path) },
  };
}
export default async function CarPage({ params }: Props) {
  const { locale, slug, vehicle, retryAfter } = await load(params);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Countries' });
  return (
    <PublicDetailResource
      key={`${locale}:${slug}`}
      locale={locale}
      vehicle={vehicle}
      id={slug}
      initialRetryAfter={retryAfter}
      destinations={countries.map((country) => ({ slug: country.slug, label: t(country.code) }))}
    />
  );
}
