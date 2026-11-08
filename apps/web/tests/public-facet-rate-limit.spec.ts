import { expect, test, type Page, type Request } from '@playwright/test';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

const fixtureOrigin = process.env.PUBLIC_FIXTURE_API_URL;
if (fixtureOrigin) {
  const url = new URL(fixtureOrigin);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port !== '3327' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Facet-limit regressions require isolated fixture 3327, never operating API 3320.',
    );
}
const pathOf = (url: string) => new URL(url).pathname.replace(/\/$/, '');
const isBusiness = (request: Request) =>
  /^\/api\/v1\/(?:home\/vehicles|vehicles(?:\/[^/]+)?|vehicle-filters)$/.test(
    pathOf(request.url()),
  );
function collectBusiness(page: Page) {
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (isBusiness(request)) requests.push(request);
  });
  return requests;
}
async function expectExistingCars(page: Page, home: boolean, catalogTotalKnown = false) {
  await expect(page.locator('main [data-public-vehicle]')).toHaveCount(home ? 3 : 2);
  await expect(page.getByTestId('home-catalog-empty')).toHaveCount(0);
  await expect(page.getByTestId('home-catalog-error')).toHaveCount(0);
  await expect(page.getByTestId('public-catalog-empty')).toHaveCount(0);
  await expect(page.getByTestId('public-catalog-error')).toHaveCount(0);
  await expect(page.getByTestId('public-vehicle-missing')).toHaveCount(0);
  // Home cards can remain valid while the full-catalog dictionary total is unknown.
  if (home)
    await expect(
      page.getByTestId('hero-stat-catalog').locator('[data-counter-value]'),
    ).toHaveAttribute('data-counter-value', catalogTotalKnown ? '26' : 'unknown');
}

test.describe('facets-only Retry-After shares the page cooldown', () => {
  test.skip(!fixtureOrigin, 'Only the health-marked fixture API is mutated.');
  test.beforeEach(async ({ request, baseURL }) => {
    const web = new URL(baseURL!);
    expect(['127.0.0.1', 'localhost']).toContain(web.hostname);
    expect(web.protocol).toBe('http:');
    expect(web.port, 'Do not run against real website 3317').toBe('3100');
    await resetPublicFixture(request);
  });
  test.afterEach(async ({ request }) => {
    await resetPublicFixture(request);
  });

  for (const entry of [
    { name: 'home', route: '/en/', home: true },
    { name: 'catalog', route: '/en/cars/?pageSize=2', home: false },
  ]) {
    test(`${entry.name}: successful SSR cars plus limited facets retain real content and start a quiet cooldown`, async ({
      page,
      request,
    }) => {
      await setPublicFixtureState(request, { filtersRateLimited: true });
      const limited = await request.get('/api/v1/vehicle-filters/?locale=en');
      expect(limited.status()).toBe(429);
      expect(limited.headers()['retry-after']).toBe('2');
      expect((await limited.json()).error.code).toBe('RATE_LIMITED');
      const requests = collectBusiness(page); // Includes hydration: no blind spot after goto.
      await page.goto(entry.route);
      await expectExistingCars(page, entry.home);
      const status = page.getByTestId('public-resource-status');
      await expect(status).toContainText('Too many requests');
      await expect(status.getByRole('button')).toBeDisabled();
      const limitedAt = Date.now();
      if (!entry.home) {
        const warning = page.getByTestId('public-filter-unavailable').locator('a').first();
        await expect(warning).not.toHaveAttribute('href');
        await warning.dispatchEvent('click');
      }
      await setPublicFixtureState(request, { filtersRateLimited: false });
      await status.getByRole('button').dispatchEvent('click');
      await page.waitForTimeout(180);
      expect(requests).toHaveLength(0);
      await page.waitForTimeout(Math.max(0, 2150 - (Date.now() - limitedAt)));
      expect(requests).toHaveLength(0); // Expiry alone never starts a request.
      await expectExistingCars(page, entry.home);
      if (entry.home) {
        // Successful home data must not hide a still-failed dictionary or its explicit recovery.
        await expect(status).toBeVisible();
        await expect(status.getByRole('button')).toBeEnabled();
        await expect(page.locator('[data-home-section="popular-models"]')).toHaveCount(0);
        await status.getByRole('button').click();
        await expect.poll(() => requests.length).toBe(2);
        expect(
          requests.filter((request) => pathOf(request.url()) === '/api/v1/home/vehicles'),
        ).toHaveLength(1);
        expect(
          requests.filter((request) => pathOf(request.url()) === '/api/v1/vehicle-filters'),
        ).toHaveLength(1);
        await expect(
          page.locator('[data-home-section="popular-models"] a[href*="model="]'),
        ).toHaveCount(2);
        await expect(status).not.toBeVisible();
        await expectExistingCars(page, true, true);
      }
    });
  }

  test('a later successful main response cannot clear a newer facets cooldown, and explicit retry fetches both latest queries', async ({
    page,
    request,
  }) => {
    await page.goto('/en/cars/?pageSize=2');
    await expect(page.locator('[data-resource-url]')).toHaveAttribute('data-freshness', 'fresh');
    await setPublicFixtureState(request, { filtersRateLimited: true });
    const requests = collectBusiness(page);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldOnce = false;
    const matcher = (url: URL) => pathOf(url.href) === '/api/v1/vehicles';
    await page.route(matcher, async (route) => {
      if (!heldOnce) {
        heldOnce = true;
        await held;
      }
      await route.continue();
    });
    try {
      const form = page.locator('main form');
      const facets429 = page.waitForResponse(
        (response) =>
          pathOf(response.url()) === '/api/v1/vehicle-filters' && response.status() === 429,
      );
      await form.locator('[name="q"]').fill('Alpha Model');
      await form.locator('[type="submit"]').last().click();
      const response = await facets429;
      expect(response.headers()['retry-after']).toBe('2');
      const limitedAt = Date.now();
      const status = page.getByTestId('public-resource-status');
      await expect(status).toContainText('Too many requests');
      await setPublicFixtureState(request, { filtersRateLimited: false });
      const main200 = page.waitForResponse(
        (entry) => pathOf(entry.url()) === '/api/v1/vehicles' && entry.status() === 200,
      );
      release();
      await main200;
      await expect(page.locator('[data-public-vehicle="fixture_car_2"]')).toBeVisible();
      await expect(status).toContainText('Too many requests');
      await expect(status.getByRole('button')).toBeDisabled();
      await expect(page.getByTestId('public-catalog-empty')).toHaveCount(0);
      expect(requests).toHaveLength(2);

      await form.locator('[name="q"]').fill('Selected vehicle');
      await form.locator('[type="submit"]').last().click();
      const warning = page.getByTestId('public-filter-unavailable').locator('a').first();
      await expect(warning).not.toHaveAttribute('href');
      await warning.dispatchEvent('click');
      await status.getByRole('button').dispatchEvent('click');
      await page.waitForTimeout(180);
      expect(requests).toHaveLength(2);
      await page.waitForTimeout(Math.max(0, 2150 - (Date.now() - limitedAt)));
      expect(requests).toHaveLength(2);
      await warning.click();
      await expect(page.locator('[data-resource-url]')).toHaveAttribute('data-freshness', 'fresh');
      await expect.poll(() => requests.length).toBe(4);
      for (const request of requests.slice(2))
        expect(new URL(request.url()).searchParams.get('q')).toBe('Selected vehicle');
      expect(requests.filter((entry) => pathOf(entry.url()) === '/api/v1/vehicles')).toHaveLength(
        2,
      );
      expect(
        requests.filter((entry) => pathOf(entry.url()) === '/api/v1/vehicle-filters'),
      ).toHaveLength(2);
      await expect(page.locator('[data-public-vehicle="fixture_demo"]')).toHaveCount(0);
      await expect(form.locator('select[name="make"] option[value="beta"]')).toHaveCount(1);
      await expect(page.getByTestId('public-filter-unavailable')).toHaveCount(0);
    } finally {
      release();
      await page.unroute(matcher);
    }
  });

  test('without JavaScript, home and catalog retain a native reload path when only facets are limited', async ({
    browser,
    baseURL,
    request,
  }) => {
    for (const entry of [
      { route: '/en/', home: true },
      { route: '/en/cars/?pageSize=2', home: false },
    ]) {
      await setPublicFixtureState(request, { filtersRateLimited: true });
      const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        await page.goto(entry.route);
        await expectExistingCars(page, entry.home);
        await expect(page.getByTestId('public-resource-status')).toContainText('Too many requests');
        const reload = page
          .locator('noscript a[href]')
          .filter({ hasText: /reload|try again|check again|retry/i })
          .first();
        await expect(reload).toBeVisible();
        const target = new URL((await reload.getAttribute('href'))!, page.url());
        expect(target.origin).toBe(new URL(baseURL!).origin);
        expect(target.pathname).toBe(new URL(page.url()).pathname);
        await setPublicFixtureState(request, { filtersRateLimited: false });
        const document = page.waitForResponse(
          (response) =>
            response.request().isNavigationRequest() &&
            response.request().resourceType() === 'document',
        );
        await reload.click();
        expect((await document).status()).toBe(200);
        await expect(page.getByTestId('public-resource-status')).not.toBeVisible();
        await expectExistingCars(page, entry.home, true);
        if (!entry.home)
          await expect(page.locator('select[name="make"] option[value="beta"]')).toHaveCount(1);
      } finally {
        await context.close();
      }
    }
  });
});
