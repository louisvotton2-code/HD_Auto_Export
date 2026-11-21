import { expect, test, type BrowserContext } from '@playwright/test';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

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

test('a public contact click sends only its vehicle and channel despite counter failure', async ({ page, context, request, baseURL }) => {
  await setPublicFixtureState(request, { importedPublished: true });
  await context.addCookies([{ name: 'ignored-counter-fixture', value: 'must-not-forward', url: baseURL! }]);
  // The retired preference must confer no consent or activate old Meta tracking.
  await context.addInitScript(() => {
    localStorage.setItem('hd-auto:tracking-preferences:v1',
      JSON.stringify({ version: 1, analytics: true, advertising: true }));
  });
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
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      link.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toMatch(destination);
    await popup.close();
    await expect.poll(() => counts.length).toBe(previousCount + 1);
    expect(counts.at(-1)).toEqual({ body: { vehicleId: id, channel }, clean: true });
  }
  await page.reload();
  await expect(page.locator(`[data-public-vehicle-detail="${id}"]`)).toBeVisible();
  await page.waitForTimeout(850);
  expect(counts).toHaveLength(2);
  expect(sessions).toEqual([]);
  expect(meta).toEqual([]);
});

test('only real vehicle activation is counted, and an opted-in contact stays separate', async ({ page, context, request }) => {
  await setPublicFixtureState(request, { importedPublished: true });
  await context.addInitScript(() => {
    localStorage.setItem('hd-auto:privacy-choice:v3', 'allow');
  });
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
  await expect.poll(() => sessions.filter(event => event.type === 'contact_click')).toMatchObject([
    { type: 'contact_click', vehicleId: id, channel: 'telegram' },
  ]);
  await page.waitForTimeout(850);
  expect(counts).toHaveLength(1);
  expect(sessions.filter(event => event.type === 'contact_click')).toHaveLength(1);
});
