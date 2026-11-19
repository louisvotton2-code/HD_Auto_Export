import { analyticsEventBatchLimit, type AnalyticsEvent } from '@hd/contracts/analytics';

const endpoint = '/api/v1/analytics/events';
const maxPendingEvents = analyticsEventBatchLimit * 3;
const flushDelayMs = 700;
let pending: AnalyticsEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;

async function send(events: AnalyticsEvent[], keepalive: boolean) {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), keepalive ? 5_000 : 2_500);
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
      credentials: 'omit',
      mode: 'cors', // Keep the Origin header while suppressing the navigation referrer.
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
      keepalive,
      signal: abort.signal,
    });
  } catch {
    // Analytics is best-effort and must never retry or block navigation.
  } finally { clearTimeout(deadline); }
}

function schedule() {
  if (!timer && !sending && pending.length) timer = setTimeout(flush, flushDelayMs);
}

function flush() {
  timer = undefined;
  if (!pending.length) return;
  sending = true;
  void send(pending.splice(0, analyticsEventBatchLimit), false).finally(() => {
    sending = false;
    schedule();
  });
}

export function enqueueAnalytics(event: AnalyticsEvent) {
  if (pending.length >= maxPendingEvents) pending.shift();
  pending.push(event);
  schedule();
}

export function flushAnalyticsOnExit() {
  clearTimeout(timer);
  timer = undefined;
  if (!pending.length) return;
  const events = pending.splice(-analyticsEventBatchLimit);
  pending = [];
  // Unload delivery is best-effort. No retry queue or persistence across sessions.
  void send(events, true);
}
