import { expect, test, type Locator } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

// OPS runs this against the isolated health-marked fixture, never against published inventory.
test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

async function documentTop(locator: Locator) {
  return locator.evaluate(node => node.getBoundingClientRect().top + window.scrollY);
}

test('catalog pagination shows immediate local busy feedback, retains its cards and recovers after an error', async ({ page }) => {
  await page.goto('/en/cars/?pageSize=2');
  const catalog = page.getByTestId('public-vehicle-catalog');
  const resource = page.locator('[data-resource-url]').filter({ has: catalog });
  await expect(resource).toHaveAttribute('data-freshness', 'fresh');
  const resourcePath = new URL((await resource.getAttribute('data-resource-url'))!, page.url()).pathname;
  const results = page.locator('#catalog-results');
  const cards = results.locator('[data-public-vehicle]');
  const retainedIds = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')));
  expect(retainedIds.length).toBe(2);
  const topBefore = await documentTop(cards.first());
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let fail = true;
  await page.route(url => url.pathname === resourcePath && url.searchParams.get('page') === '2', async route => {
    if (fail) {
      await held;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    } else await route.continue();
  });
  try {
    await results.locator('a[rel="next"]').click();
    await expect(results).toHaveAttribute('aria-busy', 'true');
    await expect(resource).toHaveAttribute('data-freshness', 'checking');
    expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')))).toEqual(retainedIds);
    expect(Math.abs(await documentTop(cards.first()) - topBefore)).toBeLessThan(1);
  } finally {
    release();
  }
  await expect(resource).toHaveAttribute('data-freshness', 'error');
  await expect(results).toHaveAttribute('aria-busy', 'false');
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')))).toEqual(retainedIds);
  fail = false;
  await results.getByTestId('public-resource-status').getByRole('button').click();
  await expect(resource).toHaveAttribute('data-freshness', 'fresh');
  await expect(results).toHaveAttribute('aria-busy', 'false');
  await expect(results.locator('[aria-current="page"]')).toHaveText('2');
});

test('a detail link reserves pending space, respects reduced motion and starts the destination at its heading', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/cars/?pageSize=2');
  const link = page.locator('[data-public-vehicle] h2 a').first();
  const destination = new URL((await link.getAttribute('href'))!, page.url());
  const hint = link.locator('[role="status"]');
  const before = await hint.evaluate(node => node.getBoundingClientRect().width);
  expect(before).toBeGreaterThan(0);
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route(url => url.pathname === destination.pathname, async route => {
    reads++;
    await held;
    await route.continue();
  });
  // Public vehicle links deliberately do not prefetch live inventory in the background.
  await link.hover();
  expect(reads).toBe(0);
  try {
    await link.click();
    await expect(hint).toHaveAttribute('data-link-pending', 'true');
    expect(await hint.evaluate(node => node.getBoundingClientRect().width)).toBe(before);
    expect(await hint.locator('[aria-hidden="true"]').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  } finally {
    release();
  }
  await expect(page.locator('[data-public-vehicle-detail]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('route skeletons do not change missing vehicle or invalid catalog queries into streamed success responses', async ({ request }) => {
  for (const locale of ['zh', 'en', 'ru']) {
    const missing = await request.get(`/${locale}/cars/fixture_ext07_missing/`);
    expect(missing.status()).toBe(404);
    const invalid = await request.get(`/${locale}/cars/?page=0`);
    expect(invalid.status()).toBe(404);
  }
});

test('vehicle details render their heading, price and contacts without JavaScript in all three languages', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const locale of ['zh', 'en', 'ru']) {
      const response = await page.goto(`/${locale}/cars/fixture_car_3/`);
      expect(response?.status()).toBe(200);
      const main = page.locator('main[data-public-vehicle-detail="fixture_car_3"]');
      await expect(main).toBeVisible();
      await expect(main.locator('h1')).toBeVisible();
      await expect(main.locator('h1')).toHaveText(/\S/);
      await expect(main.locator('[data-vehicle-original-price]').filter({ visible: true }).first()).toContainText(/\d/);
      await expect(main.locator('[data-vehicle-contacts] a[href^="https://t.me/"]').first()).toBeVisible();
      await expect(main.locator('[data-vehicle-contacts] a[href^="https://wa.me/"]').first()).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
