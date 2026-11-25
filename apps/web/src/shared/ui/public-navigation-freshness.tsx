'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, type RefObject } from 'react';
import { isPublicVehicleDetailPath } from '@/shared/lib/public-vehicle-detail-path';
import {
  discardPublicNavigationAfterLeaving,
  finishPublicNavigation,
  startPublicNavigation,
} from '@/shared/lib/public-navigation-events';

const homePath = /^\/(zh|en|ru)\/$/;
const vehiclePath = /^\/(zh|en|ru)\/cars(?:\/.*)?$/;

function DetailAddressObserver({ address }: { address: RefObject<URL | null> }) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  useEffect(() => {
    // Only store an address once the detail and the browser agree on the route and query.
    if (pathname === location.pathname && search === new URLSearchParams(location.search).toString())
      address.current = new URL(location.href);
  }, [address, pathname, search]);
  return null;
}

/** Back/Forward rechecks public data. In-page anchors on the home and details just scroll. */
export function PublicNavigationFreshness() {
  const pathname = usePathname();
  const observedDetail = useRef<URL | null>(null);
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
    const observeDetail = () => {
      const current = new URL(location.href);
      observedDetail.current = isPublicVehicleDetailPath(current.pathname) ? current : null;
      return observedDetail.current;
    };
    const onHistoryChange = () => {
      const previous = observedDetail.current;
      const current = observeDetail();
      // A native anchor also dispatches popstate. The same detail and query still show the same resource.
      if (current && previous?.pathname === current.pathname && previous.search === current.search && previous.hash !== current.hash) return;
      navigate();
    };
    const recheckRestoredPage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      observeDetail();
      navigate();
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
      observeDetail();
      const from = new URL(oldURL);
      const to = new URL(newURL);
      if (homePath.test(to.pathname) && from.pathname === to.pathname && from.search === to.search) {
        clearTimeout(timer);
      }
    };
    observeDetail();
    addEventListener('popstate', onHistoryChange);
    addEventListener('pageshow', recheckRestoredPage);
    addEventListener('pagehide', maskCachedDetail);
    addEventListener('hashchange', ignoreHomeFragment);
    document.documentElement.setAttribute('data-public-history-ready', '');
    return () => {
      clearTimeout(timer);
      removeEventListener('popstate', onHistoryChange);
      removeEventListener('pageshow', recheckRestoredPage);
      removeEventListener('pagehide', maskCachedDetail);
      removeEventListener('hashchange', ignoreHomeFragment);
      document.documentElement.removeAttribute('data-public-history-ready');
    };
  }, []);
  return isPublicVehicleDetailPath(pathname)
    ? <Suspense fallback={null}><DetailAddressObserver address={observedDetail} /></Suspense>
    : null;
}
