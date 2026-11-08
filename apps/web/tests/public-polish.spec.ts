import { expect, test } from '@playwright/test';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});
const governance =
  /展示样例|演示|虚构|第三方|外部车源|库存待核验|库存待确认|\bdemo\b|fictional|display example|external listing|stock not verified|демонстраци|вымышлен|внешнее объявление|наличие не проверено/i;
for (const locale of ['zh', 'en', 'ru']) {
  test(`${locale}: seven public pages and contact drafts have production wording`, async ({
    page,
  }) => {
    for (const path of [
      `/${locale}/`,
      `/${locale}/cars/`,
      `/${locale}/cars/fixture_car_2/`,
      `/${locale}/buy/`,
      `/${locale}/parts/`,
      `/${locale}/parts/52910k2200/`,
      `/${locale}/calculator/russia/`,
    ]) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.locator('main').innerText()).not.toMatch(governance);
      for (const link of await page.locator('main [data-vehicle-contacts] a[href]').all()) {
        const text =
          new URL((await link.getAttribute('href'))!, page.url()).searchParams.get('text') ?? '';
        expect(text).not.toMatch(governance);
      }
    }
  });
}

test('process and consultation cards have space for the top edge throughout hover', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/zh/');
  for (const [section, selector] of [
    ['buying-process', 'article'],
    ['reviews', 'button'],
  ] as const) {
    const scope = page.locator(`[data-home-section="${section}"]`);
    const card = scope.locator(selector).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.waitForTimeout(350);
    const result = await card.evaluate((node) => {
      const r = node.getBoundingClientRect(),
        parent = node.parentElement!.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 2);
      return { top: r.top, parentTop: parent.top, edgeVisible: !!hit && node.contains(hit) };
    });
    expect(result.top).toBeGreaterThanOrEqual(result.parentTop);
    expect(result.edgeVisible).toBe(true);
  }
});

for (const path of ['/en/', '/en/cars/', '/en/cars/fixture_car_2/']) {
  test(`initial SSR 429 respects Retry-After before its first browser request: ${path}`, async ({
    page,
    request,
  }) => {
    test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated fixture required.');
    await setPublicFixtureState(request, { publicRateLimited: true });
    let reads = 0;
    page.on('request', (req) => {
      if (/\/api\/v1\/(home\/vehicles|vehicles(?:\/[^/]+)?)\/?$/.test(new URL(req.url()).pathname))
        reads++;
    });
    await page.goto(path);
    const status = page.getByTestId('public-resource-status');
    await expect(status).toContainText('Too many requests');
    const retry = status.getByRole('button');
    await expect(retry).toBeDisabled();
    for (const link of await page.locator('main a[aria-disabled="true"]').all()) {
      await expect(link).not.toHaveAttribute('href');
      await link.dispatchEvent('click');
    }
    await expect(page.getByTestId('public-catalog-empty')).toHaveCount(0);
    await expect(page.getByTestId('public-vehicle-missing')).toHaveCount(0);
    if (path === '/en/')
      // The complete catalog total is available from successful facets even if the home selection is limited.
      await expect(
        page.getByTestId('hero-stat-catalog').locator('[data-counter-value]'),
      ).toHaveAttribute('data-counter-value', '26');
    await setPublicFixtureState(request, { publicRateLimited: false });
    await page.evaluate(() => {
      dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await retry.dispatchEvent('click');
    expect(reads).toBe(0);
    await expect(retry).toBeEnabled({ timeout: 4000 });
    await retry.click();
    await expect(page.locator('[data-resource-url]').first()).toHaveAttribute(
      'data-freshness',
      'fresh',
    );
    expect(reads).toBe(1);
  });
}

test('a newer same-URL history navigation replaces an older in-flight check', async ({
  page,
  request,
}) => {
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated fixture required.');
  await setPublicFixtureState(request, { futurePublished: true });
  await page.goto('/en/cars/fixture_future/');
  let count = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname.replace(/\/$/, '') === '/api/v1/vehicles/fixture_future',
    async (route) => {
      count++;
      if (count === 1) await held;
      await route.continue().catch(() => {});
    },
  );
  try {
    await page.evaluate(() => {
      history.pushState(null, '', '#first');
      history.back();
    });
    await expect.poll(() => count).toBe(1);
    await setPublicFixtureState(request, { futureAvailability: 'sold' });
    await page.evaluate(() => {
      history.pushState(null, '', '#second');
      history.back();
    });
    await expect.poll(() => count).toBe(2);
    await expect(page.locator('[data-resource-url]')).toHaveAttribute('data-freshness', 'fresh');
    await expect(page.locator('[data-availability="sold"]')).toBeVisible();
  } finally {
    release();
  }
});

test('a keyword change during cooldown waits for an explicit retry of results and facets', async ({
  page,
  request,
}) => {
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated fixture required.');
  await page.goto('/en/cars/?pageSize=2');
  await setPublicFixtureState(request, { publicRateLimited: true });
  const calls: string[] = [];
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname.replace(/\/$/, '');
    if (path === '/api/v1/vehicles' || path === '/api/v1/vehicle-filters') calls.push(path);
  });
  const form = page.locator('main form');
  await form.locator('[name="q"]').fill('Alpha Model');
  await form.locator('[type="submit"]').last().click();
  const status = page.getByTestId('public-resource-status');
  await expect(status).toContainText('Too many requests');
  await expect.poll(() => calls.length).toBe(2);
  const limitedAt = Date.now();
  await setPublicFixtureState(request, { publicRateLimited: false });
  await form.locator('[name="q"]').fill('Selected vehicle');
  await form.locator('[type="submit"]').last().click();
  await expect(page.getByTestId('public-filter-unavailable').locator('a')).not.toHaveAttribute(
    'href',
  );
  await page.waitForTimeout(Math.max(0, 2150 - (Date.now() - limitedAt)));
  expect(calls).toHaveLength(2);
  await status.getByRole('button').click();
  await expect(page.locator('[data-resource-url]')).toHaveAttribute('data-freshness', 'fresh');
  await expect.poll(() => calls.length).toBe(4);
  expect(calls.filter((path) => path === '/api/v1/vehicles')).toHaveLength(2);
  expect(calls.filter((path) => path === '/api/v1/vehicle-filters')).toHaveLength(2);
});

test('the hero vehicle link remains one line on desktop and narrow phones', async ({ page }) => {
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/zh/');
    const link = page.locator('[data-home-section="hero"] a[href="/zh/cars/"]');
    await expect(link).toBeVisible();
    expect(
      await link
        .locator('span')
        .first()
        .evaluate((node) => node.getClientRects().length),
    ).toBe(1);
    expect((await link.boundingBox())!.height).toBeLessThan(75);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
