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

const coverPath = '/api/v1/media/media_fixture_car_1/';

test('catalog and detail discover one high-priority cover, with no original before opening the viewer', async ({ browser, baseURL, request }) => {
  await setPublicFixtureState(request, { wideCardPhoto: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 900 }, deviceScaleFactor: 3 });
  try {
    const page = await context.newPage();
    const reads: string[] = [];
    const secondPhoto = '/api/v1/media/media_fixture_car_1_2/';
    const secondReads: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === coverPath) reads.push(url.searchParams.get('variant') ?? 'original');
      if (url.pathname === secondPhoto) secondReads.push(url.searchParams.get('variant') ?? 'original');
    });
    await page.goto('/en/cars/?make=beta');
    const priority = page.locator('#catalog-results img[fetchpriority="high"]');
    await expect(priority).toHaveCount(1);
    await expect(priority).toHaveAttribute('loading', 'eager');
    await expect(page.locator(`head link[rel="preload"][as="image"][imagesrcset*="${coverPath}"]`)).toHaveCount(1);
    await expect.poll(() => priority.evaluate((node: HTMLImageElement) => node.currentSrc)).toContain('variant=card');
    await expect.poll(() => priority.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    expect(reads).toEqual(['card']);

    reads.length = 0;
    await page.goto('/en/cars/fixture_car_1/');
    const inline = page.locator('[data-vehicle-photo-opener] img[data-gallery-active-image]');
    await expect(inline).toHaveAttribute('src', `${coverPath}?variant=card`);
    await expect(page.locator(`head link[rel="preload"][as="image"][href="${coverPath}?variant=card"]`)).toHaveCount(1);
    await expect.poll(() => inline.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    expect(reads.filter((variant) => variant !== 'thumb')).toEqual(['card']);

    const opener = page.locator('[data-vehicle-photo-opener]');
    await expect(opener).toHaveAttribute('href', coverPath);
    await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
    await opener.click();
    const viewer = page.locator('dialog[open] img[data-gallery-active-image]');
    await expect(viewer).toHaveAttribute('src', coverPath);
    await expect.poll(() => viewer.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    expect(reads.filter((variant) => variant === 'original')).toEqual(['original']);
    await page.locator('dialog[open]').getByRole('button', { name: 'Next photo' }).click();
    await expect(viewer).toHaveAttribute('src', secondPhoto);
    await expect.poll(() => viewer.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    await expect(opener.locator('img')).toHaveAttribute('src', `${coverPath}?variant=card`);
    expect(secondReads.filter((variant) => variant !== 'thumb')).toEqual(['original']);
  } finally {
    await context.close();
  }
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

test('a failed inline detail derivative falls back once and a viewer failure keeps a good preview', async ({ page, request }) => {
  await setPublicFixtureState(request, { wideCardPhoto: true });
  const reads: string[] = [];
  let failVariant = 'card';
  await page.route(`**${coverPath}**`, (route) => {
    const variant = new URL(route.request().url()).searchParams.get('variant') ?? 'original';
    if (variant !== 'thumb') reads.push(variant);
    return variant === failVariant ? route.fulfill({ status: 503 }) : route.continue();
  });
  await page.goto('/en/cars/fixture_car_1/');
  const inline = page.locator('[data-vehicle-photo-opener] img[data-gallery-active-image]');
  await expect(inline).toHaveAttribute('src', coverPath);
  await expect.poll(() => inline.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  expect(reads).toEqual(['card', 'original']);

  failVariant = 'original';
  await page.goto('/en/cars/fixture_car_1/');
  await expect(inline).toHaveAttribute('src', `${coverPath}?variant=card`);
  await expect.poll(() => inline.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  const opener = page.locator('[data-vehicle-photo-opener]');
  await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
  await opener.click();
  await expect(page.locator('dialog[open] [data-gallery-image-error]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('[data-gallery-image-error]')).toHaveCount(0);
  await expect.poll(() => inline.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
});

test('a gallery revision change defers new inline images until the viewer closes', async ({ page, request }) => {
  await setPublicFixtureState(request, { wideCardPhoto: true, segmentGalleryCount: 4 });
  const cards: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.searchParams.get('variant') === 'card') cards.push(url.pathname);
  });
  await page.goto('/en/cars/fixture_car_1/');
  const opener = page.locator('[data-vehicle-photo-opener]');
  await expect(opener.locator('img')).toHaveAttribute('src', /_v1_1\/\?variant=card$/);
  await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
  await setPublicFixtureState(request, { segmentRevision: 2 });
  await opener.click();
  const viewer = page.locator('dialog[open]');
  await expect(viewer.locator('img[data-gallery-active-image]')).toHaveAttribute('src', /_v2_1\/$/);
  await viewer.getByRole('button', { name: 'Next photo' }).click();
  await expect(viewer.locator('img[data-gallery-active-image]')).toHaveAttribute('src', /_v2_2\/$/);
  await expect(opener.locator('img')).toHaveCount(0);
  expect(cards.filter((url) => url.includes('_v2_'))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(opener.locator('img')).toHaveAttribute('src', /_v2_2\/\?variant=card$/);
});
