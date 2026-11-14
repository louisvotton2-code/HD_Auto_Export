import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DestinationCalculatorEntry } from '@/modules/calculator/ui/destination-calculator-entry';
import { countries, type CountryCode } from '@/modules/calculator/config/countries';

export const metadata = { robots: { index: false, follow: true } };

export default async function CalculatorIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Countries' });
  const names = Object.fromEntries(countries.map(country => [country.code, t(country.code)])) as Record<CountryCode, string>;
  return <DestinationCalculatorEntry locale={locale} countryNames={names} />;
}
