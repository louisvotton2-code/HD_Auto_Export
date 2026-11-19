import { expect, test } from '@playwright/test';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires isolated public media fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

for (const [width, height, zoom, variant, maxBytes] of [
  [320, 568, 1, 576, 40_000], [390, 844, 2, 1056, 100_000],
  [390, 844, 3, 1440, 150_000], [1440, 900, 1, 1056, 100_000],
] as const) {
  test(`hero at ${width}px / DPR ${zoom} selects one ${variant}px WebP`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: zoom, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const reads: string[] = [];
      page.on('request', (request) => {
        if (/\/media\/home\/dawn-convoy[^/]*\.webp$/.test(request.url())) reads.push(new URL(request.url()).pathname);
      });
      await page.goto(new URL('/zh/', baseURL!).href);
      const image = page.locator('[data-home-section="hero"] img');
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => new URL(node.currentSrc).pathname))
        .toBe(`/media/home/dawn-convoy-${variant}.webp`);
      await expect.poll(() => page.evaluate(() => (
        performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      ).find((entry) => entry.name.includes('/media/home/dawn-convoy-'))?.encodedBodySize ?? 0)).toBeGreaterThan(1_000);
      const bytes = await page.evaluate(() => (
        performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      ).find((entry) => entry.name.includes('/media/home/dawn-convoy-'))!.encodedBodySize);
      expect(bytes).toBeLessThan(maxBytes);
      expect(reads).toEqual([`/media/home/dawn-convoy-${variant}.webp`]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally { await context.close(); }
  });
}

test('local cards select the fixed derivative, but the detail keeps its full image', async ({ page, request }) => {
  await setPublicFixtureState(request, { wideCardPhoto: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/en/cars/');
  const card = page.locator('[data-public-vehicle="fixture_car_1"]');
  const image = card.locator('img[src*="/media/"]').first();
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.currentSrc)).toContain('variant=card');
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  const photo = await image.getAttribute('src');
  await card.locator('h2 a').click();
  const detail = page.locator('img[data-gallery-active-image]');
  await expect(detail).toHaveAttribute('src', photo!);
  await expect(detail).not.toHaveAttribute('srcset', /variant=card/);
});

test('a failed derivative retries the original once', async ({ page, request }) => {
  await setPublicFixtureState(request, { wideCardPhoto: true });
  const reads: string[] = [];
  await page.route(/\/api\/v1\/media\/media_fixture_car_1\/(?:\?variant=card)?$/, (route) => {
    const variant = new URL(route.request().url()).searchParams.get('variant');
    reads.push(variant ?? 'original');
    return variant === 'card' ? route.fulfill({ status: 503 }) : route.continue();
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/en/cars/');
  const card = page.locator('[data-public-vehicle="fixture_car_1"]');
  await card.scrollIntoViewIfNeeded();
  const image = card.locator('img[src*="/media/"]').first();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0 && node.currentSrc.endsWith('media_fixture_car_1/'))).toBe(true);
  expect(reads).toEqual(['card', 'original']);
});
