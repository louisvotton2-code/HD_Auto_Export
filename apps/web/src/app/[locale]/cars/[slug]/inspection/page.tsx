import { notFound, permanentRedirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';

/** Retain existing report URLs without fetching a vehicle or report body. */
export default async function InspectionRedirect({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(slug)) notFound();
  permanentRedirect(`/${locale}/cars/${slug}/#inspection`);
}
