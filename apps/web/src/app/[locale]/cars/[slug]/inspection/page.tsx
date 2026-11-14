import type { Metadata } from 'next';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { PublicVehicleInspectionQuerySchema, type PublicVehicleInspectionResponse } from '@hd/contracts/public';
import { routing } from '@/i18n/routing';
import { localizedAlternates } from '@/shared/config/site';
import { DetailScrollTop } from '@/shared/ui/detail-scroll-top';
import { VehicleInspectionPage, inspectionPageCopy } from '@/modules/vehicles';
import { getPublicVehicleById, getPublicVehicleInspection, PublicApiError } from '@/modules/vehicles/server';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const dynamicParams = true;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return { robots: { index: false, follow: false } };
  const path = `/cars/${slug}/inspection/`;
  return {
    title: inspectionPageCopy[locale].title,
    robots: { index: false, follow: false },
    alternates: { canonical: `/${locale}${path}`, languages: localizedAlternates(path) },
  };
}

/** Only this page reads report details; the ordinary vehicle response carries its own light summary. */
export default async function InspectionPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const raw = await searchParams;
  const allowed = ['category', 'part', 'outcome'];
  if (Object.keys(raw).some(key => !allowed.includes(key) || Array.isArray(raw[key]))) notFound();
  const filters = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== ''));
  const parsed = PublicVehicleInspectionQuerySchema.safeParse({ ...filters, locale, limit: 50, order: 'faults_first' });
  if (!parsed.success) notFound();
  const { category, part, outcome } = parsed.data;
  const vehicle = await getPublicVehicleById(slug, locale);
  if (!vehicle) notFound();
  let initialReport: PublicVehicleInspectionResponse | null = null;
  let initialRetryAfter = 0;
  try {
    initialReport = await getPublicVehicleInspection(slug, locale, { category, part, outcome, order: 'faults_first', limit: 50 });
  } catch (error) {
    if (!(error instanceof PublicApiError)) throw error;
    if (error.status === 404) notFound();
    if (error.status === 429) initialRetryAfter = Number(error.retryAfter ?? 60);
  }
  // Do not stream the necessary report HTML behind a client-revealed Suspense fallback.
  return <>
    <DetailScrollTop path={`${locale}:${slug}:inspection:${category ?? ''}:${part ?? ''}:${outcome ?? ''}`} />
    <VehicleInspectionPage key={`${locale}:${slug}:${category ?? ''}:${part ?? ''}:${outcome ?? ''}`}
      vehicle={vehicle} locale={locale} initialReport={initialReport} initialRetryAfter={initialRetryAfter}
      query={{ category, part, outcome }} />
  </>;
}
