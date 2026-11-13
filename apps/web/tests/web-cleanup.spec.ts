import { expect, test } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

const errorCopy = { zh: '页面未找到', en: 'Page not found', ru: 'Страница не найдена' };
for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: gateway error body is standalone, readable and does not read inventory`, async ({ browser, baseURL, request }, testInfo) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
    const page = await context.newPage();
    try {
      const response = await page.goto(`/404/${locale}/?vehicle=PRIVATE_SENTINEL`);
      expect(response?.status()).toBe(200); // Body source only; OPS preserves the original vehicle 404.
      expect(response?.headers()['cache-control']).toContain('no-store');
      expect(response?.headers()['x-robots-tag']).toContain('noindex');
      expect(response?.headers()['x-content-type-options']).toBe('nosniff');
      await expect(page.locator('html')).toHaveAttribute('lang', locale === 'zh' ? 'zh-Hans' : locale);
      await expect(page.locator('main h1')).toHaveText('404');
      await expect(page.locator('main')).toContainText(errorCopy[locale]);
      await expect(page.locator('main')).toContainText('HD Auto Export / 404');
      await expect(page.locator('script')).toHaveCount(0);
      expect(await page.content()).not.toContain('PRIVATE_SENTINEL');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const lang of ['zh', 'en', 'ru']) await expect(page.locator(`main a[href="/${lang}/"]`)).toBeVisible();
      const reads = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
      expect(reads.requests).toHaveLength(0);
      await page.screenshot({ path: testInfo.outputPath(`fallback-${locale}.png`) });
      await page.locator(`main a[href="/${locale}/"]`).click();
      await expect(page.locator('main')).not.toHaveText('');
      expect(new URL(page.url()).pathname).toBe(`/${locale}/`);
    } finally { await context.close(); }
  });
}

test('retained contact styles keep card and mobile detail links usable', async ({ page }, testInfo) => {
  await page.goto('/en/cars/?pageSize=5');
  const cardContacts = page.locator('main [data-vehicle-contacts]').first();
  const telegram = cardContacts.locator('a[href^="https://t.me/HD_Auto_CN"]');
  await expect(cardContacts.locator('a')).toHaveCount(2);
  // The real card's existing parent rule overrides the shared 40px default.
  await expect(telegram).toHaveCSS('width', '36px');
  await expect(telegram).toHaveCSS('height', '36px');
  await expect(telegram).toHaveCSS('border-radius', '50%');
  await telegram.hover();
  await expect(telegram).toHaveCSS('background-color', 'rgb(23, 134, 188)');
  await page.keyboard.press('Tab');
  await telegram.focus();
  await expect(telegram).toHaveCSS('outline-style', 'solid');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(telegram).toHaveCSS('transition-duration', '0s');
  await cardContacts.screenshot({ path: testInfo.outputPath('card-contacts.png') });

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/ru/cars/fixture_car_3/');
  const detailContacts = page.locator('main [data-vehicle-contacts="fixture_car_3"]').first();
  await expect(detailContacts.locator('a')).toHaveCount(2);
  for (const link of await detailContacts.locator('a').all()) {
    await expect(link).toBeVisible();
    await expect(link).toHaveCSS('border-radius', '22px');
    const box = (await link.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await detailContacts.screenshot({ path: testInfo.outputPath('mobile-detail-contacts.png') });
});
