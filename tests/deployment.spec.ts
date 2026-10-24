import { expect, test } from '@playwright/test';

test('the static export serves actual brand images and the decorative watermark without image optimization', async ({
  page,
  request,
}) => {
  const logo = await request.get('/brand/hd-auto-logo.webp');
  expect(logo.status()).toBe(200);
  expect(logo.headers()['content-type']).toContain('image/');
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
  await page.goto('/zh/calculator/georgia');
  const watermark = page.locator('.result-brand-watermark');
  await expect(watermark).toHaveAttribute('alt', '');
  await expect(watermark).toHaveAttribute('aria-hidden', 'true');
  await expect
    .poll(() => watermark.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(watermark).toHaveCSS('pointer-events', 'none');
  await expect(page.getByTestId('total')).toBeVisible();
  for (const image of await page.locator('img').all()) {
    await expect(image).not.toHaveAttribute('src', /\/_next\/image/);
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
});
