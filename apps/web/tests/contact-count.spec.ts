import { seedAcceptedVisitor } from './helpers/accepted-visitor';
import { expect, test, type BrowserContext } from '@playwright/test';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

const sessionAnalyticsEnabled = process.env.ANALYTICS_V2_ENABLED !== 'false';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated public fixtures are required.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

async function captureContactRequests(context: BrowserContext, status = 202) {
  const counts: Array<{ body: unknown; clean: boolean }> = [];
  const sessions: Array<{ type: string }> = [];
  const meta: string[] = [];
  await context.route('**/api/v1/analytics/contact-count', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = await request.allHeaders();
    counts.push({
      body: request.postDataJSON(),
      clean: request.method() === 'POST' && !url.search &&
        headers.origin === url.origin && headers['content-type'] === 'application/json' &&
        !headers.cookie && !headers.referer,
    });
    await route.fulfill({ status });
  });
  await context.route('**/api/v1/analytics/events', async route => {
    sessions.push(...route.request().postDataJSON().events);
    await route.fulfill({ status: 202 });
  });
  await context.route(/^https:\/\/(?:wa\.me|api\.whatsapp\.com|t\.me)\//, route =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'Contact navigation intercepted locally' }));
  await context.route(/^https:\/\/(?:[^./]+\.)?(?:facebook\.com|facebook\.net)\//, route => {
    meta.push(route.request().url());
    return route.abort();
  });
  return { counts, sessions, meta };
}

test('an accepted public contact click sends only its vehicle and channel despite counter failure', async ({ page, context, request, baseURL }) => {
  await setPublicFixtureState(request, { importedPublished: true });
  await context.addCookies([{ name: 'ignored-counter-fixture', value: 'must-not-forward', url: baseURL! }]);
  await seedAcceptedVisitor(page, baseURL!);
  const { counts, sessions, meta } = await captureContactRequests(context, 503);
  const id = externalFixtureId(1);
  for (const [locale, channel, destination] of [
    ['zh', 'whatsapp', /^https:\/\/(?:wa\.me|api\.whatsapp\.com)\//],
    ['ru', 'telegram', /^https:\/\/t\.me\//],
  ] as const) {
    await page.goto(`/${locale}/cars/${id}/?private=never-send`);
    const detail = page.locator(`[data-public-vehicle-detail="${id}"]`);
    const link = detail.locator(`[data-vehicle-contacts] a[data-analytics-contact="${channel}"]:visible`).last();
    await expect(link).toBeVisible();
    const previousCount = counts.length;
    const previousSessionContacts = sessions.filter(event => event.type === 'contact_click').length;
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      link.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(destination);
    await popup.close();
    await expect.poll(() => counts.length).toBe(previousCount + 1);
    expect(counts.at(-1)).toEqual({ body: { vehicleId: id, channel }, clean: true });
    if (sessionAnalyticsEnabled)
      await expect.poll(() => sessions.filter(event => event.type === 'contact_click')).toHaveLength(previousSessionContacts + 1);
  }
  await page.reload();
  await expect(page.locator(`[data-public-vehicle-detail="${id}"]`)).toBeVisible();
  await page.waitForTimeout(850);
  expect(counts).toHaveLength(2);
  if (sessionAnalyticsEnabled) expect(sessions.filter(event => event.type === 'contact_click')).toHaveLength(2);
  else expect(sessions).toEqual([]);
  expect(meta).toEqual([]);
});

test('a real site-wide contact is recorded separately from the vehicle contact counter', async ({ page, context, request, baseURL }) => {
  await setPublicFixtureState(request, { importedPublished: true });
  await seedAcceptedVisitor(page, baseURL!);
  const { counts, sessions } = await captureContactRequests(context);
  const id = externalFixtureId(1);
  await page.goto('/en/cars/fixture_demo/');
  await expect(page.locator('[data-public-vehicle-detail][data-analytics-demo]')).toBeVisible();
  const demo = page.locator('[data-vehicle-contacts] a[data-analytics-contact="whatsapp"]:visible').last();
  const [demoPopup] = await Promise.all([page.waitForEvent('popup'), demo.click()]);
  await demoPopup.close();
  await page.goto(`/en/cars/${id}/`);
  const globalContact = page.locator('footer a[data-analytics-contact="telegram"]:visible').first();
  const [globalPopup] = await Promise.all([page.waitForEvent('popup'), globalContact.click()]);
  await globalPopup.close();
  const link = page.locator('[data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible').last();
  await link.hover();
  await link.evaluate(anchor => {
    anchor.addEventListener('click', event => event.preventDefault(), { once: true });
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  expect(counts).toEqual([]);
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.press('Enter')]);
  await popup.close();
  await expect.poll(() => counts).toEqual([{ body: { vehicleId: id, channel: 'telegram' }, clean: true }]);
  const contactEvents = () => sessions.filter(event => event.type === 'contact_click');
  if (sessionAnalyticsEnabled) {
    await expect.poll(contactEvents).toMatchObject([
      { type: 'contact_click', pageType: 'vehicle', channel: 'telegram' },
      { type: 'contact_click', pageType: 'vehicle', vehicleId: id, channel: 'telegram' },
    ]);
    expect(contactEvents()[0]).not.toHaveProperty('vehicleId');
  }
  await page.waitForTimeout(850);
  expect(counts).toHaveLength(1);
  expect(contactEvents()).toHaveLength(sessionAnalyticsEnabled ? 2 : 0);
});

test('public contact still opens before a decision, after decline and after withdrawal without reporting', async ({ page, context, request }) => {
  await setPublicFixtureState(request, { importedPublished: true, importedPixelEnabled: true });
  const { counts, sessions, meta } = await captureContactRequests(context);
  const id = externalFixtureId(1);
  const path = `/en/cars/${id}/`;
  const link = page.locator(`[data-public-vehicle-detail="${id}"] [data-vehicle-contacts] a[data-analytics-contact="telegram"]:visible`).last();
  async function expectContactWithoutReporting(expectedSessions = 0, expectedMeta = 0) {
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(/^https:\/\/t\.me\//);
    await popup.close();
    await page.waitForTimeout(850);
    expect(counts).toEqual([]);
    expect(sessions).toHaveLength(expectedSessions);
    expect(meta).toHaveLength(expectedMeta);
  }

  await page.goto(path);
  await expectContactWithoutReporting();

  await page.evaluate(() => {
    localStorage.setItem('hd-auto:privacy-choice:v3', 'deny');
    localStorage.setItem('hd-auto:meta-advertising:v2', 'deny');
  });
  await page.reload();
  await expectContactWithoutReporting();

  // Enter the public privacy page as a returning, accepted visitor before withdrawing.
  await page.evaluate(() => {
    localStorage.setItem('hd-auto:privacy-choice:v3', 'allow');
    localStorage.setItem('hd-auto:meta-advertising:v2', 'allow-sdk');
  });
  await page.goto('/en/privacy/');
  const withdraw = page.getByTestId('privacy-analytics-withdraw');
  await expect(withdraw).toBeVisible();
  await withdraw.click();
  await expect(page.getByTestId('privacy-analytics-off')).toBeVisible();
  const countsAtWithdrawal = { sessions: sessions.length, meta: meta.length };
  await page.goto(path);
  await expectContactWithoutReporting(countsAtWithdrawal.sessions, countsAtWithdrawal.meta);
});
