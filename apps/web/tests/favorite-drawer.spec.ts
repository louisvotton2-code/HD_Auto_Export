import { expect, test } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';
test.skip(
  !process.env.PUBLIC_FIXTURE_API_URL,
  'Requires the isolated public fixture, never operating inventory.',
);
const storageKey = 'hd-auto:vehicle-favorites:v1';
test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});
for (const locale of ['zh', 'en', 'ru']) {
  test(`${locale}: saved cars persist across routes and are removed through the header drawer`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/`);
    const heart = page.locator('[data-home-section^="vehicles-"] [data-vehicle-favorite]').first();
    const id = (await heart.getAttribute('data-vehicle-favorite'))!;
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey),
    ).toEqual({ version: 1, ids: [id] });
    await page.goto(`/${locale}/cars/${id}/`);
    await page.reload();
    await expect(page.locator('main [data-vehicle-favorite]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const trigger = page.locator('header button[aria-controls="vehicle-favorites"]');
    await trigger.click();
    const dialog = page.locator('#vehicle-favorites');
    const row = dialog.locator(`[data-favorite-vehicle="${id}"]`);
    await expect(row.locator('a[href]')).toHaveCount(2);
    await row.getByRole('button').click();
    await expect(dialog.locator('[data-favorite-vehicle]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.locator('main [data-vehicle-favorite]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
}

test('removed saved IDs do not revive stale titles/prices and closing cancels pending reads', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) =>
      localStorage.setItem(key, JSON.stringify({ version: 1, ids: ['missing_saved_car'] })),
    { key: storageKey },
  );
  await page.goto('/en/');
  await page.evaluate(() => { document.body.style.overflow = 'auto'; });
  const bodyOverflow = () => page.evaluate(() => document.body.style.overflow);
  const trigger = page.locator('header button[aria-controls="vehicle-favorites"]');
  await trigger.click();
  const dialog = page.locator('#vehicle-favorites');
  await expect(dialog).toContainText('This car is no longer available');
  await expect(dialog.locator('[data-favorite-vehicle] a')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close saved cars', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(bodyOverflow).toBe('auto');

  const savedRead = (url: URL) => url.pathname === '/api/v1/vehicles/missing_saved_car/';
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(savedRead, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  try {
    const [pending] = await Promise.all([
      page.waitForRequest((request) => savedRead(new URL(request.url()))),
      trigger.click(),
    ]);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    expect(await bodyOverflow()).toBe('hidden');
    await dialog.evaluate((drawer) => {
      const observer = new MutationObserver(() => {
        if (drawer.hasAttribute('open')) return;
        drawer.setAttribute('data-overflow-at-close', document.body.style.overflow);
        observer.disconnect();
      });
      observer.observe(drawer, { attributes: true, attributeFilter: ['open'] });
    });

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(dialog).toHaveAttribute('data-overflow-at-close', 'auto');
    expect(await bodyOverflow()).toBe('auto');
    await expect(trigger).toBeFocused();
    await expect.poll(() => pending.failure()?.errorText).toBe('net::ERR_ABORTED');
  } finally {
    release();
  }
});

test('rate limiting stops the saved-list queue until an explicit retry', async ({ page }) => {
  await page.addInitScript(
    ({ key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, ids: ['fixture_car_2', 'fixture_car_1'] }),
      ),
    { key: storageKey },
  );
  await page.goto('/en/');
  let calls = 0,
    second = 0;
  await page.route('**/api/v1/vehicles/fixture_car_2/**', async (route) => {
    calls++;
    if (calls === 1)
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '1' },
        contentType: 'application/json',
        body: '{}',
      });
    else await route.continue();
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/vehicles/fixture_car_1/') second++;
  });
  await page.locator('header button[aria-controls="vehicle-favorites"]').click();
  const dialog = page.locator('#vehicle-favorites');
  await expect(dialog.getByRole('button', { name: /Try again in/ })).toBeDisabled();
  expect(second).toBe(0);
  await expect(dialog.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  expect(calls).toBe(1);
  expect(second).toBe(0);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.locator('[data-favorite-vehicle="fixture_car_2"] a[href]')).toHaveCount(2);
  expect(calls).toBe(2);
  await expect(dialog.locator('[data-favorite-vehicle="fixture_car_1"] a[href]')).toHaveCount(2);
  expect(second).toBe(1);
  await page.keyboard.press('Escape');
});

for (const width of [1440, 1280, 1024, 390, 320]) {
  test(`Russian header and parts navigation fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto('/ru/');
    if (width < 1280) await page.locator('header summary[aria-controls="site-mobile-nav"]').click();
    const links = page.locator('header a[href="/ru/parts/"]:visible');
    await expect(links).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await links.click();
    await expect(page).toHaveURL(/\/ru\/parts\/$/);
    await expect(page.locator('main h1')).toBeVisible();
  });
}

test('saved current data retains reference-price and reserved-state semantics', async ({
  page,
  request,
}) => {
  const { setPublicFixtureState } = await import('./helpers/public-fixture');
  await setPublicFixtureState(request, { externalPublished: true });
  await page.addInitScript(
    ({ key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, ids: ['fixture_external', 'fixture_reserved'] }),
      ),
    { key: storageKey },
  );
  await page.goto('/en/');
  await page.locator('header button[aria-controls="vehicle-favorites"]').click();
  const dialog = page.locator('#vehicle-favorites');
  await expect(dialog.locator('[data-favorite-vehicle="fixture_external"]')).toContainText(
    'Reference price',
  );
  await expect(dialog.locator('[data-favorite-vehicle="fixture_reserved"]')).toContainText(
    'Reserved',
  );
});
