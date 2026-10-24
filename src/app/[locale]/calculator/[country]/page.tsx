import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { countries, getCountryBySlug } from '@/modules/calculator/config/countries';
import { CalculatorPage } from '@/modules/calculator/ui/calculator-page';
import { localizedAlternates } from '@/shared/config/site';
import { fetchExchangeRates } from '@/modules/calculator/infrastructure/exchange-rates.server';

type Props = { params: Promise<{ locale: string; country: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return countries.map((country) => ({ country: country.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, country: slug } = await params;
  const country = getCountryBySlug(slug);
  if (!country || !hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale });
  const name = t(`Countries.${country.code}`);
  const path = `/calculator/${country.slug}`;
  return {
    title: t('Meta.countryTitle', { country: name }),
    description: t('Meta.countryDescription', { country: name }),
    alternates: { canonical: `/${locale}${path}/`, languages: localizedAlternates(`${path}/`) },
  };
}

export default async function CountryCalculator({ params }: Props) {
  const { locale, country: slug } = await params;
  const country = getCountryBySlug(slug);
  if (!country || !hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Initial HTML uses the build date. The browser replaces it with the visit date on mount.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const rates = await fetchExchangeRates();
  return <CalculatorPage country={country} initialDate={today} initialRates={rates} />;
}
