'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { hasLocale } from 'next-intl';
import { routing, type Locale } from '@/i18n/routing';
import { parseCatalogPageRequest } from '../public-query';

export function VehicleCatalogReturnLink({ locale, className, children }: {
  locale: Locale;
  className?: string;
  children: ReactNode;
}) {
  const fallback = `/${locale}/cars/`;
  const [returnTo, setReturnTo] = useState<string>();
  useEffect(() => {
    if (!document.referrer) return;
    const previous = new URL(document.referrer);
    const previousLocale = /^\/([^/]+)\/cars\/$/.exec(previous.pathname)?.[1];
    if (previous.origin !== location.origin || !hasLocale(routing.locales, previousLocale)) return;
    if (parseCatalogPageRequest(Object.fromEntries(previous.searchParams), previousLocale)?.kind === 'query')
      setReturnTo(previous.pathname + previous.search);
  }, []);

  return <a className={className} href={returnTo ?? fallback}>{children}</a>;
}
