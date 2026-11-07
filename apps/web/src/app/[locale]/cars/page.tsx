import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { getVehicles, vehicleMessages, VehicleList } from '@/modules/vehicles';
import { localizedAlternates } from '@/shared/config/site';

type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = vehicleMessages(locale);
  return {
    title: t.titleMeta,
    description: t.notice,
    robots: { index: false, follow: false },
    alternates: { canonical: `/${locale}/cars/`, languages: localizedAlternates('/cars/') },
  };
}
export default async function CarsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <VehicleList locale={locale} initialVehicles={getVehicles()} />;
}
