import type { Metadata } from 'next';
import type { PublicVehicleQuery } from '@hd/contracts/public';
import { Suspense } from 'react';
import { connection } from 'next/server';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { CatalogOffsetLimitNotice, parseCatalogPageRequest, PublicVehicleList, publicVehicleMessages, VehicleRouteLoading } from '@/modules/vehicles';
import {
  getPublicCatalog,
  getPublicFilters,
  publicRetryAfter,
} from '@/modules/vehicles/server';
import { localizedAlternates } from '@/shared/config/site';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = publicVehicleMessages(locale);
  return {
    title: t.title,
    // Curated discovery can contain demonstration samples; keep it out of indexing this phase.
    robots: { index: false, follow: false },
    alternates: { canonical: `/${locale}/cars/`, languages: localizedAlternates('/cars/') },
  };
}
export default async function CarsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const request = parseCatalogPageRequest(await searchParams, locale);
  if (!request) notFound();
  if (request.kind === 'offset_limit') return <CatalogOffsetLimitNotice locale={locale} query={request.query} />;
  const { query } = request;
  return (
    <Suspense fallback={<VehicleRouteLoading locale={locale} kind="catalog" />}>
      <CatalogContents locale={locale} query={query} />
    </Suspense>
  );
}

async function CatalogContents({ locale, query }: { locale: Locale; query: PublicVehicleQuery }) {
  const [result, filters] = await Promise.allSettled([
    getPublicCatalog(query),
    getPublicFilters(locale, query),
  ]);
  return (
    <PublicVehicleList
      key={locale}
      locale={locale}
      query={query}
      result={result.status === 'fulfilled' ? result.value : null}
      filters={filters.status === 'fulfilled' ? filters.value.data : null}
      error={result.status === 'rejected'}
      initialRetryAfter={publicRetryAfter(result, filters)}
    />
  );
}
