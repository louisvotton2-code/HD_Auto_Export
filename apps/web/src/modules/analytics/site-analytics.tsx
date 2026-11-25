'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  AnalyticsVehicleIdSchema, type AnalyticsEvent,
} from '@hd/contracts/analytics';
import type { Locale } from '@/i18n/routing';
import { publicAnalyticsActionEvent, type PublicAnalyticsAction } from '@/shared/lib/public-analytics-actions';
import { publicNavigationVersion } from '@/shared/lib/public-navigation-events';
import { getTrackingConsent, refreshTrackingConsent, subscribeTrackingConsent } from '@/shared/lib/tracking-consent';
import { countVehicleContact } from './contact-count';
import { startVehiclePixel, stopVehiclePixel, trackVehiclePixelContact } from './pixel';
import { vehiclePixelPath } from './pixel-config';
import { clearAnalyticsSession, nextAnalyticsSession } from './session';
import { enqueueAnalytics, flushAnalyticsImmediately, flushAnalyticsOnPageHide, stopAnalyticsTransport } from './transport';

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
  [/^privacy$/, 'other', '[data-testid="privacy-page"]'],
];

function vehicleId(value: unknown): string | undefined {
  const parsed = AnalyticsVehicleIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

let frozenPixelSnapshot: { path: string; navigation: number } | undefined;

function pageContext(pathname: string, locale: Locale) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.shift() !== locale) return null;
  const route = routes.find(([pattern]) => pattern.test(segments.join('/')));
  if (!route) return null;
  const [, pageType, selector] = route;
  const page = document.querySelector<HTMLElement>(selector);
  if (!page || page.hasAttribute('data-analytics-demo')) return null;
  const detailId = pageType === 'vehicle' ? vehicleId(page.getAttribute('data-public-vehicle-detail')) : undefined;
  if (pageType === 'vehicle' && (!detailId || detailId !== segments.at(-1) || page.inert ||
      page.closest('[data-freshness]')?.getAttribute('data-freshness') !== 'fresh')) return null;
  const navigation = publicNavigationVersion(pathname);
  const pixelFresh = !detailId || (page.dataset.metaPixelNavigation === String(navigation) &&
    !(frozenPixelSnapshot?.path === pathname && frozenPixelSnapshot.navigation === navigation));
  return {
    locale,
    pageType,
    ...(detailId ? { vehicleId: detailId } : {}),
    pixelFresh,
    pixelEnabled: Boolean(detailId && pixelFresh && page.dataset.metaPixelEnabled === 'true'),
  };
}

function record(enabled: boolean, details: EventDetails, entryPage: PageType = details.pageType) {
  if (!enabled || getTrackingConsent() !== 'accepted' || typeof globalThis.crypto?.randomUUID !== 'function') return;
  const now = Date.now();
  enqueueAnalytics({
    ...details,
    ...nextAnalyticsSession(entryPage, now),
    eventId: globalThis.crypto.randomUUID(),
    occurredAt: new Date(now).toISOString(),
  });
}

let lastAnalyticsView: string | null = null;

/** One observer under the public locale layout. Staff preview has a separate root. */
export function SiteAnalytics({ locale, sessionAnalyticsEnabled, pixelId }: {
  locale: Locale;
  sessionAnalyticsEnabled: boolean;
  pixelId: string | null;
}) {
  const pathname = usePathname();
  useEffect(() => {
    if ((!sessionAnalyticsEnabled && !pixelId) || window.parent !== window || !pathname) return;
    if (frozenPixelSnapshot?.path !== pathname) frozenPixelSnapshot = undefined;
    const key = pathname.replace(/\/$/, '');
    const view = () => {
      const current = pageContext(pathname, locale);
      const consent = getTrackingConsent();
      const samePage = location.pathname.replace(/\/$/, '') === key;
      if (!current?.pixelEnabled || consent !== 'accepted' || !samePage) {
        stopVehiclePixel();
      }
      if (!current || !samePage || document.hidden || ('prerendering' in document && document.prerendering === true)) return false;
      const { pixelFresh, pixelEnabled, ...context } = current;
      if (sessionAnalyticsEnabled && consent === 'accepted' && lastAnalyticsView !== key) {
        lastAnalyticsView = key;
        record(sessionAnalyticsEnabled, { ...context, type: 'page_view' });
      }
      if (pixelId && consent === 'accepted' && current.vehicleId && pixelEnabled) {
        startVehiclePixel(pixelId, current.vehicleId, () => pageContext(pathname, locale)?.pixelEnabled === true);
      }
      return !pixelId || pixelFresh;
    };
    // Changing route (including to a missing page) permits a later return to count.
    if (lastAnalyticsView !== key) lastAnalyticsView = null;
    // The initial SSR resource can be unavailable until the user explicitly retries.
    const watchPixel = Boolean(pixelId && vehiclePixelPath.test(pathname));
    const onResource = new MutationObserver(() => {
      if (view() && !watchPixel) onResource.disconnect();
    });
    const watchUntilReady = () => {
      if (view() && !watchPixel) return;
      const main = document.querySelector('main');
      const recoveryBoundary = main?.closest('[data-freshness]')?.parentElement ?? main?.parentElement;
      if (recoveryBoundary) onResource.observe(recoveryBoundary, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['data-freshness', 'data-meta-pixel-navigation', 'data-meta-pixel-enabled', 'inert'],
      });
    };
    watchUntilReady();
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      lastAnalyticsView = null;
      refreshTrackingConsent();
      watchUntilReady();
    };
    const unsubscribe = subscribeTrackingConsent(view);
    document.addEventListener('visibilitychange', view);
    document.addEventListener('prerenderingchange', view);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      onResource.disconnect();
      stopVehiclePixel();
      unsubscribe();
      document.removeEventListener('visibilitychange', view);
      document.removeEventListener('prerenderingchange', view);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [locale, pathname, pixelId, sessionAnalyticsEnabled]);

  useEffect(() => {
    if (window.parent !== window) return;
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted || (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)) return;
      const anchor = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href][data-analytics-vehicle],a[href][data-analytics-contact]')
        : null;
      if (!anchor || anchor.closest('[aria-disabled="true"],[data-analytics-demo]')) return;
      const context = pageContext(location.pathname, locale);
      if (!context) return;
      const { pageType } = context;
      const clickedVehicle = vehicleId(anchor.dataset.analyticsVehicle);
      if (clickedVehicle) {
        if (sessionAnalyticsEnabled && getTrackingConsent() === 'accepted') {
          record(true, { type: 'vehicle_click', pageType, locale, vehicleId: clickedVehicle });
          // A live detail link replaces the document. Start the keepalive request before unload.
          if (event.type === 'click' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
              (!anchor.target || anchor.target === '_self')) flushAnalyticsImmediately();
        }
        return;
      }
      const channel = anchor.dataset.analyticsContact;
      if (channel !== 'whatsapp' && channel !== 'telegram') return;
      const taggedVehicle = anchor.dataset.analyticsContactVehicle;
      const contactVehicle = vehicleId(taggedVehicle);
      if (taggedVehicle !== undefined && !contactVehicle) return;
      if (contactVehicle) {
        if (context.pixelEnabled && contactVehicle === context.vehicleId) trackVehiclePixelContact(contactVehicle, channel);
        countVehicleContact({ vehicleId: contactVehicle, channel });
      }
      record(sessionAnalyticsEnabled, { type: 'contact_click', locale, pageType, channel,
        ...(contactVehicle ? { vehicleId: contactVehicle } : {}),
      });
    };
    const onPublicAction = ({ detail }: CustomEvent<PublicAnalyticsAction>) => {
      const context = pageContext(location.pathname, locale);
      if (!context) return;
      if (detail === 'calculator_complete' &&
          (context.pageType === 'calculator' || context.pageType === 'vehicle')) {
        record(sessionAnalyticsEnabled, { type: detail, locale, pageType: 'calculator' }, context.pageType);
      }
      if ((detail === 'filter_submit' || detail === 'search_zero_results') && context.pageType === 'catalog') {
        record(sessionAnalyticsEnabled, { type: detail, locale, pageType: 'catalog' });
      }
    };
    function stopWithoutConsent() {
      if (sessionAnalyticsEnabled && getTrackingConsent() === 'accepted') return;
      clearAnalyticsSession();
      stopAnalyticsTransport();
    }
    const unsubscribe = subscribeTrackingConsent(stopWithoutConsent);
    const onPageHide = (event: PageTransitionEvent) => {
      stopVehiclePixel();
      if (pixelId && event.persisted) {
        // The restored document needs a new confirmation of the server's vehicle switch.
        const path = location.pathname;
        frozenPixelSnapshot = { path, navigation: publicNavigationVersion(path) };
      }
      flushAnalyticsOnPageHide();
    };
    stopWithoutConsent();
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onClick, true);
    window.addEventListener(publicAnalyticsActionEvent, onPublicAction as EventListener);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('auxclick', onClick, true);
      window.removeEventListener(publicAnalyticsActionEvent, onPublicAction as EventListener);
      window.removeEventListener('pagehide', onPageHide);
      unsubscribe();
    };
  }, [locale, pixelId, sessionAnalyticsEnabled]);
  return null;
}
