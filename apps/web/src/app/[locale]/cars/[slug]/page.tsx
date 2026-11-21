import type { Metadata } from 'next';
import { connection } from 'next/server';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { DetailScrollTop } from '@/shared/ui/detail-scroll-top';
import { getConfiguredPixelId } from '@/modules/analytics/server';
import { publicVehicleMessages } from '@/modules/vehicles';
import { countries } from '@/modules/calculator/config/countries';
import { getPublicVehicleById, PublicApiError, vehicleSeoPresentation, vehicleStructuredData } from '@/modules/vehicles/server';
import { siteConfig } from '@/shared/config/site';
import { pageMetadata } from '@/shared/lib/page-seo';
import { JsonLd } from '@/shared/ui/json-ld';
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
  const includePixel = Boolean(getConfiguredPixelId());
  let vehicle;
  try {
    vehicle = await getPublicVehicleById(slug, locale, includePixel, siteConfig.indexable);
  } catch (error) {
    if (error instanceof PublicApiError)
      return {
        locale,
        slug,
        includePixel,
        vehicle: null,
        retryAfter: error.status === 429 ? Number(error.retryAfter ?? 60) : 0,
      };
    throw error;
  }
  if (!vehicle) notFound();
  return { locale, slug, vehicle, includePixel, retryAfter: 0 };
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, vehicle } = await load(params);
  if (!vehicle)
    return {
      title: publicVehicleMessages(locale).unavailable,
      robots: { index: false, follow: false },
    };
  return pageMetadata(vehicleSeoPresentation(vehicle, locale));
}
export default async function CarPage({ params }: Props) {
  const { locale, slug, vehicle, includePixel, retryAfter } = await load(params);
  setRequestLocale(locale);
  // Resolve primary SSR content before returning; it must not require a client-side reveal.
  const t = await getTranslations({ locale, namespace: 'Countries' });
  const calculatorMessages = getVehicleCalculatorMessages(await getMessages());
  const seo = siteConfig.indexable && vehicle ? vehicleSeoPresentation(vehicle, locale) : null;
  return (
    <ScopedMessagesProvider messages={calculatorMessages}>
      {vehicle && seo?.eligible && <JsonLd data={vehicleStructuredData(vehicle, seo)} />}
      <DetailScrollTop path={`${locale}:${slug}`} />
      <VehicleDetailPage
        key={`${locale}:${slug}`}
        locale={locale}
        vehicle={vehicle}
        id={slug}
        includePixel={includePixel}
        includeSeo={siteConfig.indexable}
        initialRetryAfter={retryAfter}
        initialDate={getClearanceDate(new Date())}
        initialRates={createReferenceSnapshot()}
        destinations={countries.map((country) => ({ slug: country.slug, label: t(country.code), flag: country.flag }))}
      />
    </ScopedMessagesProvider>
  );
}
