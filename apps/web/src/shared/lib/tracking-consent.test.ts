import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionAnalyticsEnabledForSite } from '../config/session-analytics';

const choiceKey = 'hd-auto:privacy-choice:v3';
const advertisingKey = 'hd-auto:meta-advertising:v2';
class Browser extends EventTarget {
  parent: Browser | object = this;
  readonly values = new Map<string, string>();
  readonly localStorage = {
    getItem: vi.fn((key: string) => this.values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { this.values.set(key, value); }),
  };

  replaceFromAnotherTab(value: string | null, key = choiceKey) {
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
    this.dispatchEvent(Object.assign(new Event('storage'), { key, storageArea: this.localStorage }));
  }
}

describe('unified tracking consent', () => {
  let browser: Browser;
  beforeEach(() => {
    vi.resetModules();
    browser = new Browser();
    vi.stubGlobal('window', browser);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores both permissions on explicit acceptance and reuses them after reload', async () => {
    browser.values.set('hd-auto:tracking-preferences:v1', '{"version":1,"analytics":true,"advertising":true}');
    const { saveTrackingConsent, currentAnalyticsGrant, getTrackingConsent } = await import('./tracking-consent');
    expect(getTrackingConsent()).toBe('pending');
    expect(currentAnalyticsGrant()).toBeNull();
    saveTrackingConsent(true);
    expect(browser.localStorage.setItem.mock.calls).toEqual([[choiceKey, 'allow'], [advertisingKey, 'allow-sdk']]);
    expect(getTrackingConsent()).toBe('accepted');
    expect(currentAnalyticsGrant()).not.toBeNull();

    vi.resetModules();
    expect((await import('./tracking-consent')).getTrackingConsent()).toBe('accepted');
  });

  it('stores a refusal for both permissions and invalidates work tied to the grant', async () => {
    const { saveTrackingConsent, currentAnalyticsGrant, getTrackingConsent } = await import('./tracking-consent');
    saveTrackingConsent(true);
    const originalGrant = currentAnalyticsGrant();
    saveTrackingConsent(false);
    expect(getTrackingConsent()).toBe('declined');
    expect(currentAnalyticsGrant()).toBeNull();
    expect(browser.values.get(choiceKey)).toBe('deny');
    expect(browser.values.get(advertisingKey)).toBe('deny');
    saveTrackingConsent(true);
    expect(currentAnalyticsGrant()).not.toBe(originalGrant);
  });

  it.each([
    ['allow', null, 'pending'],
    [null, 'allow-sdk', 'pending'],
    ['read', null, 'pending'],
    ['allow', 'allow', 'pending'],
    ['allow', 'allow-sdk', 'accepted'],
    ['deny', 'allow-sdk', 'declined'],
    ['allow', 'deny', 'declined'],
  ])('reads existing site and ad values %s / %s as %s', async (site, ads, expected) => {
    if (site !== null) browser.values.set(choiceKey, site);
    if (ads !== null) browser.values.set(advertisingKey, ads);
    const { getTrackingConsent } = await import('./tracking-consent');
    expect(getTrackingConsent()).toBe(expected);
  });

  it('syncs the combined choice across tab updates and clears it when stored values are removed', async () => {
    const { getTrackingConsent, subscribeTrackingConsent } = await import('./tracking-consent');
    expect(getTrackingConsent()).toBe('pending');
    const update = vi.fn();
    const unsubscribe = subscribeTrackingConsent(update);
    browser.replaceFromAnotherTab('allow');
    expect(getTrackingConsent()).toBe('pending');
    expect(update).not.toHaveBeenCalled();
    browser.replaceFromAnotherTab('allow-sdk', advertisingKey);
    expect(getTrackingConsent()).toBe('accepted');
    browser.replaceFromAnotherTab('deny', advertisingKey);
    expect(getTrackingConsent()).toBe('declined');
    browser.replaceFromAnotherTab(null, advertisingKey);
    expect(getTrackingConsent()).toBe('pending');
    expect(update).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('keeps acceptance and refusal in memory if browser storage is blocked', async () => {
    browser.localStorage.getItem.mockImplementation(() => { throw new Error(); });
    browser.localStorage.setItem.mockImplementation(() => { throw new Error(); });
    const { saveTrackingConsent, getTrackingConsent } = await import('./tracking-consent');
    saveTrackingConsent(true);
    expect(getTrackingConsent()).toBe('accepted');
    saveTrackingConsent(false);
    expect(getTrackingConsent()).toBe('declined');
  });

  it('does not read or change the public choice inside frames', async () => {
    browser.parent = {};
    browser.values.set(choiceKey, 'allow');
    browser.values.set(advertisingKey, 'allow-sdk');
    const { saveTrackingConsent, getTrackingConsent } = await import('./tracking-consent');
    saveTrackingConsent(true);
    saveTrackingConsent(false);
    expect(getTrackingConsent()).toBe('pending');
    expect(browser.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('requires explicit public enablement and honors an explicit local disable', () => {
    expect(sessionAnalyticsEnabledForSite('https://cars.hongdingauto.com', undefined)).toBe(false);
    expect(sessionAnalyticsEnabledForSite('https://cars.hongdingauto.com', 'true')).toBe(true);
    expect(sessionAnalyticsEnabledForSite('http://127.0.0.1:3363', undefined)).toBe(true);
    expect(sessionAnalyticsEnabledForSite('http://127.0.0.1:3363', 'false')).toBe(false);
    expect(sessionAnalyticsEnabledForSite('http://127.0.0.1:3363', 'unknown')).toBe(false);
  });
});
