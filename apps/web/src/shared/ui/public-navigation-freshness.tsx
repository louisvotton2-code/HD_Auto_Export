'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { isPublicVehicleDetailPath } from '@/shared/lib/public-vehicle-detail-path';
import {
  discardPublicNavigationAfterLeaving,
  finishPublicNavigation,
  startPublicNavigation,
} from '@/shared/lib/public-navigation-events';

const homePath = /^\/(zh|en|ru)\/$/;
const vehiclePath = /^\/(zh|en|ru)\/cars(?:\/.*)?$/;

/** Back/Forward rechecks public data when the document's route changes. */
function PublicHistoryObserver() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const observedUrl = useRef<URL | null>(null);

  useEffect(() => {
    // React may still be committing the previous route when the history URL changes.
    if (pathname !== location.pathname || search !== new URLSearchParams(location.search).toString()) return;
    observedUrl.current = new URL(location.href);
    discardPublicNavigationAfterLeaving(pathname);
  }, [pathname, search]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rememberUrl = () => {
      observedUrl.current = new URL(location.href);
    };
    const recheck = () => {
      if (!homePath.test(location.pathname) && !vehiclePath.test(location.pathname)) return;
      startPublicNavigation();
      clearTimeout(timer);
      timer = setTimeout(finishPublicNavigation, 0);
    };
    const onHistoryChange = () => {
      const previous = observedUrl.current;
      const current = new URL(location.href);
      observedUrl.current = current;
      // Native anchors also dispatch popstate. The same route and query still show the same resource.
      if (previous?.pathname === current.pathname && previous.search === current.search && previous.hash !== current.hash) return;
      recheck();
    };
    const recheckRestoredPage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      rememberUrl();
      recheck();
    };
    const maskCachedDetail = (event: PageTransitionEvent) => {
      if (!event.persisted || !isPublicVehicleDetailPath(location.pathname)) return;
      const detail = document.querySelector<HTMLElement>('[data-public-vehicle-detail]');
      if (detail) {
        detail.style.visibility = 'hidden';
        detail.inert = true;
      }
    };
    rememberUrl();
    addEventListener('popstate', onHistoryChange);
    addEventListener('pageshow', recheckRestoredPage);
    addEventListener('pagehide', maskCachedDetail);
    addEventListener('hashchange', rememberUrl);
    document.documentElement.setAttribute('data-public-history-ready', '');
    return () => {
      clearTimeout(timer);
      removeEventListener('popstate', onHistoryChange);
      removeEventListener('pageshow', recheckRestoredPage);
      removeEventListener('pagehide', maskCachedDetail);
      removeEventListener('hashchange', rememberUrl);
      document.documentElement.removeAttribute('data-public-history-ready');
    };
  }, []);
  return null;
}

export function PublicNavigationFreshness() {
  return <Suspense fallback={null}><PublicHistoryObserver /></Suspense>;
}
