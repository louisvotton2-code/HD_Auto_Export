import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionAnalyticsEnabledForSite } from '../config/session-analytics';

const choiceKey = 'hd-auto:privacy-choice:v3';
const advertisingKey = 'hd-auto:meta-advertising:v2';
const off = { acknowledged: false, decided: false, analytics: false, advertising: false, advertisingDecided: false };
const declined = { ...off, acknowledged: true, decided: true, advertisingDecided: true };

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

describe('session analytics consent', () => {
  let browser: Browser;
  beforeEach(() => {
    vi.resetModules();
    browser = new Browser();
    vi.stubGlobal('window', browser);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only grants session analytics on a current, explicit acceptance', async () => {
    browser.values.set('hd-auto:tracking-preferences:v1', '{"version":1,"analytics":true,"advertising":true}');
    browser.values.set('hd-auto:privacy-notice:v2', 'read');
    browser.values.set('hd-auto:privacy-analytics:v2', 'allow');
    const { acceptPrivacyNotice, currentAnalyticsGrant, getTrackingConsent } = await import('./tracking-consent');
    expect(getTrackingConsent()).toEqual(off);
    expect(currentAnalyticsGrant()).toBeNull();
    acceptPrivacyNotice(true);
    expect(browser.localStorage.setItem.mock.calls).toEqual([[choiceKey, 'allow']]);
    expect(getTrackingConsent()).toEqual({ ...off, acknowledged: true, decided: true, analytics: true });
    expect(currentAnalyticsGrant()).not.toBeNull();
  });

  it('only acknowledges when analytics is out of scope', async () => {
    const { acceptPrivacyNotice, currentAnalyticsGrant, getTrackingConsent } = await import('./tracking-consent');
    acceptPrivacyNotice(false);
    expect(browser.localStorage.setItem.mock.calls).toEqual([[choiceKey, 'read']]);
    expect(getTrackingConsent()).toEqual({ ...off, acknowledged: true });
    expect(currentAnalyticsGrant()).toBeNull();
    acceptPrivacyNotice(true);
    expect(browser.values.get(choiceKey)).toBe('allow');
  });

  it('keeps a refusal across acknowledgment, and revocation invalidates pending work', async () => {
    const { acceptPrivacyNotice, declineTrackingConsent, currentAnalyticsGrant, getTrackingConsent } = await import('./tracking-consent');
    acceptPrivacyNotice(true);
    const firstGrant = currentAnalyticsGrant();
    declineTrackingConsent();
    acceptPrivacyNotice(false);
    expect(browser.values.get(choiceKey)).toBe('deny');
    expect(getTrackingConsent()).toEqual(declined);
    expect(currentAnalyticsGrant()).toBeNull();
    acceptPrivacyNotice(true);
    expect(currentAnalyticsGrant()).not.toBe(firstGrant);
  });

  it('syncs consent between tabs and ignores invalid or framed storage', async () => {
    const { acceptPrivacyNotice, declineTrackingConsent, getTrackingConsent, subscribeTrackingConsent } = await import('./tracking-consent');
    const update = vi.fn();
    const unsubscribe = subscribeTrackingConsent(update);
    browser.replaceFromAnotherTab('allow');
    expect(getTrackingConsent().analytics).toBe(true);
    browser.replaceFromAnotherTab('old-or-invalid');
    expect(getTrackingConsent()).toEqual(off);
    expect(update).toHaveBeenCalledTimes(2);
    browser.parent = {};
    acceptPrivacyNotice(true, true);
    declineTrackingConsent();
    expect(getTrackingConsent()).toEqual(off);
    expect(browser.localStorage.setItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('retains consent and revocation in the current tab if browser storage is blocked', async () => {
    browser.localStorage.getItem.mockImplementation(() => { throw new Error(); });
    browser.localStorage.setItem.mockImplementation(() => { throw new Error(); });
    const { acceptPrivacyNotice, declineTrackingConsent, getTrackingConsent } = await import('./tracking-consent');
    acceptPrivacyNotice(true, true);
    expect(getTrackingConsent().analytics).toBe(true);
    expect(getTrackingConsent().advertising).toBe(true);
    declineTrackingConsent();
    expect(getTrackingConsent()).toEqual(declined);
  });

  it('requires a fresh acceptance for selected pages and observes withdrawal from another tab', async () => {
    browser.values.set(choiceKey, 'allow');
    browser.values.set('hd-auto:meta-advertising:v1', 'allow');
    const { acceptPrivacyNotice, currentAnalyticsGrant, getTrackingConsent, subscribeTrackingConsent } = await import('./tracking-consent');
    expect(getTrackingConsent().analytics).toBe(true);
    expect(getTrackingConsent().advertising).toBe(false);
    expect(getTrackingConsent().advertisingDecided).toBe(false);
    acceptPrivacyNotice(true, true);
    expect(browser.values.get(advertisingKey)).toBe('allow');
    expect(getTrackingConsent().advertising).toBe(true);
    const update = vi.fn();
    const unsubscribe = subscribeTrackingConsent(update);
    browser.values.set(choiceKey, 'deny');
    browser.replaceFromAnotherTab('deny', advertisingKey);
    expect(getTrackingConsent()).toEqual(declined);
    expect(currentAnalyticsGrant()).toBeNull();
    expect(update).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('honors each deployment scope on the single acceptance', async () => {
    const { acceptPrivacyNotice, getTrackingConsent } = await import('./tracking-consent');
    acceptPrivacyNotice(false, true);
    expect(browser.values.get(choiceKey)).toBe('read');
    expect(browser.values.get(advertisingKey)).toBe('allow');
    expect(getTrackingConsent()).toEqual({ ...off, acknowledged: true, advertising: true, advertisingDecided: true });
  });

  it('requires explicit public enablement and honors an explicit local disable', () => {
    expect(sessionAnalyticsEnabledForSite('https://cars.hongdingauto.com', undefined)).toBe(false);
    expect(sessionAnalyticsEnabledForSite('https://cars.hongdingauto.com', 'true')).toBe(true);
    expect(sessionAnalyticsEnabledForSite('http://127.0.0.1:3363', undefined)).toBe(true);
    expect(sessionAnalyticsEnabledForSite('http://127.0.0.1:3363', 'false')).toBe(false);
    expect(sessionAnalyticsEnabledForSite('http://127.0.0.1:3363', 'unknown')).toBe(false);
  });
});
