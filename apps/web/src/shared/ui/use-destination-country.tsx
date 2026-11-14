'use client';

import { useEffect, useState } from 'react';
import {
  DESTINATION_COUNTRY_EVENT, DESTINATION_COUNTRY_STORAGE_KEY, DESTINATION_COUNTRY_URL_EVENT, destinationCountryFromLocation,
  isDestinationCountry, readDestinationCountry, resolveDestinationCountry, writeDestinationCountry,
  type DestinationCountryCode,
} from '../lib/destination-country';

/** Preference only: it never reads/writes a vehicle draft, price, date or FX. */
export function useDestinationCountry(explicitCountry?: DestinationCountryCode, scopeKey = '') {
  const key = `${explicitCountry ?? ''}:${scopeKey}`;
  const [state, setState] = useState<{ key: string; country: DestinationCountryCode; ready: boolean }>({ key, country: explicitCountry ?? 'RU', ready: false });
  useEffect(() => {
    let explicit: DestinationCountryCode | undefined;
    const resolve = () => {
      explicit = explicitCountry ?? destinationCountryFromLocation(window.location.pathname, window.location.search);
      let stored: DestinationCountryCode | undefined;
      try { stored = readDestinationCountry(window.localStorage); } catch { /* Disabled storage remains optional. */ }
      const country = resolveDestinationCountry(explicit, stored);
      setState({ key, country, ready: true });
      // An explicit country URL is intent. A read-time RU fallback is never written back.
      if (explicit && explicit !== stored) {
        try { writeDestinationCountry(window.localStorage, explicit); } catch { /* Optional preference. */ }
        window.dispatchEvent(new CustomEvent(DESTINATION_COUNTRY_EVENT, { detail: explicit }));
      }
    };
    resolve();
    const update = (value: unknown) => {
      if (!explicit && isDestinationCountry(value)) setState({ key, country: value, ready: true });
    };
    const local = (event: Event) => update((event as CustomEvent<unknown>).detail);
    const storage = (event: StorageEvent) => {
      if (event.key === DESTINATION_COUNTRY_STORAGE_KEY) update(event.newValue);
    };
    window.addEventListener(DESTINATION_COUNTRY_EVENT, local);
    window.addEventListener('storage', storage);
    window.addEventListener('popstate', resolve);
    window.addEventListener(DESTINATION_COUNTRY_URL_EVENT, resolve);
    return () => {
      window.removeEventListener(DESTINATION_COUNTRY_EVENT, local);
      window.removeEventListener('storage', storage);
      window.removeEventListener('popstate', resolve);
      window.removeEventListener(DESTINATION_COUNTRY_URL_EVENT, resolve);
    };
  }, [explicitCountry, key]);

  const selectCountry = (country: DestinationCountryCode) => {
    if (!isDestinationCountry(country)) return;
    setState({ key, country, ready: true });
    try { writeDestinationCountry(window.localStorage, country); } catch { /* Optional preference. */ }
    window.dispatchEvent(new CustomEvent(DESTINATION_COUNTRY_EVENT, { detail: country }));
  };
  return {
    country: state.key === key ? state.country : explicitCountry ?? 'RU',
    ready: state.key === key && state.ready,
    selectCountry,
  };
}
