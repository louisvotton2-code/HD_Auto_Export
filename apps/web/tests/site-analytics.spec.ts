import { expect, test, type Page } from '@playwright/test';
import { AnalyticsEventsRequestSchema, type AnalyticsEvent } from '@hd/contracts/analytics';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { authorizePreview, installPreviewTransport, openPreviewHost, waitForPreviewEvent } from './helpers/publication-preview';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated public and staff fixtures are required.');
test.beforeEach(async ({ request, page }) => {
  await resetPublicFixture(request);
  await page.addInitScript(() => {
    if (!localStorage.getItem('hd-auto:privacy-choice:v3')) {
      localStorage.setItem('hd-auto:privacy-choice:v3', 'allow');
      localStorage.setItem('hd-auto:meta-advertising:v2', 'allow-sdk');
    }
  });
});
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
  await context.route('**/api/v1/analytics/contact-count', route => route.fulfill({ status: 202 }));
  await context.route(/https:\/\/(?:wa\.me|t\.me)\//, (route) => route.fulfill({ status: 200, body: 'fixture-only' }));
  const id = externalFixtureId(1);
  const started = Date.now();
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
  expect(events.slice(1).every((event) => 'vehicleId' in event && event.vehicleId === id && event.locale === 'zh')).toBe(true);
  await page.locator('[data-vehicle-contacts] a[data-analytics-contact="whatsapp"]').last().click();
  await expect.poll(() => events.length).toBe(4);
  expect(events.at(-1)).toMatchObject({ type: 'contact_click', pageType: 'vehicle', channel: 'whatsapp', vehicleId: id });
  expect(new Set(events.map(({ eventId }) => eventId)).size).toBe(4);
  expect(new Set(events.map(({ sessionId }) => sessionId)).size).toBe(1);
  expect(events[0]?.sessionId).toMatch(/^[\da-f-]{36}$/);
  expect(events.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3]);
  expect(events.map(({ entry }) => entry)).toEqual(['catalog', 'catalog', 'catalog', 'catalog']);
  const times = events.map(({ occurredAt }) => Date.parse(occurredAt ?? ''));
  expect(times.every(time => time >= started && time <= Date.now())).toBe(true);
  expect(times).toEqual([...times].sort((a, b) => a - b));
  expect(invalid).toEqual([]);
  expect(externalAnalytics).toEqual([]);
});

test('direct detail starts a separate session and never sends a raw acquisition URL', async ({ page, request }) => {
  await setPublicFixtureState(request, { importedPublished: true });
  const { events, invalid } = await capture(page);
  const id = externalFixtureId(1);
  const destination = `/zh/cars/${id}/?utm_campaign=catalog&utm_medium=cpc&utm_source=private/test&secret=never-send`;
  await page.goto(destination);
  await expect.poll(() => events.length).toBe(1);
  expect(events[0]).toMatchObject({ type: 'page_view', pageType: 'vehicle', vehicleId: id, entry: 'vehicle', sequence: 0, campaign: 'catalog', source: 'paid' });
  expect(JSON.stringify(events)).not.toMatch(/private|never-send|utm_/);
  const session = events[0]?.sessionId;
  await page.evaluate(() => {
    const key = 'hd-auto:analytics-session:v2';
    const previous = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify({ ...previous, lastActivity: previous.lastActivity - 30 * 60 * 1000 }));
  });
  await page.reload();
  await expect.poll(() => events.length).toBe(2);
  expect(events[1]).toMatchObject({ type: 'page_view', pageType: 'vehicle', entry: 'vehicle', sequence: 0 });
  expect(events[1]?.sessionId).not.toBe(session);
  expect(invalid).toEqual([]);
});

test('history restore applies a stored consent change before sending a view', async ({ page }) => {
  const { events } = await capture(page);
  await page.goto('/zh/');
  await expect.poll(() => events.length).toBe(1);
  await page.evaluate(() => {
    localStorage.setItem('hd-auto:privacy-choice:v3', 'deny');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('hd-auto:analytics-session:v2'))).toBeNull();
  await page.waitForTimeout(850);
  expect(events).toHaveLength(1);
  await page.evaluate(() => {
    localStorage.setItem('hd-auto:privacy-choice:v3', 'allow');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => events.length).toBe(2);
  await page.waitForTimeout(850);
  expect(events).toHaveLength(2);
  // A different document in this tab can clear the session while this page is frozen.
  await page.evaluate(() => {
    sessionStorage.removeItem('hd-auto:analytics-session:v2');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => events.length).toBe(3);
  expect(events[2]).toMatchObject({ entry: 'home', sequence: 0 });
  expect(events[2]?.sessionId).not.toBe(events[1]?.sessionId);
});

test('only a successful empty search and an intentional completed calculation are counted', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T04:00:00Z'));
  const { events, invalid } = await capture(page);
  await page.goto('/zh/cars/');
  await expect.poll(() => events.length).toBe(1);
  const form = page.locator('main form');
  await form.locator('[name="q"]').fill('private-no-result-fixture');
  await form.locator('button[type="submit"]').first().click();
  await expect(page.getByTestId('public-catalog-empty')).toBeVisible();
  await expect.poll(() => events.map(event => event.type)).toEqual(['page_view', 'filter_submit', 'search_zero_results']);
  expect(JSON.stringify(events)).not.toContain('private-no-result-fixture');
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('[data-testid="total"], [data-testid="manufacture-range-total"]')).toBeVisible();
  await expect.poll(() => events.length).toBe(4);
  await page.waitForTimeout(550);
  expect(events.map(event => event.type)).not.toContain('calculator_complete');
  await page.locator('[name="price"]').fill('26000');
  await expect.poll(() => events.map(event => event.type)).toEqual([
    'page_view', 'filter_submit', 'search_zero_results', 'page_view', 'calculator_complete',
  ]);
  expect(events.every(event => event.entry === 'catalog' && Boolean(event.occurredAt))).toBe(true);
  expect(invalid).toEqual([]);
});

for (const [locale, status] of [['en', 429], ['ru', 500]] as const) {
  test(`${locale}: analytics HTTP ${status} does not obstruct a soft link or retry itself`, async ({ page }) => {
    const { events, invalid, externalAnalytics } = await capture(page, status);
    await page.goto(`/${locale}/`);
    await expect.poll(() => events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: 'page_view', pageType: 'home', locale });
    await page.locator(`#home-shortcuts a[href="/${locale}/parts/"]`).click();
    await expect(page.getByTestId('parts-catalog')).toBeVisible();
    await expect.poll(() => events.length).toBe(2);
    expect(events[1]).toMatchObject({ type: 'page_view', pageType: 'parts', locale });
    await page.waitForTimeout(1400);
    expect(events).toHaveLength(2);
    expect(invalid).toEqual([]);
    expect(externalAnalytics).toEqual([]);
  });
}

test('excludes demo details and authenticated staff preview from page views', async ({ page, context, request, baseURL }) => {
  const { events } = await capture(page);
  await page.goto('/zh/cars/fixture_demo/');
  await expect(page.locator('main[data-analytics-demo]')).toBeVisible();
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
