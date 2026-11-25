import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { AnalyticsEventsRequestSchema, type AnalyticsEvent } from '@hd/contracts/analytics';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { getPublicPixelId } from '../src/modules/analytics/pixel-config';
import { authorizePreview, installPreviewTransport, openPreviewHost, waitForPreviewEvent } from './helpers/publication-preview';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

const pixelId = getPublicPixelId(
  process.env.HD_META_PIXEL_ENABLED,
  process.env.HD_META_PIXEL_ID,
);
const selectedId = externalFixtureId(1);
const unselectedId = externalFixtureId(2);
const sessionAnalyticsEnabled = process.env.ANALYTICS_V2_ENABLED !== 'false';
const indexable = process.env.SITE_INDEXABLE === 'true';
const supportedDetailQuery = {
  locale: 'zh', view: 'localized', priceView: 'usd', projection: 'detail-inline-v1',
  technicalView: 'verified', titleView: 'english',
};
const negotiatedDetailQuery = {
  ...supportedDetailQuery, pixelView: 'eligible', ...(indexable ? { seoView: 'eligible' } : {}),
};
const metaDomains = ['facebook.com', 'facebook.net', 'fbcdn.net'];
const sdkUrl = 'https://connect.facebook.net/en_US/fbevents.js';
const contactHosts = new Set(['wa.me', 'api.whatsapp.com', 't.me']);

// The SDK script and its per-pixel configuration finish separately.
const fixtureSdk = `
  (() => {
    const fbq = window.fbq;
    const configsLoaded = {};
    const listeners = [];
    let locked = false;
    fbq.instance = {
      configsLoaded,
      locks: {
        isLocked: () => locked,
        onUnlocked: callback => listeners.push(callback),
      },
    };
    fbq.callMethod = (...command) => {
      window.capturePixelCommand(command);
      if (command[0] !== 'init') return;
      locked = true;
      const id = command[1];
      window.waitForPixelConfig().then(() => {
        configsLoaded[id] = true;
        locked = false;
        for (const notify of [...listeners]) notify('config:' + id);
        window.captureReadyConfig(id);
      });
    };
    for (const command of fbq.queue.splice(0)) fbq.callMethod(...command);
  })();
`;

async function interceptAdvertising(context: BrowserContext, baseURL: string, delays: {
  script?: Promise<void>;
  configuration?: Promise<void>;
} = {}) {
  const siteOrigin = new URL(baseURL).origin;
  const sdkRequests: string[] = [];
  const commands: unknown[][] = [];
  const pixel: unknown[][] = [];
  const readyConfigs: string[] = [];
  const contacts: unknown[] = [];
  const sessions: AnalyticsEvent[] = [];
  const browserApiRequests: Array<{ method: string; url: URL }> = [];

  await context.exposeBinding('waitForPixelConfig', () => delays.configuration);
  await context.exposeBinding('captureReadyConfig', (_source, id: string) => { readyConfigs.push(id); });
  await context.exposeBinding('capturePixelCommand', (_source, command: unknown[]) => {
    commands.push(command);
    if (command[0] === 'trackSingle') pixel.push(command);
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (metaDomains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) {
      if (url.href !== sdkUrl || request.resourceType() !== 'script') {
        await route.abort();
        throw new Error('Unexpected Meta request outside the intercepted SDK loader: ' + url.pathname);
      }
      sdkRequests.push(url.href);
      if (delays.script) await delays.script;
      return route.fulfill({
        contentType: 'application/javascript',
        headers: { 'access-control-allow-origin': siteOrigin },
        body: fixtureSdk,
      });
    }
    if (contactHosts.has(url.hostname)) return route.fulfill({ contentType: 'text/plain', body: 'Contact intercepted' });
    if (url.origin !== siteOrigin) return route.abort();
    if (url.pathname === '/api/v1/analytics/contact-count') contacts.push(request.postDataJSON());
    if (url.pathname === '/api/v1/analytics/events') {
      const { events } = AnalyticsEventsRequestSchema.parse(request.postDataJSON());
      sessions.push(...events);
    }
    if (url.pathname.startsWith('/api/v1/analytics/')) return route.fulfill({ status: 202 });
    if (url.pathname.startsWith('/api/v1/external-media/') && request.method() === 'POST') {
      return route.fulfill({ status: 202 });
    }
    if (url.pathname.startsWith('/api/') && ['fetch', 'xhr'].includes(request.resourceType())) {
      browserApiRequests.push({ method: request.method(), url });
    }
    return route.continue();
  });

  return { sdkRequests, commands, pixel, readyConfigs, contacts, sessions, browserApiRequests, events: () => pixel.map(command => command[2]) };
}

async function readVehicleDetailRequests(request: APIRequestContext, transport: 'ssr' | 'public' = 'ssr') {
  const prefix = transport === 'ssr' ? '/internal/public-catalog' : '/api/v1';
  const response = await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`);
  expect(response.ok()).toBe(true);
  const { requests } = await response.json();
  return (requests as Array<{ path: string; method: string; serviceAuthenticated?: boolean; query: Record<string, string> }>)
    .filter(entry => entry.path === `${prefix}/vehicles/${selectedId}`);
}

test('ordinary browsing sends no Pixel before or after one-click acceptance', async ({ page, context, baseURL }) => {
  const { pixel, sdkRequests } = await interceptAdvertising(context, baseURL!);
  await page.goto('/en/about/');
  const banner = page.getByTestId('tracking-consent-banner');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(banner).toBeVisible();
  await page.waitForTimeout(850);
  expect(sdkRequests).toEqual([]);
  expect(pixel).toEqual([]);

  await banner.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(banner).toHaveCount(0);
  await page.locator('header a[href="/en/buy/"]:visible').click();
  await expect(page.getByTestId('buy-guide')).toBeVisible();
  await page.reload();
  await expect(banner).toHaveCount(0);
  await page.locator('footer').getByRole('link', { name: 'Privacy notice', exact: true }).click();
  await expect(page.getByTestId('privacy-page')).toBeVisible();
  await expect(page.getByTestId('privacy-meta-opt-in')).toHaveCount(0);
  await expect(page.getByTestId('privacy-meta-withdraw')).toHaveCount(0);
  await page.waitForTimeout(850);
  expect(sdkRequests).toEqual([]);
  expect(pixel).toEqual([]);
});

test('acceptance with Meta disabled sends no Pixel on a public vehicle detail', async ({ page, context, request, baseURL }) => {
  test.skip(Boolean(pixelId), 'Run this branch with Meta disabled.');
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'This test requires an isolated public vehicle fixture.');
  const { pixel, sdkRequests, sessions } = await interceptAdvertising(context, baseURL!);
  await resetPublicFixture(request);
  try {
    await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
    await page.goto(`/en/cars/${selectedId}/`);
    const detail = page.locator(`[data-public-vehicle-detail="${selectedId}"]`);
    await expect(detail).toBeVisible();
    await expect(detail).not.toHaveAttribute('data-meta-pixel-enabled', 'true');
    const requests = await readVehicleDetailRequests(request);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.query).toMatchObject({ view: 'localized', projection: 'detail-inline-v1' });
    expect(requests[0]?.query).not.toHaveProperty('pixelView');
    if (indexable) expect(requests[0]?.query).toHaveProperty('seoView', 'eligible');
    else expect(requests[0]?.query).not.toHaveProperty('seoView');
    const banner = page.getByTestId('tracking-consent-banner');
    await expect(banner).not.toContainText('Facebook Pixel');
    await banner.getByRole('button', { name: 'Accept', exact: true }).click();
    if (sessionAnalyticsEnabled)
      await expect.poll(() => sessions).toContainEqual(expect.objectContaining({ type: 'page_view', vehicleId: selectedId }));
    else {
      await page.waitForTimeout(850);
      expect(sessions).toEqual([]);
    }
    expect(sdkRequests).toEqual([]);
    expect(pixel).toEqual([]);
  } finally {
    await resetPublicFixture(request);
  }
});

test('only newly accepted selected public detail views and real contacts reach Pixel until withdrawal', async ({
  page, context, request, baseURL,
}) => {
  test.skip(!pixelId, 'Enable Meta with a synthetic fixture Pixel ID.');
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'This test requires an isolated public vehicle fixture.');
  const { pixel, sdkRequests, commands, contacts, sessions, events } = await interceptAdvertising(context, baseURL!);
  const selectedPath = `/zh/cars/${selectedId}/`;
  const selectedDetail = page.locator(`[data-public-vehicle-detail="${selectedId}"]`);
  const banner = page.getByTestId('tracking-consent-banner');
  await context.addInitScript((siteOrigin: string) => {
    if (location.origin !== siteOrigin) return;
    if (!localStorage.getItem('hd-auto:meta-advertising:v2')) localStorage.setItem('hd-auto:meta-advertising:v2', 'allow');
    if (!localStorage.getItem('hd-auto:privacy-choice:v3')) localStorage.setItem('hd-auto:privacy-choice:v3', 'allow');
  }, new URL(baseURL!).origin);
  await resetPublicFixture(request);
  try {
    await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
    await page.goto(selectedPath);
    await expect(selectedDetail).toBeVisible();
    await expect(selectedDetail).toHaveAttribute('data-meta-pixel-enabled', 'true');
    await expect(banner).toContainText('Facebook Pixel');
    if (sessionAnalyticsEnabled)
      await expect.poll(() => sessions).toContainEqual(expect.objectContaining({ type: 'page_view', vehicleId: selectedId }));
    else {
      await page.waitForTimeout(850);
      expect(sessions).toEqual([]);
    }
    expect(sdkRequests).toEqual([]);
    expect(pixel).toEqual([]);

    await page.goto('/zh/');
    await banner.getByRole('button', { name: '接受', exact: true }).click();
    await expect(banner).toHaveCount(0);
    await page.goto(`/zh/cars/${unselectedId}/`);
    const legacyDetail = page.locator(`[data-public-vehicle-detail="${unselectedId}"]`);
    await expect(legacyDetail).toBeVisible();
    await expect(legacyDetail).not.toHaveAttribute('data-meta-pixel-enabled', 'true');
    const otherContact = page.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible').last();
    const [otherPopup] = await Promise.all([page.waitForEvent('popup'), otherContact.click()]);
    await otherPopup.close();
    const unselectedContact = { vehicleId: unselectedId, channel: 'telegram' };
    await expect.poll(() => contacts).toEqual([unselectedContact]);
    expect(sdkRequests).toEqual([]);
    expect(pixel).toEqual([]);

    await page.goto('/zh/cars/?make=toyota&private=do-not-forward');
    await page.locator('html').evaluate(element => element.setAttribute('data-pixel-test-document', 'catalog'));
    const selectedCard = page.locator(`[data-public-vehicle="${selectedId}"]`);
    const catalogLink = selectedCard.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]');
    const [catalogPopup] = await Promise.all([page.waitForEvent('popup'), catalogLink.click()]);
    await catalogPopup.close();
    const catalogContact = { vehicleId: selectedId, channel: 'telegram' };
    await expect.poll(() => contacts).toEqual([unselectedContact, catalogContact]);
    const detailLink = selectedCard.locator('h2 a');
    await detailLink.hover();
    await page.waitForTimeout(850);
    expect(sdkRequests).toEqual([]);
    expect(pixel).toEqual([]);
    await detailLink.click();
    await expect(selectedDetail).toBeVisible();
    // Catalog cards open a new document to read current eligibility, even after a warm browse.
    await expect(page.locator('html')).not.toHaveAttribute('data-pixel-test-document', 'catalog');
    await expect.poll(() => events().sort()).toEqual(['PageView', 'ViewContent']);
    expect(contacts).toEqual([unselectedContact, catalogContact]);

    await page.locator('header a[aria-haspopup="dialog"]:visible').click();
    await expect(page.locator('dialog[open][aria-labelledby="site-enquiry-title"]')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(events()).toEqual(['PageView', 'ViewContent']);

    const contactLink = page.locator('[data-vehicle-contacts] a[data-analytics-contact="whatsapp"]:visible').last();
    await contactLink.hover();
    await contactLink.evaluate(anchor => {
      anchor.addEventListener('click', event => event.preventDefault(), { once: true });
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(contacts).toEqual([unselectedContact, catalogContact]);
    expect(pixel).toHaveLength(2);
    expect(sdkRequests).toEqual([sdkUrl]);
    const [popup] = await Promise.all([page.waitForEvent('popup'), contactLink.click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(contactHosts.has(new URL(popup.url()).hostname)).toBe(true);
    await popup.close();
    const selectedContact = { vehicleId: selectedId, channel: 'whatsapp' };
    await expect.poll(() => contacts).toEqual([unselectedContact, catalogContact, selectedContact]);
    await expect.poll(() => events().sort()).toEqual(['Contact', 'PageView', 'ViewContent']);

    const telegramContact = { vehicleId: selectedId, channel: 'telegram' };
    const telegramLink = selectedDetail.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible').last();
    const [telegramPopup] = await Promise.all([page.waitForEvent('popup'), telegramLink.click()]);
    await telegramPopup.close();
    await expect.poll(() => contacts).toEqual([unselectedContact, catalogContact, selectedContact, telegramContact]);

    const vehicleData = { content_type: 'product', content_ids: [selectedId] };
    await expect.poll(() => pixel).toEqual([
      ['trackSingle', pixelId, 'PageView'],
      ['trackSingle', pixelId, 'ViewContent', vehicleData],
      ['trackSingle', pixelId, 'Contact', { ...vehicleData, contact_channel: 'whatsapp' }],
      ['trackSingle', pixelId, 'Contact', { ...vehicleData, contact_channel: 'telegram' }],
    ]);
    expect(commands.filter(([method]) => method !== 'consent')).toEqual([
      ['set', 'autoConfig', false, pixelId], ['init', pixelId], ['set', 'trackSingleOnly', true, pixelId],
      ...pixel,
    ]);
    expect(sdkRequests).toEqual([sdkUrl]);

    await page.locator('html').evaluate(element => element.setAttribute('data-pixel-test-document', 'detail'));
    await page.locator('header a[href="/zh/buy/"]:visible').click();
    await expect(page.getByTestId('buy-guide')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-pixel-test-document', 'detail');
    await expect(selectedDetail).toHaveCount(0);
    await page.waitForTimeout(850);
    expect(pixel).toHaveLength(4);
    expect(sdkRequests).toEqual([sdkUrl]);

    // The legacy inspection endpoint redirects without rendering a document of its own.
    const inspection = await request.get(`${selectedPath}inspection/`, { maxRedirects: 0 });
    expect(inspection.status()).toBe(308);
    const inspectionDestination = new URL(inspection.headers().location, baseURL!);
    expect(inspectionDestination.pathname + inspectionDestination.hash).toBe(`${selectedPath}#inspection`);
    await page.goto('/zh/cars/fixture_demo/');
    await expect(page.locator('main[data-analytics-demo]')).toBeVisible();
    await authorizePreview(context, baseURL!);
    await installPreviewTransport(page, request);
    await openPreviewHost(page, 'zh');
    await waitForPreviewEvent(page, 'ready');
    await setPublicFixtureState(request, { importedWithdrawn: true });
    const missing = await page.goto(`/en/cars/${selectedId}/`);
    expect(missing?.status()).toBe(404);
    await page.waitForTimeout(850);
    expect(pixel).toHaveLength(4);
    expect(sdkRequests).toEqual([sdkUrl]);

    await setPublicFixtureState(request, { importedWithdrawn: false });
    await page.goto('/zh/privacy/');
    await page.getByTestId('privacy-analytics-withdraw').click();
    await expect(page.getByTestId('privacy-analytics-off')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('privacy-analytics-off')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('hd-auto:analytics-session:v2'))).toBeNull();
    await page.goto(selectedPath);
    await expect(selectedDetail).toBeVisible();
    await expect(banner).toHaveCount(0);
    const postWithdrawalLink = page.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible').last();
    const [postWithdrawalPopup] = await Promise.all([page.waitForEvent('popup'), postWithdrawalLink.click()]);
    await postWithdrawalPopup.close();
    await expect.poll(() => contacts).toEqual([
      unselectedContact,
      catalogContact,
      selectedContact,
      telegramContact,
      { vehicleId: selectedId, channel: 'telegram' },
    ]);
    await page.waitForTimeout(850);
    expect(pixel).toHaveLength(4);
    expect(sdkRequests).toEqual([sdkUrl]);
    if (!sessionAnalyticsEnabled) expect(sessions).toEqual([]);
  } finally {
    await resetPublicFixture(request);
  }
});

test('only a selected vehicle attributes a real contact from the general enquiry dialog', async ({ page, context, request, baseURL }) => {
  test.skip(!pixelId || !process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated Pixel-enabled vehicle fixture.');
  const { pixel, events, contacts, sdkRequests } = await interceptAdvertising(context, baseURL!);
  const vehicleData = { content_type: 'product', content_ids: [selectedId] };
  const dialog = page.getByRole('dialog', { name: 'Contact us' });
  const openDialog = page.locator('header a[aria-haspopup="dialog"]:visible');
  await resetPublicFixture(request);
  try {
    await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
    await page.goto(`/en/cars/${selectedId}/`);
    await page.getByTestId('tracking-consent-banner').getByRole('button', { name: 'Accept', exact: true }).click();
    await expect.poll(events).toEqual(['PageView', 'ViewContent']);
    await openDialog.click();
    await expect(dialog).toBeVisible();
    expect(events()).toEqual(['PageView', 'ViewContent']);
    const [selectedPopup] = await Promise.all([
      page.waitForEvent('popup'),
      dialog.getByRole('link', { name: 'WhatsApp', exact: true }).click(),
    ]);
    await selectedPopup.close();
    const expectedEvents = [
      ['trackSingle', pixelId, 'PageView'],
      ['trackSingle', pixelId, 'ViewContent', vehicleData],
      ['trackSingle', pixelId, 'Contact', { ...vehicleData, contact_channel: 'whatsapp' }],
    ];
    await expect.poll(() => pixel).toEqual(expectedEvents);

    for (const path of [`/en/cars/${unselectedId}/`, '/en/about/']) {
      await page.goto(path);
      await openDialog.click();
      await expect(dialog).toBeVisible();
      const [otherPopup] = await Promise.all([
        page.waitForEvent('popup'),
        dialog.getByRole('link', { name: 'Telegram', exact: true }).click(),
      ]);
      await otherPopup.close();
    }
    expect(pixel).toEqual(expectedEvents);
    expect(sdkRequests).toEqual([sdkUrl]);
    // The existing first-party vehicle count only includes vehicle-tagged links.
    expect(contacts).toEqual([]);
  } finally {
    await resetPublicFixture(request);
  }
});

const delayedSdkCases = (['script', 'configuration'] as const).flatMap(stage =>
  (['stay on the vehicle', 'leave the vehicle', 'withdraw in another tab'] as const).map(change => ({ stage, change })),
);
for (const { stage, change } of delayedSdkCases) {
  test(`a delayed SDK ${stage} rechecks the queued contact when visitors ${change}`, async ({ page, context, request, baseURL }) => {
    test.skip(!pixelId || !process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated Pixel-enabled vehicle fixture.');
    let release!: () => void;
    const sdkGate = new Promise<void>(resolve => { release = resolve; });
    const { commands, contacts, pixel, readyConfigs, sdkRequests } = await interceptAdvertising(context, baseURL!, { [stage]: sdkGate });
    await resetPublicFixture(request);
    try {
      await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
      await page.goto(`/en/cars/${selectedId}/`);
      const sdkSettled = Promise.race([
        page.waitForEvent('requestfinished', request => request.url() === sdkUrl),
        page.waitForEvent('requestfailed', request => request.url() === sdkUrl),
      ]);
      await page.getByTestId('tracking-consent-banner').getByRole('button', { name: 'Accept', exact: true }).click();
      await expect.poll(() => sdkRequests).toEqual([sdkUrl]);
      if (stage === 'configuration') {
        await expect.poll(() => commands).toContainEqual(['set', 'trackSingleOnly', true, pixelId]);
        expect(readyConfigs).toEqual([]);
      }
      const contact = page.locator('[data-vehicle-contacts] a[data-analytics-contact="whatsapp"]:visible').last();
      const [popup] = await Promise.all([page.waitForEvent('popup'), contact.click()]);
      await popup.close();
      await expect.poll(() => contacts).toEqual([{ vehicleId: selectedId, channel: 'whatsapp' }]);
      expect(pixel).toEqual([]);

      if (change === 'leave the vehicle') {
        await page.locator('header a[href="/en/buy/"]:visible').click();
        await expect(page.getByTestId('buy-guide')).toBeVisible();
      } else if (change === 'withdraw in another tab') {
        const privacyTab = await context.newPage();
        await privacyTab.goto('/en/privacy/');
        await privacyTab.getByTestId('privacy-analytics-withdraw').click();
        await expect(privacyTab.getByTestId('privacy-analytics-off')).toBeVisible();
        await privacyTab.close();
      }
      release();
      await sdkSettled;
      if (stage === 'configuration') await expect.poll(() => readyConfigs).toEqual([pixelId]);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (change === 'stay on the vehicle') {
        await expect.poll(() => pixel.map(command => command[2])).toEqual(['PageView', 'ViewContent', 'Contact']);
      } else {
        expect(commands.filter(([action]) => action === 'track' || action === 'trackSingle')).toEqual([]);
        if (stage === 'script') expect(commands.filter(([action]) => action === 'init')).toEqual([]);
      }
      expect(sdkRequests).toEqual([sdkUrl]);
    } finally {
      release();
      await resetPublicFixture(request);
    }
  });
}

test('a warm detail reopen uses the revised switch without a browser API request', async ({ page, context, request, baseURL }) => {
  test.skip(!pixelId, 'Enable Meta with a synthetic fixture Pixel ID.');
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'This test requires an isolated public vehicle fixture.');
  const { pixel, sdkRequests, events, browserApiRequests, contacts } = await interceptAdvertising(context, baseURL!);
  const detail = page.locator(`[data-public-vehicle-detail="${selectedId}"]`);

  await resetPublicFixture(request);
  try {
    await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
    await page.goto(`/en/cars/${selectedId}/`);
    await expect(detail).toHaveAttribute('data-meta-pixel-enabled', 'true');
    await page.getByTestId('tracking-consent-banner').getByRole('button', { name: 'Accept', exact: true }).click();
    await expect.poll(() => events().sort()).toEqual(['PageView', 'ViewContent']);
    expect(await readVehicleDetailRequests(request)).toEqual([expect.objectContaining({
      method: 'GET', serviceAuthenticated: true,
      query: expect.objectContaining({ view: 'localized', projection: 'detail-inline-v1', pixelView: 'eligible' }),
    })]);
    expect(browserApiRequests).toEqual([]);

    await setPublicFixtureState(request, { importedPixelEnabled: false });
    await page.reload();
    await expect(detail).toBeVisible();
    await expect(detail).not.toHaveAttribute('data-meta-pixel-enabled', 'true');
    await expect(page.getByTestId('tracking-consent-banner')).toHaveCount(0);
    const contactLink = detail.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible').last();
    const [popup] = await Promise.all([page.waitForEvent('popup'), contactLink.click()]);
    await popup.close();
    await expect.poll(() => contacts).toEqual([{ vehicleId: selectedId, channel: 'telegram' }]);
    await page.waitForTimeout(850);
    expect(pixel).toHaveLength(2);
    expect(sdkRequests).toEqual([sdkUrl]);
    expect(browserApiRequests).toEqual([]);
    expect(await readVehicleDetailRequests(request)).toHaveLength(2);
  } finally {
    await resetPublicFixture(request);
  }
});

test('restored detail revalidates Pixel eligibility before recording another event', async ({ page, context, request, baseURL }) => {
  test.skip(!pixelId, 'Enable Meta with a synthetic fixture Pixel ID.');
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'This test requires an isolated public vehicle fixture.');
  const { pixel, sdkRequests, events, browserApiRequests, contacts } = await interceptAdvertising(context, baseURL!);
  const detail = page.locator(`[data-public-vehicle-detail="${selectedId}"]`);
  const detailApi = `/api/v1/vehicles/${selectedId}/`;

  await resetPublicFixture(request);
  try {
    await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
    await page.goto(`/en/cars/${selectedId}/`);
    await expect(detail).toHaveAttribute('data-meta-pixel-enabled', 'true');
    await page.getByTestId('tracking-consent-banner').getByRole('button', { name: 'Accept', exact: true }).click();
    await expect.poll(() => events().sort()).toEqual(['PageView', 'ViewContent']);
    expect(browserApiRequests).toEqual([]);
    await page.evaluate(() => {
      document.documentElement.dataset.pixelTestDocument = 'before-restore';
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });

    await setPublicFixtureState(request, { importedPixelEnabled: false, responseDelayMs: 250 });
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === detailApi);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    const response = await refreshed;
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ data: { id: selectedId, pixelEnabled: false } });
    await expect(page.locator('html')).toHaveAttribute('data-pixel-test-document', 'before-restore');
    await expect(detail).toBeVisible();
    await expect(detail).not.toHaveAttribute('data-meta-pixel-enabled', 'true');

    const contact = detail.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible').last();
    const [popup] = await Promise.all([page.waitForEvent('popup'), contact.click()]);
    await popup.close();
    await expect.poll(() => contacts).toEqual([{ vehicleId: selectedId, channel: 'telegram' }]);
    await page.waitForTimeout(850);
    expect(pixel).toHaveLength(2);
    expect(sdkRequests).toEqual([sdkUrl]);
    expect(browserApiRequests).toHaveLength(1);
    const [read] = browserApiRequests;
    expect(read.method).toBe('GET');
    expect(read.url.pathname).toBe(detailApi);
    expect(Object.fromEntries(read.url.searchParams)).toMatchObject({
      view: 'localized', projection: 'detail-inline-v1', pixelView: 'eligible',
    });
  } finally {
    await resetPublicFixture(request);
  }
});

test('retries optional detail views once on an older API without using stale Pixel eligibility', async ({
  page, context, request, baseURL,
}) => {
  test.skip(!pixelId, 'Enable Meta with a synthetic fixture Pixel ID.');
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'This test requires an isolated public vehicle fixture.');
  const { pixel, sdkRequests, events, browserApiRequests, contacts } = await interceptAdvertising(context, baseURL!);
  const detailPath = `/zh/cars/${selectedId}/`;
  const detailApi = `/api/v1/vehicles/${selectedId}/`;
  const detail = page.locator(`[data-public-vehicle-detail="${selectedId}"]`);

  await resetPublicFixture(request);
  try {
    await setPublicFixtureState(request, {
      importedPublished: true, importedPixelEnabled: true, detailNegotiationUnsupported: true,
    });
    const legacyDocument = await page.goto(detailPath);
    expect(legacyDocument?.status()).toBe(200);
    await expect(detail).toBeVisible();
    await expect(detail).not.toHaveAttribute('data-meta-pixel-enabled', 'true');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const ssrAttempts = await readVehicleDetailRequests(request);
    // The document proxy and page render can retry separately, but share the successful DTO.
    expect(ssrAttempts).toHaveLength(indexable ? 3 : 2);
    expect(ssrAttempts.filter(({ query }) => !query.pixelView)).toEqual([
      expect.objectContaining({ method: 'GET', serviceAuthenticated: true, query: supportedDetailQuery }),
    ]);
    expect(ssrAttempts.filter(({ query }) => query.pixelView)).toEqual(
      Array.from({ length: indexable ? 2 : 1 }, () => expect.objectContaining({
        method: 'GET', serviceAuthenticated: true, query: negotiatedDetailQuery,
      })),
    );
    await page.getByTestId('tracking-consent-banner').getByRole('button', { name: '接受', exact: true }).click();
    await page.waitForTimeout(850);
    expect(sdkRequests).toEqual([]);
    expect(pixel).toEqual([]);
    expect(browserApiRequests).toEqual([]);

    await setPublicFixtureState(request, { detailNegotiationUnsupported: false });
    await page.reload();
    await expect(detail).toHaveAttribute('data-meta-pixel-enabled', 'true');
    await expect.poll(() => events().sort()).toEqual(['PageView', 'ViewContent']);
    await page.evaluate(() => {
      document.documentElement.dataset.pixelTestDocument = 'before-rollback';
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });

    await setPublicFixtureState(request, { detailNegotiationUnsupported: true, responseDelayMs: 250 });
    const [refreshed] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === detailApi),
      page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
    ]);
    expect(refreshed.status()).toBe(200);
    const legacyData = (await refreshed.json()).data;
    expect(legacyData).toMatchObject({ id: selectedId, detailPath, projection: 'detail-inline-v1' });
    expect(legacyData).not.toHaveProperty('pixelEnabled');
    expect(legacyData).not.toHaveProperty('seo');
    await expect(page.locator('html')).toHaveAttribute('data-pixel-test-document', 'before-rollback');
    await expect(detail).toBeVisible();
    await expect(detail).not.toHaveAttribute('data-meta-pixel-enabled', 'true');
    const proxyAttempts = await readVehicleDetailRequests(request, 'public');
    expect(proxyAttempts.map(({ method, query }) => [method, query])).toEqual([
      ['GET', negotiatedDetailQuery], ['GET', supportedDetailQuery],
    ]);
    expect(browserApiRequests.map(({ method, url }) => [method, url.pathname, Object.fromEntries(url.searchParams)])).toEqual([
      ['GET', detailApi, negotiatedDetailQuery],
    ]);

    const contact = detail.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible').last();
    const [popup] = await Promise.all([page.waitForEvent('popup'), contact.click()]);
    await popup.close();
    await expect.poll(() => contacts).toEqual([{ vehicleId: selectedId, channel: 'telegram' }]);
    await page.waitForTimeout(850);
    expect(pixel).toHaveLength(2);
    expect(sdkRequests).toEqual([sdkUrl]);
  } finally {
    await resetPublicFixture(request);
  }
});

test('restored details retry once when an older website proxy rejects the optional query', async ({
  page, context, request, baseURL,
}) => {
  test.skip(!pixelId, 'Enable Meta with a synthetic fixture Pixel ID.');
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'This test requires an isolated public vehicle fixture.');
  const { pixel, sdkRequests, events } = await interceptAdvertising(context, baseURL!);
  const detail = page.locator(`[data-public-vehicle-detail="${selectedId}"]`);
  const detailApi = `/api/v1/vehicles/${selectedId}/`;
  const origin = new URL(baseURL!).origin;
  const gatewayReads: Array<[string, Record<string, string>]> = [];
  await page.route(url => url.origin === origin && url.pathname === detailApi, (route) => {
    const incoming = route.request();
    const query = Object.fromEntries(new URL(incoming.url()).searchParams);
    gatewayReads.push([incoming.method(), query]);
    if (Object.hasOwn(query, 'pixelView') || Object.hasOwn(query, 'seoView'))
      return route.fulfill({ status: 400, json: { error: { code: 'INVALID_REQUEST' } } });
    return route.fallback();
  });

  await resetPublicFixture(request);
  try {
    await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
    await page.goto(`/zh/cars/${selectedId}/`);
    await expect(detail).toHaveAttribute('data-meta-pixel-enabled', 'true');
    await page.getByTestId('tracking-consent-banner').getByRole('button', { name: '接受', exact: true }).click();
    await expect.poll(() => events().sort()).toEqual(['PageView', 'ViewContent']);
    expect(gatewayReads).toEqual([]);

    const [legacyResponse] = await Promise.all([
      page.waitForResponse(response => response.ok() && new URL(response.url()).pathname === detailApi),
      page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      }),
    ]);
    expect((await legacyResponse.json()).data).not.toHaveProperty('pixelEnabled');
    await expect(detail).toBeVisible();
    await expect(detail).not.toHaveAttribute('data-meta-pixel-enabled', 'true');
    await page.waitForTimeout(850);
    expect(pixel).toHaveLength(2);
    expect(sdkRequests).toEqual([sdkUrl]);
    expect(gatewayReads).toEqual([
      ['GET', negotiatedDetailQuery], ['GET', supportedDetailQuery],
    ]);
    expect((await readVehicleDetailRequests(request, 'public')).map(({ method, query }) => [method, query])).toEqual([
      ['GET', supportedDetailQuery],
    ]);
  } finally {
    await resetPublicFixture(request);
  }
});
