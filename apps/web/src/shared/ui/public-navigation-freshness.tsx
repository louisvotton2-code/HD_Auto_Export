'use client';
import { useEffect } from 'react';
import {
  finishPublicNavigation,
  startPublicNavigation,
} from '@/shared/lib/public-navigation-events';

/** Back/Forward is an explicit user navigation. Tab focus/visibility never fetch data. */
export function PublicNavigationFreshness() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const navigate = () => {
      if (!/^\/(zh|en|ru)\/(?:cars(?:\/.*)?)?$/.test(location.pathname)) return;
      startPublicNavigation();
      clearTimeout(timer);
      timer = setTimeout(finishPublicNavigation, 0);
    };
    addEventListener('popstate', navigate);
    document.documentElement.setAttribute('data-public-history-ready', '');
    return () => {
      clearTimeout(timer);
      removeEventListener('popstate', navigate);
      document.documentElement.removeAttribute('data-public-history-ready');
    };
  }, []);
  return null;
}
