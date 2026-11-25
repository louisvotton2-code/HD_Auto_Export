import type { AnalyticsContactCountRequest } from '@hd/contracts/analytics';
import { getTrackingConsent } from '@/shared/lib/tracking-consent';

/** A single consented request, independent of the session analytics feature switch. */
export function countVehicleContact({ vehicleId, channel }: AnalyticsContactCountRequest) {
  if (getTrackingConsent() !== 'accepted') return;
  void fetch('/api/v1/analytics/contact-count', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicleId, channel }),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    cache: 'no-store',
    keepalive: true,
  }).catch(() => {
    // The contact link opens independently. The counter is never retried.
  });
}
