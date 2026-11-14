'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { DESTINATION_COUNTRY_URL_EVENT } from '../lib/destination-country';

function UrlObserver() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  useEffect(() => { window.dispatchEvent(new Event(DESTINATION_COUNTRY_URL_EVENT)); }, [pathname, search]);
  return null;
}

/** Query navigation is observed without turning the calculator form into a client-only fallback. */
export function DestinationCountryUrlObserver() {
  return <Suspense fallback={null}><UrlObserver /></Suspense>;
}
