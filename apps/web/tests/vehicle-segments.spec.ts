import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { PublicVehicleConfigurationResponseSchema, PublicVehicleGalleryResponseSchema } from '@hd/contracts/public';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

// All mutations are confined to the health-marked loopback fixture, never supplier inventory.
test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));
const path = '/en/cars/fixture_car_3/';
const gallery = (page: Page) => page.locator('[data-public-vehicle-gallery]');
const inlineGallery = (page: Page) => gallery(page).locator('[data-public-gallery-pagination="inline"]');
const configuration = (page: Page) => page.locator('[data-vehicle-configuration]');
async function reads(request: APIRequestContext, kind: 'gallery' | 'configuration') {
  const response = await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`);
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.suite).toBe('hd-web-public-catalog-v1');
  return data.requests.filter((row: { path: string }) => row.path.endsWith(`/${kind}`));
}

test('full gallery replaces the old 30-photo preview, then reads the bounded final page', async ({ page, request }) => {
  await setPublicFixtureState(request, { segmentGalleryCount: 65, segmentFallback: true });
  await page.goto(path);
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(30);
  await expect(inlineGallery(page).getByRole('button')).toHaveText('Load more photos');
  await expect(gallery(page).getByRole('button', { name: 'Browse photos', exact: true })).toHaveCount(0);
  expect(await reads(request, 'gallery')).toHaveLength(0);
  // The preview and first page now deliberately belong to different photo collections.
  await setPublicFixtureState(request, { segmentRevision: 2 });
  await gallery(page).locator('[data-vehicle-photo-opener]').click();
  await expect(gallery(page).locator('dialog[open]')).toBeVisible();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  await expect(gallery(page).locator('[data-selected-image]')).toHaveAttribute('data-selected-image', /_v2_1$/);
  expect(await gallery(page).locator('[data-vehicle-thumbnails] a').evaluateAll(nodes => nodes.every(node => node.getAttribute('href')?.includes('_v2_')))).toBe(true);
  await gallery(page).locator('[data-public-gallery-pagination="viewer"] [data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(65);
  await expect(gallery(page).locator('[data-public-gallery-pagination="viewer"] [data-gallery-load-more]')).toHaveCount(0);
  expect(await reads(request, 'gallery')).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect(gallery(page).locator('dialog[open]')).toHaveCount(0);
  await expect(gallery(page).locator('[data-vehicle-photo-opener]')).toBeFocused();
  await gallery(page).locator('[data-vehicle-thumbnails] a').nth(30).click();
  const activePhoto = gallery(page).locator('img[data-gallery-active-image]');
  await expect(activePhoto).toHaveAttribute('alt', '图片说明 31');
  await expect(activePhoto).toHaveAttribute('lang', 'zh');
  await expect(activePhoto).toHaveAttribute('data-provenance', 'supplier');
  await expect(activePhoto).toHaveAttribute('data-reviewed', 'false');
  await gallery(page).locator('[data-vehicle-photo-opener]').click();
  await expect(gallery(page).locator('dialog[open] img[data-gallery-active-image]')).toHaveAttribute('lang', 'zh');
  await expect(gallery(page).locator('dialog[open] img[data-gallery-active-image]')).toHaveAttribute('alt', '图片说明 31');
  expect(await reads(request, 'gallery')).toHaveLength(2);
  await page.keyboard.press('Escape');
});

test('unknown and fully shown gallery counts have no initial browse or speculative more action', async ({ page, request }) => {
  for (const count of [null, 3]) {
    await resetPublicFixture(request);
    await setPublicFixtureState(request, { segmentGalleryCount: count });
    await page.goto(path);
    await expect(gallery(page)).toBeVisible();
    await expect(inlineGallery(page).getByRole('button')).toHaveCount(0);
    expect(await reads(request, 'gallery')).toHaveLength(0);

    // Opening the actual image still reads a single bounded first page and opens its viewer.
    const firstPage = page.waitForResponse(response => /\/gallery\/?$/.test(new URL(response.url()).pathname));
    await gallery(page).locator('[data-vehicle-photo-opener]').click();
    await expect(gallery(page).locator('dialog[open]')).toBeVisible();
    expect((await firstPage).status()).toBe(200);
    await expect(gallery(page).locator('[data-public-gallery-pagination="viewer"]')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(async () => (await reads(request, 'gallery')).length).toBe(1);
    await expect(gallery(page).locator('[data-public-gallery-pagination="viewer"] [data-gallery-load-more]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(gallery(page).locator('dialog[open]')).toHaveCount(0);
  }
});

test('normal configuration retains the bounded seed and its source values without a complete-configuration request', async ({ page, request }) => {
  await setPublicFixtureState(request, { segmentConfigurationCount: 525, segmentFallback: true, segmentOverlap: true });
  await page.goto('/ru/cars/fixture_car_3/');
  await expect(configuration(page).locator('[data-configuration-item]')).toHaveCount(3);
  expect(await reads(request, 'configuration')).toHaveLength(0);
  await expect(configuration(page).getByRole('button')).toHaveCount(0);
  await expect(page.locator('[data-public-configuration-segment]')).toHaveCount(0);
  const first = configuration(page).locator('[data-configuration-item="cfg-0001"]');
  await expect(first.locator('[data-configuration-field="name"]')).toHaveText('排量(cc)');
  await expect(first.locator('[data-configuration-field="name"]')).toHaveAttribute('lang', 'zh');
  await expect(first.locator('[data-configuration-field="value"]')).toHaveText('0 cm³ / 8 AT');
  await expect(configuration(page).locator('[data-configuration-item="cfg-0002"] [data-configuration-field="value"]')).toHaveText('0');
  await expect(configuration(page).locator('[data-configuration-item="cfg-0003"] [data-configuration-field="value"]')).toHaveText('false');
  await configuration(page).locator('summary').first().click();
  await configuration(page).locator('summary').first().click();
  await expect(configuration(page).locator('[data-configuration-item]')).toHaveCount(3);
  expect(await reads(request, 'configuration')).toHaveLength(0);
});

test('a changed gallery cursor discards the old revision and restarts only on explicit action', async ({ page, request }) => {
  await setPublicFixtureState(request, { segmentGalleryCount: 65 });
  await page.goto(path);
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  await setPublicFixtureState(request, { segmentRevision: 2 });
  const conflict = page.waitForResponse(response => /\/gallery\/?$/.test(new URL(response.url()).pathname) && response.status() === 409);
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await conflict;
  await expect(inlineGallery(page).locator('[data-gallery-restart]')).toBeVisible();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(0);
  await inlineGallery(page).locator('[data-gallery-restart]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  const last = (await reads(request, 'gallery')).at(-1);
  expect(last.query.cursor).toBeUndefined();
  expect(await gallery(page).locator('[data-vehicle-thumbnails] a').evaluateAll(nodes => nodes.every(node => node.getAttribute('href')?.includes('_v2_')))).toBe(true);
});

test('withdrawal during a segment request removes the whole vehicle and its consultation links', async ({ page, request }) => {
  await setPublicFixtureState(request, { futurePublished: true, segmentGalleryCount: 65 });
  await page.goto('/en/cars/fixture_future/');
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  await setPublicFixtureState(request, { futureArchived: true });
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(page.getByTestId('public-vehicle-missing')).toBeVisible();
  await expect(page.locator('main [data-vehicle-contacts]')).toHaveCount(0);
  await expect(page.locator('main [data-public-vehicle-detail]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Newly published vehicle');
});

test('429 cooldown and temporary gallery failures retain valid photos and require manual retry', async ({ page, request }) => {
  await setPublicFixtureState(request, { segmentGalleryCount: 125 });
  await page.goto(path);
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  await setPublicFixtureState(request, { segmentFailure: 'rate_limit' });
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(inlineGallery(page).locator('[data-gallery-load-more]')).toBeDisabled();
  const limitedReads = (await reads(request, 'gallery')).length;
  await page.waitForTimeout(2_150); // The fixture's Retry-After is exactly two seconds.
  expect(await reads(request, 'gallery')).toHaveLength(limitedReads);
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  await setPublicFixtureState(request, { segmentFailure: 'none' });
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(100);
  await setPublicFixtureState(request, { segmentFailure: 'unavailable' });
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(inlineGallery(page).getByRole('status')).toBeVisible();
  await expect(inlineGallery(page).locator('[data-gallery-load-more]')).toBeEnabled();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(100);
  await setPublicFixtureState(request, { segmentFailure: 'none' });
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(125);
  expect(await reads(request, 'configuration')).toHaveLength(0);
});

test('a delayed old segment cannot append after same-document history or language navigation', async ({ page, request }) => {
  await setPublicFixtureState(request, { segmentGalleryCount: 75, segmentConfigurationCount: 75 });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-public-history-ready', '');
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-segment-document-marker', 'same-document');
    history.pushState(null, '', '#segment-pending');
  });
  const documents: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') documents.push(request.url());
  });
  await setPublicFixtureState(request, { segmentDelayMs: 1_200 });
  const started = page.waitForRequest(request => /\/gallery\/?$/.test(new URL(request.url()).pathname) && new URL(request.url()).searchParams.has('cursor'));
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  const oldRequest = await started;
  // Wait until the upstream fixture has captured the old revision before changing it.
  await expect.poll(async () => (await reads(request, 'gallery')).filter((row: { query: { cursor?: string } }) => row.query.cursor).length).toBe(1);
  await setPublicFixtureState(request, { segmentGalleryCount: 76, segmentRevision: 2, segmentDelayMs: 0 });
  const aborted = page.waitForEvent('requestfailed', { predicate: request => request === oldRequest });
  const refreshed = page.waitForResponse(response => {
    const url = new URL(response.url());
    return /\/api\/v1\/vehicles\/fixture_car_3\/?$/.test(url.pathname) && url.searchParams.get('locale') === 'en' && response.status() === 200;
  });
  // Native same-document Back is an actual supported PublicNavigationFreshness trigger.
  await page.evaluate(() => history.back());
  const [, freshDetail] = await Promise.all([aborted, refreshed]);
  expect((await freshDetail.json()).data.mediaTotal).toBe(76);
  await expect(page.locator('html')).toHaveAttribute('data-segment-document-marker', 'same-document');
  expect(documents).toHaveLength(0);
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(30);
  await page.waitForTimeout(1_250); // Outlast the old response while this document is still alive.
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(30);
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  expect((await reads(request, 'gallery')).at(-1).query.cursor).toBeUndefined();

  await page.goto('/ru/cars/fixture_car_4/');
  await expect(page.locator('[data-public-vehicle-detail]')).toHaveAttribute('data-public-vehicle-detail', 'fixture_car_4');
  await expect(configuration(page).locator('[data-configuration-item]')).toHaveCount(3);
  await inlineGallery(page).locator('[data-gallery-load-more]').click();
  await expect(gallery(page).locator('[data-vehicle-thumbnails] a')).toHaveCount(50);
  expect(await configuration(page).locator('[data-configuration-field]').evaluateAll(nodes => nodes.every(node => node.getAttribute('data-requested-locale') === 'ru'))).toBe(true);
  expect(await reads(request, 'configuration')).toHaveLength(0);
});

test('segment BFF validates scope and privacy instead of exposing private upstream fields', async ({ request }) => {
  await setPublicFixtureState(request, { segmentGalleryCount: 65, segmentConfigurationCount: 75 });
  for (const kind of ['gallery', 'configuration'] as const) {
    const url = `/api/v1/vehicles/fixture_car_3/${kind}/?locale=en&limit=50`;
    const first = await request.get(url, { headers: { Cookie: 'synthetic_employee=must-stay-at-web', Authorization: 'Bearer SYNTHETIC_ONLY' } });
    expect(first.status()).toBe(200);
    expect(first.headers()['cache-control']).toContain('no-store');
    const data = (kind === 'gallery' ? PublicVehicleGalleryResponseSchema : PublicVehicleConfigurationResponseSchema).parse(await first.json());
    expect(data.data.items).toHaveLength(50);
    for (const invalid of ['&view=localized', '&priceView=usd', '&locale=ru'])
      expect((await request.get(url + invalid)).status()).toBe(400);
    expect((await request.get(url.replace('limit=50', 'limit=101'))).status()).toBe(400);
    for (const mode of ['private_field', 'wrong_locale', 'wrong_vehicle']) {
      await setPublicFixtureState(request, { segmentFailure: mode });
      const bad = await request.get(url);
      expect(bad.status()).toBe(503);
      expect(await bad.text()).not.toMatch(/PRIVATE_VIN_SENTINEL|PRIVATE_SELLER_SENTINEL|PRIVATE_STAFF_SENTINEL|reports\.example\.invalid/);
    }
    await setPublicFixtureState(request, { segmentFailure: 'none' });
    expect((await request.get(`/internal/public-catalog/vehicles/fixture_car_3/${kind}/?locale=en`)).status()).toBe(404);
    const received = await reads(request, kind);
    expect(received.every((row: { cookie: string | null; authorization: string | null }) => row.cookie === null && row.authorization === null)).toBe(true);
  }
});

test('three-language source fallback and USD remain consistent in the normal configuration seed', async ({ page, request }, testInfo) => {
  await setPublicFixtureState(request, { importedPublished: true, segmentGalleryCount: 65, segmentConfigurationCount: 55, segmentFallback: true, reportPresenceMode: 'known' });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://photos.example.invalid/**', route => route.fulfill({ contentType: 'image/png', body: image }));
  for (const locale of ['zh', 'en', 'ru']) {
    await page.setViewportSize({ width: locale === 'zh' ? 1440 : locale === 'en' ? 390 : 320, height: 1000 });
    await setPublicFixtureState(request, { usdRateAvailable: true });
    await page.goto(`/${locale}/cars/${externalFixtureId(2)}/`);
    await expect(page.locator('main h1')).toHaveAttribute('lang', 'zh');
    await expect(page.locator('main [data-vehicle-original-price]').first()).toContainText('¥');
    await expect(page.locator('main [data-vehicle-usd-approx]').first()).toContainText('USD');
    await expect(page.locator('main a[href="https://www.exchangerate-api.com"]').filter({ visible: true }).first()).toBeVisible();
    const equipment = page.locator('[data-vehicle-equipment]');
    await expect(equipment).toBeVisible();
    await expect(equipment.locator('dl > div')).toHaveCount(3);
    await expect(equipment.locator('dt[lang="zh"]').first()).toContainText('排量');
    await expect(equipment.getByRole('button')).toHaveCount(0);
    expect(await reads(request, 'configuration')).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await inlineGallery(page).screenshot({ path: testInfo.outputPath(`gallery-controls-${locale}.png`) });
    await equipment.screenshot({ path: testInfo.outputPath(`configuration-seed-${locale}.png`) });
    expect(await page.content()).not.toMatch(/PRIVATE_RAW_MARKER|PRIVATE_COST_SENTINEL|reports\.example\.invalid/);
    await setPublicFixtureState(request, { usdRateAvailable: false });
    await page.reload();
    await expect(page.locator('main [data-vehicle-usd-approx]')).toHaveCount(0);
    await expect(page.locator('main [data-vehicle-original-price]').first()).toContainText('¥');
  }
  const list = await (await request.get('/api/v1/vehicles/?locale=en&view=localized&priceView=usd&projection=card&pageSize=5')).json();
  for (const row of list.data.items) {
    expect(row.configuration).toBeUndefined();
    expect(row.report).toBeUndefined();
    expect(row.external?.detail).toBeUndefined();
    expect(row.content.description).toBeUndefined();
    expect(row.images.length).toBeLessThanOrEqual(1);
  }
});
