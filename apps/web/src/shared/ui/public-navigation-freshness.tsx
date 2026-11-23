'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { isPublicVehicleDetailPath } from '@/shared/lib/public-vehicle-detail-path';
import {
  discardPublicNavigationAfterLeaving,
  finishPublicNavigation,
  startPublicNavigation,
} from '@/shared/lib/public-navigation-events';

const homePath = /^\/(zh|en|ru)\/$/;
const vehiclePath = /^\/(zh|en|ru)\/cars(?:\/.*)?$/;

/** Back/Forward between pages rechecks public data. Home fragments only scroll. */
export function PublicNavigationFreshness() {
  const pathname = usePathname();
  useEffect(() => {
    // During Back/Forward the browser URL can update before the new route commits.
    if (pathname === location.pathname) discardPublicNavigationAfterLeaving(pathname);
  }, [pathname]);

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
    const recheckRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) navigate();
    };
    const maskCachedDetail = (event: PageTransitionEvent) => {
      if (!event.persisted || !isPublicVehicleDetailPath(location.pathname)) return;
      const detail = document.querySelector<HTMLElement>('[data-public-vehicle-detail]');
      if (detail) {
        detail.style.visibility = 'hidden';
        detail.inert = true;
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
    addEventListener('pageshow', recheckRestoredPage);
    addEventListener('pagehide', maskCachedDetail);
    addEventListener('hashchange', ignoreHomeFragment);
    document.documentElement.setAttribute('data-public-history-ready', '');
    return () => {
      clearTimeout(timer);
      removeEventListener('popstate', navigate);
      removeEventListener('pageshow', recheckRestoredPage);
      removeEventListener('pagehide', maskCachedDetail);
      removeEventListener('hashchange', ignoreHomeFragment);
      document.documentElement.removeAttribute('data-public-history-ready');
    };
  }, []);
  return null;
}
