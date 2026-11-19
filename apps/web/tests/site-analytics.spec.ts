import { expect, test, type Page } from '@playwright/test';
import { AnalyticsEventsRequestSchema, type AnalyticsEvent } from '@hd/contracts/analytics';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { authorizePreview, installPreviewTransport, openPreviewHost, waitForPreviewEvent } from './helpers/publication-preview';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated public and staff fixtures are required.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

async function capture(page: Page, status = 202) {
  const events: AnalyticsEvent[] = [];
  const invalid: string[] = [];
  const externalAnalytics: string[] = [];
  page.on('request', (request) => {
    if (/connect\.facebook\.net|facebook\.com\/tr(?:\/|\?|$)/.test(request.url())) externalAnalytics.push(request.url());
  });
  await page.route('**/api/v1/analytics/events', async (route) => {
    const request = route.request();
    const checked = AnalyticsEventsRequestSchema.safeParse(request.postDataJSON());
    const headers = await request.allHeaders();
    if (request.method() !== 'POST' || !checked.success ||
      headers.origin !== new URL(request.url()).origin ||
      (headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'same-origin') ||
      headers.referer || headers.cookie) invalid.push('Unexpected event body or headers');
    if (checked.success) events.push(...checked.data.events);
    await route.fulfill({ status, json: { data: { accepted: true }, meta: { requestId: 'fixture-analytics' } } });
  });
  return { events, invalid, externalAnalytics };
}

test('records one view per committed navigation, one vehicle click and one real contact click', async ({ page, context, request }) => {
  await setPublicFixtureState(request, { importedPublished: true });
  const { events, invalid, externalAnalytics } = await capture(page);
  await context.addCookies([{ name: 'ignored-analytics-fixture', value: 'must-not-forward', url: 'http://127.0.0.1:3100' }]);
  await context.route(/https:\/\/(?:wa\.me|t\.me)\//, (route) => route.fulfill({ status: 200, body: 'fixture-only' }));
  const id = externalFixtureId(1);
  await page.goto('/zh/cars/?make=toyota&campaign=must-not-send');
  await expect.poll(() => events.map(({ type, pageType }) => [type, pageType])).toEqual([['page_view', 'catalog']]);
  const detail = page.locator(`[data-public-vehicle="${id}"] h2 a`);
  await expect(detail).toBeVisible();
  await detail.hover();
  await page.evaluate(() => {
    const link = document.querySelector('a[data-analytics-contact]');
    if (link) {
      link.addEventListener('click', (event) => event.preventDefault(), { once: true });
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    location.hash = 'analytics-test-anchor';
  });
  await detail.click();
  await expect(page).toHaveURL(new RegExp(`/zh/cars/${id}/`));
  await expect.poll(() => events.length).toBe(3);
  expect(events.map(({ type, pageType }) => [type, pageType])).toEqual([
    ['page_view', 'catalog'], ['vehicle_click', 'catalog'], ['page_view', 'vehicle'],
  ]);
  expect(events.slice(1).every((event) => event.vehicleId === id && event.locale === 'zh')).toBe(true);
  await page.locator('[data-vehicle-contacts] a[data-analytics-contact="whatsapp"]').last().click();
  await expect.poll(() => events.length).toBe(4);
  expect(events.at(-1)).toMatchObject({ type: 'contact_click', pageType: 'vehicle', channel: 'whatsapp', vehicleId: id });
  expect(new Set(events.map(({ eventId }) => eventId)).size).toBe(4);
  expect(invalid).toEqual([]);
  expect(externalAnalytics).toEqual([]);
});

for (const locale of ['en', 'ru'] as const) {
  test(`${locale}: a failed analytics request does not obstruct a soft link or retry itself`, async ({ page }) => {
    const { events, invalid, externalAnalytics } = await capture(page, 503);
    await page.goto(`/${locale}/`);
    await expect.poll(() => events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: 'page_view', pageType: 'home', locale });
    await page.locator(`#home-shortcuts a[href="/${locale}/parts/"]`).click();
    await expect(page.getByTestId('parts-catalog')).toBeVisible();
    await expect.poll(() => events.length).toBe(2);
    expect(events[1]).toMatchObject({ type: 'page_view', pageType: 'parts', locale });
    expect(invalid).toEqual([]);
    expect(externalAnalytics).toEqual([]);
  });
}

test('excludes demo details and authenticated staff preview from page views', async ({ page, context, request, baseURL }) => {
  const { events } = await capture(page);
  await page.goto('/zh/cars/fixture_demo/');
  await expect(page.locator('[data-analytics-demo]')).toBeVisible();
  await authorizePreview(context, baseURL!);
  await installPreviewTransport(page, request);
  await openPreviewHost(page, 'zh');
  await waitForPreviewEvent(page, 'ready');
  expect(events).toEqual([]);
});

test('the legacy calculator entry counts only the destination actually displayed', async ({ page }) => {
  const { events, invalid } = await capture(page);
  await page.goto('/zh/calculator/');
  await expect(page).toHaveURL(/\/zh\/calculator\/russia\/$/);
  await expect.poll(() => events.length).toBe(1);
  expect(events[0]).toMatchObject({ type: 'page_view', pageType: 'calculator', locale: 'zh' });
  expect(invalid).toEqual([]);
});
