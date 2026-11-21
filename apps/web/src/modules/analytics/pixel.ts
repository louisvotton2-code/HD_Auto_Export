import { AnalyticsVehicleIdSchema } from '@hd/contracts/analytics';
import { getTrackingConsent, subscribeTrackingConsent } from '@/shared/lib/tracking-consent';
import { isPixelId } from './pixel-config';

export type PixelEvent = 'PageView' | 'ViewContent' | 'Contact';

const endpoint = 'https://www.facebook.com/tr';
const vehicleDetailPath = /^\/(?:zh|en|ru)\/cars\/([^/]+)\/?$/;
const active = new Set<AbortController>();
let unsubscribe: (() => void) | undefined;

function abortRevokedRequests() {
  if (getTrackingConsent().advertising) return;
  for (const request of active) request.abort();
}

/** Send only the configured Pixel ID and event name from a selected public vehicle detail. */
export async function trackPixel(pixelId: string | null, event: PixelEvent, vehicleId: string, pixelEnabled: boolean): Promise<void> {
  if (typeof window === 'undefined' || window.parent !== window || !isPixelId(pixelId) || pixelEnabled !== true ||
      !AnalyticsVehicleIdSchema.safeParse(vehicleId).success ||
      vehicleDetailPath.exec(window.location.pathname)?.[1] !== vehicleId ||
      (typeof document !== 'undefined' && 'prerendering' in document && document.prerendering === true) ||
      !getTrackingConsent().advertising || active.size >= 12) return;
  if (event !== 'PageView' && event !== 'ViewContent' && event !== 'Contact') return;

  const url = new URL(endpoint);
  url.searchParams.set('id', pixelId);
  url.searchParams.set('ev', event);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  active.add(controller);
  unsubscribe ??= subscribeTrackingConsent(abortRevokedRequests);

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
      keepalive: true,
      signal: controller.signal,
    });
  } catch {
    // The user action proceeds independently. No event is queued or retried.
  } finally {
    clearTimeout(timeout);
    active.delete(controller);
    if (!active.size) {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  }
}
