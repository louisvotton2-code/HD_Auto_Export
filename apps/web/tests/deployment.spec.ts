import { expect, test } from '@playwright/test';

test('the standalone server serves actual brand images and the decorative watermark without image optimization', async ({
  page,
  request,
}) => {
  const logo = await request.get('/brand/hd-auto-logo.webp');
  expect(logo.status()).toBe(200);
  expect(logo.headers()['content-type']).toContain('image/');
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
  await page.goto('/zh/calculator/georgia');
  const watermark = page.locator('.result-brand-watermark');
  const sharedLogo = await watermark.getAttribute('src');
  expect(sharedLogo).toMatch(/^\/_next\/static\/media\/hd-auto-logo\.[\w-]+\.webp$/);
  await expect(page.locator('header img[alt]:not([alt=""])').first()).toHaveAttribute('src', sharedLogo!);
  await expect(page.locator('footer .hd-footer-brand img')).toHaveAttribute('src', sharedLogo!);
  const icon = page.locator('head link[rel="icon"]');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute('href', /^\/_next\/static\/media\/icon\.[\w-]+\.svg$/);
  for (const path of [sharedLogo!, (await icon.getAttribute('href'))!]) {
    const asset = await request.get(path);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()['cache-control']).toContain('immutable');
    expect(asset.headers()['content-type']).toMatch(/^image\//);
  }
  await expect(watermark).toHaveAttribute('alt', '');
  await expect(watermark).toHaveAttribute('aria-hidden', 'true');
  await expect
    .poll(() => watermark.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(watermark).toHaveCSS('pointer-events', 'none');
  const total = page.getByTestId('manufacture-range-total');
  await expect(total).toBeVisible();
  await expect(total).toContainText('GEL');
  for (const image of await page.locator('img').all()) {
    await expect(image).not.toHaveAttribute('src', /\/_next\/image/);
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
});

test('preloads and applies the same fingerprinted Inter subsets on the Russian home', async ({ page }) => {
  await page.goto('/ru/');
  const fonts = page.locator('link[rel="preload"][as="font"]');
  await expect(fonts).toHaveCount(2);
  const paths = await fonts.evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  for (const subset of ['latin', 'cyrillic']) {
    expect(paths.some((path) => new RegExp(`/_next/static/media/inter-${subset}\\.[\\w-]+\\.woff2$`).test(path))).toBe(true);
  }
  const usedFonts = await page.evaluate(async () => {
    await document.fonts.load('16px Inter', 'AЯ');
    await document.fonts.load('16px "Inter Home"', 'AЯ');
    return performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => url.includes('inter-') && url.includes('.woff2'));
  });
  expect(usedFonts.sort()).toEqual(paths.sort());
});
