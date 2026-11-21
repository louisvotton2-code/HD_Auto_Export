import type { AnalyticsContactCountRequest } from '@hd/contracts/analytics';

/** A single best-effort request, separate from consented session analytics. */
export function countVehicleContact({ vehicleId, channel }: AnalyticsContactCountRequest) {
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
