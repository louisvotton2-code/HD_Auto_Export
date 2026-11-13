import type { Metadata } from 'next';
import { Suspense } from 'react';
import { connection } from 'next/server';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { DetailScrollTop } from '@/shared/ui/detail-scroll-top';
import { publicVehicleMessages, VehicleRouteLoading } from '@/modules/vehicles';
import { countries } from '@/modules/calculator/config/countries';
import { getPublicVehicleById, PublicApiError } from '@/modules/vehicles/server';
import { localizedAlternates, siteConfig } from '@/shared/config/site';
import { publicVehicleTitle } from '@/shared/lib/public-vehicle-title';
import { ScopedMessagesProvider } from '@/i18n/scoped-messages-provider';
import { getVehicleCalculatorMessages } from '@/i18n/client-messages';
import { getClearanceDate } from '@/modules/calculator/application/current-date';
import { createReferenceSnapshot } from '@/modules/calculator/infrastructure/exchange-rates';
import { VehicleDetailPage } from './vehicle-detail-page';

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
    title: publicVehicleTitle(vehicle, locale).text,
    description: vehicle.content.description?.text.slice(0, 300),
    robots: { index, follow: index },
    alternates: { canonical: vehicle.detailPath, languages: localizedAlternates(path) },
  };
}
export default async function CarPage({ params }: Props) {
  const loaded = await load(params);
  const { locale, slug } = loaded;
  setRequestLocale(locale);
  // Keep existence checks above Suspense: the gateway relies on genuine upstream 404 responses.
  return (
    <>
      <DetailScrollTop path={`${locale}:${slug}`} />
      <Suspense fallback={<VehicleRouteLoading locale={locale} kind="detail" />}>
        <DetailContents loaded={loaded} />
      </Suspense>
    </>
  );
}

async function DetailContents({ loaded }: { loaded: Awaited<ReturnType<typeof load>> }) {
  const { locale, slug, vehicle, retryAfter } = loaded;
  const t = await getTranslations({ locale, namespace: 'Countries' });
  const calculatorMessages = getVehicleCalculatorMessages(await getMessages());
  return (
    <ScopedMessagesProvider messages={calculatorMessages}>
      <VehicleDetailPage
        key={`${locale}:${slug}`}
        locale={locale}
        vehicle={vehicle}
        id={slug}
        initialRetryAfter={retryAfter}
        initialDate={getClearanceDate(new Date())}
        initialRates={createReferenceSnapshot()}
        destinations={countries.map((country) => ({ slug: country.slug, label: t(country.code), flag: country.flag }))}
      />
    </ScopedMessagesProvider>
  );
}
