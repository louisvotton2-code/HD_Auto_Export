import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicPixelId } from './pixel-config';
import { trackPixel, type PixelEvent } from './pixel';

const consent = vi.hoisted(() => ({
  advertising: false,
  listeners: new Set<() => void>(),
}));

vi.mock('@/shared/lib/tracking-consent', () => ({
  getTrackingConsent: () => ({ advertising: consent.advertising }),
  subscribeTrackingConsent: (listener: () => void) => {
    consent.listeners.add(listener);
    return () => consent.listeners.delete(listener);
  },
}));

const pixelId = '123456789012345';
const vehicleId = '11111111-1111-4111-8111-111111111111';
const supplierVehicleId = 'ext-22222222-2222-4222-8222-222222222222';

describe('Facebook Pixel transport', () => {
  const browser = {
    parent: {} as object,
    location: {
      pathname: `/ru/cars/${vehicleId}/`,
      href: `https://example.test/ru/cars/${vehicleId}/?private=value`,
    },
  };
  const document = { prerendering: false };

  beforeEach(() => {
    browser.parent = browser;
    browser.location.pathname = `/ru/cars/${vehicleId}/`;
    document.prerendering = false;
    consent.advertising = false;
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', document);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requires an enabled site flag and a valid Pixel ID', () => {
    expect(getPublicPixelId('true', ` ${pixelId} `)).toBe(pixelId);
    expect(getPublicPixelId(undefined, pixelId)).toBeNull();
    expect(getPublicPixelId('false', pixelId)).toBeNull();
    for (const invalid of [undefined, '', '00012345', '<script>', '12345&ev=Contact']) {
      expect(getPublicPixelId('true', invalid)).toBeNull();
    }
  });

  it('blocks unconsented events and skips staff paths, privacy controls, iframes and prerendering', async () => {
    const send = vi.fn(async () => new Response());
    vi.stubGlobal('fetch', send);
    await trackPixel(pixelId, 'PageView', vehicleId, true);
    consent.advertising = true;
    await trackPixel(null, 'PageView', vehicleId, true);
    await trackPixel(pixelId, 'invalid' as PixelEvent, vehicleId, true);

    browser.parent = {};
    await trackPixel(pixelId, 'PageView', vehicleId, true);
    browser.parent = browser;
    document.prerendering = true;
    await trackPixel(pixelId, 'PageView', vehicleId, true);
    document.prerendering = false;
    for (const path of ['/staff/preview/', '/ru/staff/preview/', '/ru/privacy/', '/ru/', '/ru/cars/',
      `/ru/cars/${vehicleId}/inspection/`, `/xx/cars/${vehicleId}/`]) {
      browser.location.pathname = path;
      await trackPixel(pixelId, 'PageView', vehicleId, true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('requires an explicit true flag on the current vehicle even after consent', async () => {
    consent.advertising = true;
    const send = vi.fn(async () => new Response());
    vi.stubGlobal('fetch', send);
    await trackPixel(pixelId, 'PageView', vehicleId, false);
    // @ts-expect-error Older or malformed data may omit the flag at runtime.
    await trackPixel(pixelId, 'ViewContent', vehicleId, undefined);
    // @ts-expect-error A string from malformed data must not grant permission.
    await trackPixel(pixelId, 'Contact', vehicleId, 'true');
    expect(send).not.toHaveBeenCalled();
  });

  it('skips a mismatched route or malformed vehicle ID even with an enabled flag', async () => {
    consent.advertising = true;
    const send = vi.fn(async () => new Response());
    vi.stubGlobal('fetch', send);
    await trackPixel(pixelId, 'ViewContent', supplierVehicleId, true);
    browser.location.pathname = '/en/cars/invalid/';
    await trackPixel(pixelId, 'Contact', 'invalid', true);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends exactly the fixed Pixel event and ID without credentials, referrer or other data', async () => {
    consent.advertising = true;
    const send = vi.fn(async (_url: URL, _init: RequestInit) => new Response());
    vi.stubGlobal('fetch', send);
    const events = ['PageView', 'ViewContent', 'Contact'] as const;
    await trackPixel(pixelId, 'PageView', vehicleId, true);
    browser.location.pathname = `/zh/cars/${supplierVehicleId}`;
    await trackPixel(pixelId, 'ViewContent', supplierVehicleId, true);
    browser.location.pathname = `/en/cars/${supplierVehicleId}/`;
    await trackPixel(pixelId, 'Contact', supplierVehicleId, true);
    expect(send.mock.calls.map(([url]) => [url.origin, url.pathname, Object.fromEntries(url.searchParams)])).toEqual(
      events.map(event => ['https://www.facebook.com', '/tr', { id: pixelId, ev: event }]),
    );
    for (const [, options] of send.mock.calls) {
      expect(options).toEqual({
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
        keepalive: true,
        signal: expect.any(AbortSignal),
      });
    }
  });

  it('aborts in-flight requests on withdrawal and never replays them', async () => {
    consent.advertising = true;
    const send = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', send);
    const request = trackPixel(pixelId, 'Contact', vehicleId, true);
    const signal = send.mock.calls[0][1].signal;
    expect(signal?.aborted).toBe(false);
    consent.advertising = false;
    for (const listener of consent.listeners) listener();
    expect(signal?.aborted).toBe(true);
    await request;
    await trackPixel(pixelId, 'PageView', vehicleId, true);
    consent.advertising = true;
    expect(send).toHaveBeenCalledTimes(1);
    expect(consent.listeners.size).toBe(0);
  });
});
