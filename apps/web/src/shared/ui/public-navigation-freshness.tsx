'use client';
import { useEffect } from 'react';
import {
  finishPublicNavigation,
  startPublicNavigation,
} from '@/shared/lib/public-navigation-events';

const homePath = /^\/(zh|en|ru)\/$/;
const vehiclePath = /^\/(zh|en|ru)\/cars(?:\/.*)?$/;

/** Back/Forward between pages rechecks public data. Home fragments only scroll. */
export function PublicNavigationFreshness() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const navigate = () => {
      if (homePath.test(location.pathname)) {
        clearTimeout(timer);
        // A native in-page link fires popstate before its hashchange.
        timer = setTimeout(() => {
          startPublicNavigation();
          finishPublicNavigation();
        }, 0);
      } else if (vehiclePath.test(location.pathname)) {
        startPublicNavigation();
        clearTimeout(timer);
        timer = setTimeout(finishPublicNavigation, 0);
      }
    };
    const ignoreHomeFragment = ({ oldURL, newURL }: HashChangeEvent) => {
      const from = new URL(oldURL);
      const to = new URL(newURL);
      if (homePath.test(to.pathname) && from.pathname === to.pathname && from.search === to.search) {
        clearTimeout(timer);
      }
    };
    addEventListener('popstate', navigate);
    addEventListener('hashchange', ignoreHomeFragment);
    document.documentElement.setAttribute('data-public-history-ready', '');
    return () => {
      clearTimeout(timer);
      removeEventListener('popstate', navigate);
      removeEventListener('hashchange', ignoreHomeFragment);
      document.documentElement.removeAttribute('data-public-history-ready');
    };
  }, []);
  return null;
}
