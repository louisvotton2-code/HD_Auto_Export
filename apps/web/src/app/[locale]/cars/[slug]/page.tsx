import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { getVehicleBySlug, getVehicles, vehicleMessages, VehicleDetail } from '@/modules/vehicles';
import { localizedAlternates } from '@/shared/config/site';

type Props = { params: Promise<{ locale: string; slug: string }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return getVehicles().map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const vehicle = getVehicleBySlug(slug);
  if (!hasLocale(routing.locales, locale) || !vehicle) return {};
  const path = `/cars/${slug}/`;
  return {
    title: `${vehicle.make} ${vehicle.model} · ${vehicleMessages(locale).demo}`,
    description: vehicleMessages(locale).description,
    robots: { index: false, follow: false },
    alternates: { canonical: `/${locale}${path}`, languages: localizedAlternates(path) },
  };
}
export default async function CarPage({ params }: Props) {
  const { locale, slug } = await params;
  const vehicle = getVehicleBySlug(slug);
  if (!hasLocale(routing.locales, locale) || !vehicle) notFound();
  setRequestLocale(locale);
  return <VehicleDetail locale={locale} vehicle={vehicle} />;
}
