import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicPixelId } from './pixel-config';
import type * as PixelModule from './pixel';

const getTrackingConsent = vi.hoisted(() => vi.fn<() => 'accepted' | 'declined' | 'pending'>());
vi.mock('@/shared/lib/tracking-consent', () => ({ getTrackingConsent }));

const pixelId = '123456789012345';
const vehicleId = '11111111-1111-4111-8111-111111111111';
const vehicle = { content_type: 'product', content_ids: [vehicleId] };

describe('official Meta Pixel on public vehicle details', () => {
  let pixel: typeof PixelModule;
  let fresh: boolean;
  type TestFbq = {
    callMethod?: ReturnType<typeof vi.fn>;
    instance?: { configsLoaded: Record<string, boolean>; asyncParamPromisesAllSettled?: boolean; locks: { isLocked(): boolean; onUnlocked(fn: () => void): void } };
    disablePushState: boolean;
  };
  const browser: { parent: object; fbq?: TestFbq; _fbq?: TestFbq } = { parent: {} };
  const location = { pathname: '' };
  const script = { src: '', onload: () => {}, onerror: () => {} };
  const append = vi.fn();
  const document = { head: { append }, createElement: () => script, prerendering: false };

  beforeEach(async () => {
    vi.resetModules();
    pixel = await import('./pixel');
    fresh = true;
    getTrackingConsent.mockReturnValue('accepted');
    browser.parent = browser;
    delete browser.fbq;
    delete browser._fbq;
    location.pathname = '/zh/cars/' + vehicleId + '/';
    document.prerendering = false;
    append.mockClear();
    vi.stubGlobal('window', browser);
    vi.stubGlobal('location', location);
    vi.stubGlobal('document', document);
  });

  afterEach(() => vi.unstubAllGlobals());
  const view = () => pixel.startVehiclePixel(pixelId, vehicleId, () => fresh);
  let unlocked: () => void;
  function load(configured = true, hintsReady = true) {
    const commands = vi.fn();
    browser.fbq!.callMethod = commands;
    browser.fbq!.instance = {
      configsLoaded: { [pixelId]: configured }, asyncParamPromisesAllSettled: hintsReady,
      locks: { isLocked: () => !browser.fbq!.instance!.configsLoaded[pixelId], onUnlocked: fn => { unlocked = fn; } },
    };
    script.onload();
    return commands;
  }

  it('requires the site flag and a valid pixel number', () => {
    expect(getPublicPixelId('true', ' ' + pixelId)).toBe(pixelId);
    for (const invalid of [undefined, '', '00012345', '<script>']) expect(getPublicPixelId('true', invalid)).toBeNull();
    expect(getPublicPixelId('false', pixelId)).toBeNull();
  });

  it('never loads for stale data, an invalid ID, a frame, a prerender or an expired grant', () => {
    fresh = false;
    view();
    fresh = true;
    pixel.startVehiclePixel('invalid', vehicleId, () => true);
    browser.parent = {};
    view();
    browser.parent = browser;
    document.prerendering = true;
    view();
    document.prerendering = false;
    getTrackingConsent.mockReturnValue('pending');
    view();
    getTrackingConsent.mockReturnValue('accepted');
    for (const path of ['/staff/preview/', '/en/buy/', '/zh/cars/other/', location.pathname + 'inspection/']) {
      location.pathname = path;
      view();
    }
    expect(append).not.toHaveBeenCalled();
  });

  it('initializes once, disables automatic capture and records only actual requested events', () => {
    view();
    view();
    pixel.trackVehiclePixelContact(vehicleId, 'whatsapp');
    pixel.trackVehiclePixelContact('other', 'telegram');
    expect(append).toHaveBeenCalledTimes(1);
    expect(script.src).toBe('https://connect.facebook.net/en_US/fbevents.js');
    expect(browser.fbq?.disablePushState).toBe(true);
    const commands = load();
    view();
    pixel.trackVehiclePixelContact(vehicleId, 'telegram');
    expect(commands.mock.calls).toEqual([
      ['consent', 'grant'], ['set', 'autoConfig', false, pixelId], ['init', pixelId], ['set', 'trackSingleOnly', true, pixelId],
      ['trackSingle', pixelId, 'PageView'], ['trackSingle', pixelId, 'ViewContent', vehicle],
      ['trackSingle', pixelId, 'Contact', { ...vehicle, contact_channel: 'whatsapp' }],
      ['trackSingle', pixelId, 'Contact', { ...vehicle, contact_channel: 'telegram' }],
    ]);
    pixel.stopVehiclePixel();
    pixel.trackVehiclePixelContact(vehicleId, 'whatsapp');
    expect(commands.mock.calls.at(-1)).toEqual(['consent', 'revoke']);
  });

  it.each(['withdrawn', 'stale', 'left', 'pagehide'])('drops pending events when the SDK is late and the view is %s', reason => {
    view();
    pixel.trackVehiclePixelContact(vehicleId, 'telegram');
    if (reason === 'withdrawn') getTrackingConsent.mockReturnValue('declined');
    if (reason === 'stale') fresh = false;
    if (reason === 'left') location.pathname = '/en/';
    if (reason === 'pagehide') pixel.stopVehiclePixel();
    expect(load()).not.toHaveBeenCalled();
  });

  it('never puts events into the SDK replay queue while the configuration is loading', () => {
    view();
    const commands = load(false);
    pixel.trackVehiclePixelContact(vehicleId, 'telegram');
    expect(commands.mock.calls.some(([name]) => name === 'trackSingle')).toBe(false);
    location.pathname = '/zh/buy/';
    browser.fbq!.instance!.configsLoaded[pixelId] = true;
    unlocked();
    expect(commands.mock.calls.at(-1)).toEqual(['consent', 'revoke']);
    expect(commands.mock.calls.some(([name]) => name === 'trackSingle')).toBe(false);
  });

  it('drops contacts waiting on SDK client hints when a visitor withdraws', () => {
    vi.useFakeTimers();
    try {
      view();
      const commands = load(true, false);
      pixel.trackVehiclePixelContact(vehicleId, 'whatsapp');
      getTrackingConsent.mockReturnValue('declined');
      pixel.stopVehiclePixel();
      browser.fbq!.instance!.asyncParamPromisesAllSettled = true;
      vi.runAllTimers();
      expect(commands.mock.calls.some(([name]) => name === 'trackSingle')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reload a blocked script or replay failed events', () => {
    view();
    script.onerror();
    view();
    pixel.trackVehiclePixelContact(vehicleId, 'whatsapp');
    expect(append).toHaveBeenCalledTimes(1);
    expect(load()).not.toHaveBeenCalled();
  });
});
