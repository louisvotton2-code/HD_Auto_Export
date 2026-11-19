'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  AnalyticsVehicleIdSchema, type AnalyticsEvent,
} from '@hd/contracts/analytics';
import type { Locale } from '@/i18n/routing';
import { enqueueAnalytics, flushAnalyticsOnExit } from './transport';

type PageType = AnalyticsEvent['pageType'];
type EventDetails = AnalyticsEvent extends infer T
  ? T extends AnalyticsEvent ? Omit<T, 'eventId'> : never : never;

const routes: readonly [pattern: RegExp, pageType: PageType, selector: string][] = [
  [/^$/, 'home', '[data-testid="home-page"]'],
  [/^cars$/, 'catalog', '[data-testid="public-vehicle-catalog"]'],
  [/^cars\/[^/]+$/, 'vehicle', '[data-public-vehicle-detail]'],
  [/^parts$/, 'parts', '[data-testid="parts-catalog"]'],
  [/^parts\/[^/]+$/, 'parts', '[data-part-detail]'],
  [/^calculator\/[a-z-]+$/, 'calculator', '.calculator-main'],
  [/^buy$/, 'guide', '[data-testid="buy-guide"]'],
  [/^about$/, 'about', '[data-about-hero]'],
];

function vehicleId(value: unknown): string | undefined {
  const parsed = AnalyticsVehicleIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function pageContext(pathname: string, locale: Locale) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.shift() !== locale) return null;
  const route = routes.find(([pattern]) => pattern.test(segments.join('/')));
  if (!route) return null;
  const [, pageType, selector] = route;
  const page = document.querySelector(selector);
  if (!page || page.hasAttribute('data-analytics-demo')) return null;
  const detailId = pageType === 'vehicle' ? vehicleId(page.getAttribute('data-public-vehicle-detail')) : undefined;
  if (pageType === 'vehicle' && (!detailId || detailId !== segments.at(-1))) return null;
  return { locale, pageType, ...(detailId ? { vehicleId: detailId } : {}) };
}

function record(details: EventDetails) {
  if (typeof globalThis.crypto?.randomUUID !== 'function') return;
  enqueueAnalytics({ ...details, eventId: globalThis.crypto.randomUUID() });
}

let lastView: string | null = null;

/** One observer under the public locale layout. Staff preview has a separate root. */
export function SiteAnalytics({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  useEffect(() => {
    if (window.parent !== window || !pathname) return;
    const key = pathname.replace(/\/$/, '');
    const view = () => {
      if (document.hidden || ('prerendering' in document && document.prerendering === true) ||
        location.pathname.replace(/\/$/, '') !== key || lastView === key) return;
      const current = pageContext(pathname, locale);
      if (!current) return;
      lastView = key;
      record({ ...current, type: 'page_view' });
    };
    // Changing route (including to a missing page) permits a later return to count.
    if (lastView !== key) lastView = null;
    view();
    // The initial SSR resource can be unavailable until the user explicitly retries.
    const onResource = new MutationObserver(() => {
      view();
      if (lastView === key) onResource.disconnect();
    });
    const main = document.querySelector('main');
    if (lastView !== key && main?.parentElement) onResource.observe(main.parentElement, { childList: true });
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      lastView = null;
      view();
    };
    document.addEventListener('visibilitychange', view);
    document.addEventListener('prerenderingchange', view);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      onResource.disconnect();
      document.removeEventListener('visibilitychange', view);
      document.removeEventListener('prerenderingchange', view);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [locale, pathname]);

  useEffect(() => {
    if (window.parent !== window) return;
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted || (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)) return;
      const anchor = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href][data-analytics-vehicle],a[href][data-analytics-contact]')
        : null;
      if (!anchor || anchor.closest('[aria-disabled="true"]')) return;
      const context = pageContext(location.pathname, locale);
      if (!context) return;
      const { pageType } = context;
      const clickedVehicle = vehicleId(anchor.dataset.analyticsVehicle);
      if (clickedVehicle) {
        record({ type: 'vehicle_click', pageType, locale, vehicleId: clickedVehicle });
        return;
      }
      const channel = anchor.dataset.analyticsContact;
      if (channel !== 'whatsapp' && channel !== 'telegram') return;
      const contactVehicle = vehicleId(anchor.dataset.analyticsContactVehicle);
      record({ type: 'contact_click', locale, pageType, channel, ...(contactVehicle ? { vehicleId: contactVehicle } : {}) });
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onClick, true);
    window.addEventListener('pagehide', flushAnalyticsOnExit);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('auxclick', onClick, true);
      window.removeEventListener('pagehide', flushAnalyticsOnExit);
    };
  }, [locale]);
  return null;
}
