import { routing } from '@/i18n/routing';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { StaticRedirect } from '@/shared/ui/static-redirect';

export const metadata = { robots: { index: false, follow: true } };

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <StaticRedirect href={`/${locale}/calculator/russia/`} locale={locale} />;
}
