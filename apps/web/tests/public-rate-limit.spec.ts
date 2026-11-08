import { expect, test, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

const suite = 'hd-web-public-catalog-v1';
const fixtureOrigin = process.env.PUBLIC_FIXTURE_API_URL;
if (fixtureOrigin) {
  const url = new URL(fixtureOrigin);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '3327' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Rate-limit regressions require isolated fixture API 3327, never real API 3320.');
}
async function setRateLimited(request: APIRequestContext, value: boolean) {
  expect(fixtureOrigin).toBeTruthy();
  const health = await request.get(`${fixtureOrigin}/__fixtures/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ suite });
  const response = await request.put(`${fixtureOrigin}/__fixtures/state`, {
    data: { publicRateLimited: value },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).suite).toBe(suite);
}
const pathOf = (url: string) => new URL(url).pathname.replace(/\/$/, '');
const isBusiness = (request: Request) =>
  /^\/api\/v1\/(?:home\/vehicles|vehicles(?:\/[^/]+)?|vehicle-filters)$/.test(pathOf(request.url()));
const contacts = (scope: Locator) => scope.locator(
  '[data-vehicle-contacts] a[href^="https://t.me/"], [data-vehicle-contacts] a[href^="https://wa.me/"]',
);
async function resourceFor(page: Page, path: string) {
  const wrappers = page.locator('[data-resource-url]');
  await expect.poll(() => wrappers.count()).toBeGreaterThan(0);
  for (const wrapper of await wrappers.all()) {
    const url = await wrapper.getAttribute('data-resource-url');
    if (url && pathOf(new URL(url, page.url()).href) === path) return wrapper;
  }
  throw new Error(`No resource wrapper for ${path}`);
}

test.describe('public 429 preservation and Retry-After cooldown', () => {
  test.skip(!fixtureOrigin, 'Uses only the isolated 3327 fixture and the 3100 website.');
  test.beforeEach(async ({ request, baseURL }) => {
    const web = new URL(baseURL!);
    expect(['localhost', '127.0.0.1']).toContain(web.hostname);
    expect(web.protocol).toBe('http:');
    expect(web.port, 'Never run these controls against real website 3317').toBe('3100');
    await resetPublicFixture(request);
  });
  test.afterEach(async ({ request }) => { await resetPublicFixture(request); });

  for (const scenario of [
    { locale: 'zh', rateMessage: /频繁|请求过多|请求较多|限流/, retryCountdown: /[12]\s*秒/ },
    { locale: 'ru', rateMessage: /слишком много|лимит|част.*запрос/i, retryCountdown: /[12]\s*(?:с|сек)/i },
    { locale: 'en', rateMessage: /too many|rate.limit|temporar.*limit/i, retryCountdown: /[12]\s*(?:s\b|seconds?)/i },
  ]) {
    test(`${scenario.locale}: only an explicit catalog filter triggers 429, and repeated filtering respects cooldown`, async ({ page, request }) => {
      await page.goto(`/${scenario.locale}/cars/?q=Alpha+Model&page=2&pageSize=2`);
      const current = await resourceFor(page, '/api/v1/vehicles');
      await expect(current).toHaveAttribute('data-freshness', 'fresh');
      await expect(current.locator('[data-public-vehicle]')).toHaveCount(2);
      expect(await contacts(current).count()).toBeGreaterThan(0);
      const form = page.locator('main form').first();
      await form.locator('select[name="make"]').selectOption('alpha');
      await page.evaluate(() => window.scrollTo(0, 200));
      const before = {
        heading: await page.locator('main h1').textContent(),
        image: await current.locator('img').first().getAttribute('src'),
      };
      await setRateLimited(request, true);
      const outgoing: Request[] = [];
      const collect = (entry: Request) => outgoing.push(entry);
      page.on('request', collect);
      try {
        const limitedResponse = page.waitForResponse((response) => pathOf(response.url()) === '/api/v1/vehicles');
        await form.locator('[type="submit"]').click();
        const response = await limitedResponse;
        const limitedAt = Date.now();
        expect(response.status()).toBe(429);
        expect(response.headers()['retry-after']).toBe('2');
        await expect(current).toHaveAttribute('data-freshness', 'error');
        const status = current.getByTestId('public-resource-status');
        await expect(status).toContainText(scenario.rateMessage);
        await expect(status).toContainText(scenario.retryCountdown);
        await expect(contacts(current)).toHaveCount(0);
        await expect(current.locator('[data-availability="available"]')).toHaveCount(0);
        const retry = status.getByRole('button');
        await expect(retry).toBeVisible();
        const scroll = await page.evaluate(() => scrollY);

        // Recovery of the fixture alone must not bypass the browser's retained Retry-After.
        await setRateLimited(request, false);
        await form.locator('select[name="powertrain"]').selectOption('bev');
        await form.locator('[type="submit"]').click();
        // An explicit DOM event also checks the guard if a UI variant leaves retry enabled.
        await retry.dispatchEvent('click');
        await page.waitForTimeout(180);
        expect(outgoing.filter(isBusiness)).toHaveLength(1);
        await expect(current).toHaveAttribute('data-freshness', 'error');
        await expect(status).toContainText(scenario.rateMessage);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('main h1')).toHaveText(before.heading!);
        await expect(current.locator('img').first()).toHaveAttribute('src', before.image!);
        await expect(current.locator('[data-public-vehicle]')).toHaveCount(2);
        expect(await page.evaluate(() => scrollY)).toBe(scroll);
        await expect(form.locator('select[name="make"]')).toHaveValue('alpha');
        await expect(form.locator('input[name="q"]')).toHaveValue('Alpha Model');
        await expect(form.locator('select[name="powertrain"]')).toHaveValue('bev');

        await page.waitForTimeout(Math.max(0, 2150 - (Date.now() - limitedAt)));
        expect(outgoing.filter(isBusiness)).toHaveLength(1); // No automatic request at expiry.
        const recovered = page.waitForResponse((entry) => pathOf(entry.url()) === '/api/v1/vehicles' && entry.status() === 200);
        await retry.click();
        await recovered;
        await expect(current).toHaveAttribute('data-freshness', 'fresh');
        expect(await contacts(current).count()).toBeGreaterThan(0);
        await expect(status).not.toBeVisible();
        expect(outgoing.filter(isBusiness)).toHaveLength(2);
        expect(outgoing.filter((entry) => entry.resourceType() === 'document' || entry.headers().rsc === '1')).toHaveLength(0);
      } finally { page.off('request', collect); }
    });
  }

  test('the public BFF preserves 429 and Retry-After, while malformed queries remain errors and media stays readable', async ({ request }) => {
    await setRateLimited(request, true);
    for (const endpoint of ['home/vehicles', 'vehicles', 'vehicles/fixture_car_2']) {
      const response = await request.get(`/api/v1/${endpoint}/?locale=en`);
      expect(response.status()).toBe(429);
      expect(response.headers()['retry-after']).toBe('2');
      expect(response.headers()['cache-control']).toBe('no-store');
      const body = await response.json();
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.retryable).toBe(true);
      expect(body.data, 'A limited service must not be presented as an empty inventory').toBeUndefined();
    }
    for (const query of ['page=0', 'page=1&page=2', `q=${'x'.repeat(101)}`]) {
      const response = await request.get(`/api/v1/vehicles/?locale=en&${query}`);
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.data).toBeUndefined();
    }
    const media = await request.get('/api/v1/media/media_fixture_demo/?variant=thumb');
    expect(media.status()).toBe(200);
    expect(media.headers()['content-type']).toMatch(/^image\//);
  });
});
