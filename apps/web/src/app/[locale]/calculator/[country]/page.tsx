import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { ScopedMessagesProvider } from '@/i18n/scoped-messages-provider';
import { routing } from '@/i18n/routing';
import { getCalculatorCountryMessages } from '@/i18n/client-messages';
import { countries, getCountryBySlug } from '@/modules/calculator/config/countries';
import { CalculatorPage } from '@/modules/calculator/ui/calculator-page';
import { pageMetadata, publicPageSchema } from '@/shared/lib/page-seo';
import { JsonLd } from '@/shared/ui/json-ld';
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
  return pageMetadata({
    locale, path: `/calculator/${country.slug}/`,
    title: t('Meta.countryTitle', { country: name }),
    description: t('Meta.countryDescription', { country: name }),
  });
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
  const [allMessages, t] = await Promise.all([getMessages(), getTranslations({ locale })]);
  const messages = getCalculatorCountryMessages(allMessages, country.code);
  const name = t(`Countries.${country.code}`);
  return (
    <ScopedMessagesProvider messages={messages}>
      <JsonLd data={publicPageSchema(locale, `/calculator/${country.slug}/`,
        t('Meta.countryTitle', { country: name }), 'WebApplication',
        t('Meta.countryDescription', { country: name }))} />
      <CalculatorPage country={country} initialDate={today} initialRates={rates} />
    </ScopedMessagesProvider>
  );
}
