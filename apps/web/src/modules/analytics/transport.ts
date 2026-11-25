import { analyticsEventBatchLimit, type AnalyticsEvent } from '@hd/contracts/analytics';
import { currentAnalyticsGrant, refreshTrackingConsent } from '@/shared/lib/tracking-consent';

const endpoint = '/api/v1/analytics/events';
const maxPendingEvents = analyticsEventBatchLimit * 3;
const flushDelayMs = 700;
const maxRetryDelayMs = 3_000;
const retryExpiryMs = 4_000;
let pending: AnalyticsEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sending: Promise<void> | undefined;
const active = new Set<AbortController>();
let retryWindow = new AbortController();

function retryDelayMs(retryAfter: string | null) {
  const value = retryAfter?.trim() ?? '';
  const requested = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value) - Date.now();
  if (requested > maxRetryDelayMs) return null;
  return Math.max(1_000 + Math.floor(Math.random() * 250), requested || 0);
}

function waitForRetry(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timeout = setTimeout(done, delay);
    signal.addEventListener('abort', done, { once: true });
  });
}

async function postBatch(body: string, abort: AbortController, unloading: boolean) {
  const deadline = setTimeout(() => abort.abort(), unloading ? 5_000 : 2_500);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'omit',
      mode: 'cors', // Keep the Origin header while suppressing the navigation referrer.
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
      keepalive: true,
      signal: abort.signal,
    });
    void response.body?.cancel().catch(() => {});
    return response.status === 503 ? retryDelayMs(response.headers.get('Retry-After')) : null;
  } catch {
    // Only an explicit 503 can be replayed. Network errors and timeouts are final.
    return null;
  } finally {
    clearTimeout(deadline);
  }
}

async function send(events: AnalyticsEvent[], unloading: boolean) {
  const grant = currentAnalyticsGrant();
  if (grant === null) return;
  // Another tab may have withdrawn before this tab processes its storage event.
  refreshTrackingConsent();
  if (currentAnalyticsGrant() !== grant) return;
  const retrySignal = retryWindow.signal;
  const abort = new AbortController();
  const body = JSON.stringify({ events });
  active.add(abort);
  try {
    const delay = await postBatch(body, abort, unloading);
    if (unloading || delay === null || retrySignal.aborted || abort.signal.aborted) return;
    const expiresAt = Date.now() + retryExpiryMs;
    await waitForRetry(delay, retrySignal);
    if (retrySignal.aborted || abort.signal.aborted || Date.now() >= expiresAt) return;
    refreshTrackingConsent();
    if (currentAnalyticsGrant() !== grant) return;
    await postBatch(body, abort, false);
  } finally {
    active.delete(abort);
  }
}

function cancelScheduledRetries() {
  retryWindow.abort();
  retryWindow = new AbortController();
}

function schedule() {
  if (!timer && !sending && pending.length) timer = setTimeout(flush, flushDelayMs);
}

function flush() {
  timer = undefined;
  if (!pending.length) return;
  const delivery = send(pending.splice(0, analyticsEventBatchLimit), false);
  sending = delivery;
  void delivery.finally(() => {
    if (sending !== delivery) return;
    sending = undefined;
    schedule();
  });
}

export function enqueueAnalytics(event: AnalyticsEvent) {
  if (pending.length >= maxPendingEvents) pending.shift();
  pending.push(event);
  schedule();
}

export function flushAnalyticsImmediately() {
  clearTimeout(timer);
  timer = undefined;
  if (!pending.length) return;
  const events = pending.splice(-analyticsEventBatchLimit);
  pending = [];
  // Delivery during navigation is a single keepalive attempt.
  void send(events, true);
}

export function flushAnalyticsOnPageHide() {
  cancelScheduledRetries();
  flushAnalyticsImmediately();
}

export function stopAnalyticsTransport() {
  clearTimeout(timer);
  timer = undefined;
  pending = [];
  sending = undefined;
  cancelScheduledRetries();
  for (const controller of active) controller.abort();
}
