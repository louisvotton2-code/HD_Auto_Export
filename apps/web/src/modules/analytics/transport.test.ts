import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@hd/contracts/analytics';

const firstEvent = {
  type: 'page_view', pageType: 'vehicle', locale: 'zh',
  eventId: '84290b6b-159c-4faa-96d9-5da512d49e5f',
  vehicleId: 'c3080450-d225-4b7b-93db-31bfa71bc1f1',
} satisfies AnalyticsEvent;
const nextEvent = { ...firstEvent, eventId: '4ea7b30f-ee72-47bd-880e-d5dc75559750' };
const firstBody = JSON.stringify({ events: [firstEvent] });
const unavailable = () => new Response(null, { status: 503 });

let transport: typeof import('./transport');
let choices: typeof import('@/shared/lib/tracking-consent');
let storage: Map<string, string>;
let unsubscribe: () => void;
let post: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0);
  storage = new Map();
  const tab = new EventTarget();
  vi.stubGlobal('window', Object.assign(tab, { parent: tab, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } }));
  post = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', post);
  choices = await import('@/shared/lib/tracking-consent');
  transport = await import('./transport');
  choices.saveTrackingConsent(true);
  unsubscribe = choices.subscribeTrackingConsent(() => {
    if (choices.getTrackingConsent() !== 'accepted') transport.stopAnalyticsTransport();
  });
});

afterEach(async () => {
  transport.stopAnalyticsTransport();
  unsubscribe();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(index: number) { return post.mock.calls[index]?.[1]; }

describe('first-party analytics delivery', () => {
  it('replays one unchanged batch on 503 and then sends new events independently', async () => {
    post.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(700);
    transport.enqueueAnalytics(nextEvent);
    await vi.advanceTimersByTimeAsync(999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2);
    expect(request(0)?.body).toBe(firstBody);
    expect(request(1)?.body).toBe(firstBody);
    for (const [url, options] of post.mock.calls) {
      expect(url).toBe('/api/v1/analytics/events');
      expect(options).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true });
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(3);
    expect(request(2)?.body).toBe(JSON.stringify({ events: [nextEvent] }));
  });

  it.each(['2', 'Wed, 25 Nov 2026 10:00:02 GMT'])('honors Retry-After within budget (%s)', async header => {
    post.mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': header } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(header === '2' ? 701 : 1);
    expect(post).toHaveBeenCalledTimes(2);
    expect(request(1)?.body).toBe(firstBody);
  });

  it('skips a Retry-After outside the replay window', async () => {
    post.mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '12' } }));
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('drops a scheduled retry after the document has been suspended past expiry', async () => {
    post.mockResolvedValueOnce(unavailable());
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(700);
    vi.setSystemTime(Date.now() + 8_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([400, 429, 500, 502, 504])('does not replay HTTP %i', async status => {
    post.mockResolvedValue(new Response(null, { status }));
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not replay a network rejection or request timeout', async () => {
    post.mockRejectedValueOnce(new TypeError('offline'));
    post.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    }));
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(1);
    transport.enqueueAnalytics(nextEvent);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(request(1)?.signal?.aborted).toBe(true);
  });

  it('discards a delayed retry on withdrawal even when consent is granted again immediately', async () => {
    post.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(700);
    choices.saveTrackingConsent(false);
    choices.saveTrackingConsent(true);
    transport.enqueueAnalytics(nextEvent);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(request(0)?.signal?.aborted).toBe(true);
    expect(request(1)?.body).toBe(JSON.stringify({ events: [nextEvent] }));
  });

  it('aborts a replay that is already in flight when consent is withdrawn', async () => {
    post.mockResolvedValueOnce(unavailable());
    post.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    }));
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(1_700);
    expect(post).toHaveBeenCalledTimes(2);
    expect(request(1)?.signal?.aborted).toBe(false);
    choices.saveTrackingConsent(false);
    expect(request(1)?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('on pagehide cancels a scheduled replay and flushes other queued events once', async () => {
    post.mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(unavailable());
    transport.enqueueAnalytics(firstEvent);
    await vi.advanceTimersByTimeAsync(700);
    transport.enqueueAnalytics(nextEvent);
    transport.flushAnalyticsOnPageHide();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(request(1)?.body).toBe(JSON.stringify({ events: [nextEvent] }));
  });
});
