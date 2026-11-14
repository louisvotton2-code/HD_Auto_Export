import { expect, test } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

const vin = 'LHGCM82633A004352';
const copyLabels = { zh: '复制 VIN', en: 'Copy VIN', ru: 'Скопировать VIN' };
const copiedLabels = { zh: 'VIN 已复制', en: 'VIN copied', ru: 'VIN скопирован' };

test('the VIN tile keeps the complete number, copies with feedback and never claims a failed copy succeeded', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await context.newPage();
    for (const [locale, width] of [['zh', 1440], ['en', 390], ['ru', 320]] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/${locale}/cars/fixture_car_3/`);
      const tile = page.locator('[data-public-vehicle-vin]');
      await expect(tile).toHaveCount(1); // The basic-information list must not repeat it.
      await expect(tile).toBeVisible();
      const number = tile.locator('[data-vin-value]');
      await expect(number).toHaveText(vin);
      expect(await number.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await tile.getByRole('button', { name: copyLabels[locale], exact: true }).click();
      await expect(tile.getByRole('status')).toHaveText(copiedLabels[locale]);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(vin);
    }

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new DOMException('Denied by the isolated test', 'NotAllowedError'); } },
      });
    });
    await page.goto('/en/cars/fixture_car_3/');
    const tile = page.locator('[data-public-vehicle-vin]');
    await tile.getByRole('button', { name: copyLabels.en, exact: true }).click();
    await expect(tile.getByRole('status')).toHaveText('Unable to copy. Select the number to copy it manually.');
    await expect(tile.locator('[data-vin-copy-state]')).toHaveAttribute('data-vin-copy-state', 'failed');
    await expect(tile.locator('[data-vin-value]')).toHaveText(vin);

    await page.goto('/en/cars/fixture_car_4/');
    await expect(page.locator('[data-public-vehicle-detail]')).toBeVisible();
    await expect(page.locator('[data-public-vehicle-vin]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
