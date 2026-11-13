import { expect, test } from '@playwright/test';
import { externalFixtureId, makeImportedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Uses shared synthetic external records only.');
test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
  await setPublicFixtureState(request, { importedPublished: true });
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

test('localized catalog pages preserve API priority, original currency and safe detail scope', async ({ page, request }) => {
  for (const locale of ['zh', 'en', 'ru'] as const) {
    const localized = `/api/v1/vehicles/?locale=${locale}&view=localized`;
    const first = await (await request.get(`${localized}&pageSize=26`)).json();
    const second = await (await request.get(`${localized}&pageSize=26&page=2`)).json();
    expect(first.meta.total).toBe(31);
    expect(first.data.items).toHaveLength(26);
    expect(first.data.items.every((item: { external?: unknown }) => !item.external)).toBe(true);
    expect(second.data.items.map((item: { id: string }) => item.id)).toEqual([1, 2, 3, 4, 5].map(externalFixtureId));
    expect(second.data.items.every((item: { external: { detail?: unknown } }) => !item.external.detail)).toBe(true);
    const matched = await (await request.get(`${localized}&make=toyota&powertrain=hev&priceCurrency=CNY&priceMin=128000.50&priceMax=128000.50&yearMin=2024`)).json();
    expect(matched.data.items.map((item: { id: string }) => item.id)).toEqual([1, 2, 5].map(externalFixtureId));
    const facets = await (await request.get(`/api/v1/vehicle-filters/?locale=${locale}&view=localized`)).json();
    expect(facets.data.total).toBe(31);
    expect(facets.data.powertrains.some((option: { id: string }) => option.id === 'unknown')).toBe(false);
    const legacy = await (await request.get(`/api/v1/vehicles/?locale=${locale}&view=legacy&pageSize=48`)).json();
    expect(legacy.meta.total).toBe(26);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/');
  await expect(page.getByTestId('hero-stat-catalog').locator('[data-counter-value]')).toHaveText('31');
});

test('a direct photo error is reported once and detail reads bounded inspection entries explicitly', async ({ page, request }) => {
  await setPublicFixtureState(request, { reportPresenceMode: 'known' });
  const sample = makeImportedPublicVehicleFixture('en', 'supplier', true);
  const photo = sample.images[0]!;
  await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410, body: 'Synthetic expired image' }));
  const report = page.waitForResponse((response) => response.url().includes(`/external-media/${photo.id}/failure/`));
  await page.goto('/en/cars/?q=EXT-000001');
  const card = page.locator(`[data-public-vehicle="${sample.id}"]`);
  await expect(card.locator('[data-vehicle-photo-unavailable]')).toBeVisible();
  await expect(card.locator('h2')).toHaveAttribute('lang', 'en');
  await expect(card.locator('[data-vehicle-original-price]')).toHaveText('¥ 128,000.5');
  await expect(card.locator('[data-vehicle-usd-approx]')).toHaveText('≈ 16,000 USD');
  const response = await report;
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toEqual({ revision: 1 });
  await card.getByRole('link', { name: /View details/ }).click();
  const main = page.locator('main');
  await expect(main.locator('h1')).toHaveText('Example R1 Hybrid');
  await expect(main.getByText('Compare original and displayed text')).toHaveCount(0);
  // Manufacturing / first-registration dates alone do not invent an accident or ownership history.
  await expect(main.locator('[data-vehicle-history]')).toHaveCount(0);
  await expect(main.locator('[data-vehicle-equipment] > details')).toHaveAttribute('open', '');
  const group = main.locator('[data-equipment-group="other"]');
  await group.locator('summary').click();
  await expect(group.locator('summary svg')).toHaveCount(2);
  await expect(group.locator('dd[lang="zh"]')).toHaveText('运动型多用途车');
  await expect(main.getByText('Listing platform', { exact: true })).toHaveCount(0);
  await expect(main.getByText('Synthetic Market', { exact: true })).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'HD Auto Export consultation' })).toHaveCount(0);
  const reportSection = main.locator('[data-public-vehicle-inspection]');
  await expect(reportSection).toHaveAttribute('data-report-status', 'unread');
  await expect(reportSection.locator('[data-public-inspection-item]')).toHaveCount(0);
  const reportButton = main.getByRole('link', { name: 'View inspection report' });
  const anchor = `#vehicle-public-inspection-${sample.id}`;
  await expect(reportButton).toHaveAttribute('href', anchor);
  await reportButton.press('Enter');
  expect(new URL(page.url()).hash).toBe(anchor);
  await expect(reportSection).toBeFocused();
  await reportSection.getByRole('button', { name: 'View inspection report', exact: true }).click();
  await expect(reportSection).toHaveAttribute('data-report-status', 'available');
  await expect(reportSection.locator('[data-public-inspection-item]')).toHaveCount(1);
  await expect(reportSection.locator('dd > span[lang="zh"]')).toHaveText('0');
  await expect(main.locator('a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
  await expect(main.getByText('Related listings')).toHaveCount(0);
  await expect(main.locator('a[href^="https://listings.example.invalid/"]')).toHaveCount(0);
  await expect(main.locator('[data-vehicle-gallery] [data-loading]').getByText('This photo is temporarily unavailable.')).toBeVisible();
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  expect(events.requests.filter((event: { path: string }) => event.path === `/api/v1/external-media/${photo.id}/failure`)).toHaveLength(1);
});

test('original-language fallback, missing media and disputed facts are readable and withdrawal returns 404', async ({ page, request }) => {
  await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
  await page.goto(`/ru/cars/${externalFixtureId(2)}/`);
  await expect(page.locator('main h1')).toHaveAttribute('lang', 'zh');
  await expect(page.locator('main h1')).toHaveText('示例 R1 2');
  await page.goto(`/en/cars/${externalFixtureId(3)}/`);
  const issue = page.getByRole('region', { name: 'Information to confirm' });
  await expect(issue).toContainText('Model year');
  await expect(issue).toContainText('Powertrain');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('main summary').filter({ hasText: 'Detailed vehicle information' }).locator('..')).toHaveAttribute('open', '');
  const year = page.locator('main dt').filter({ hasText: /^Model year$/ }).locator('..').locator('dd');
  await expect(year).toHaveCount(0);
  await page.goto(`/en/cars/${externalFixtureId(4)}/`);
  await expect(page.locator('main [data-vehicle-photo-unavailable]')).toBeVisible();
  const noReport = page.locator('[data-public-vehicle-inspection]');
  await noReport.getByRole('button', { name: 'View inspection report', exact: true }).click();
  await expect(noReport).toHaveAttribute('data-report-status', 'no_report');
  await expect(noReport).toContainText('This listing has no inspection report.');
  await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
  await expect(page.locator('main').getByText('Price on request', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await setPublicFixtureState(request, { importedWithdrawn: true });
  expect((await request.get(`/en/cars/${externalFixtureId(1)}/`)).status()).toBe(404);
  const list = await (await request.get('/api/v1/vehicles/?locale=en&view=localized&q=EXT-000001')).json();
  expect(list.data.items).toEqual([]);
});

test('public reports retain vehicle identity and destination flags in all three languages', async ({ page, request }) => {
  const image = await (await request.get('/api/v1/media/media_fixture_car_2/')).body();
  await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ contentType: 'image/png', body: image }));
  const id = externalFixtureId(1);
  await setPublicFixtureState(request, { reportPresenceMode: 'known' });
  const openReport = { zh: '查看检测报告', en: 'View inspection report', ru: 'Посмотреть отчёт об осмотре' };
  for (const locale of ['zh', 'en', 'ru'] as const) {
    await page.goto(`/${locale}/cars/${id}/`);
    const title = await page.locator('main h1').innerText();
    const reportSection = page.locator('[data-public-vehicle-inspection]');
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/inspection/'));
    await reportSection.getByRole('button', { name: openReport[locale], exact: true }).click();
    expect((await (await loaded).json()).data.vehicleId).toBe(id);
    await expect(reportSection).toHaveAttribute('data-report-status', 'available');
    await expect(page.locator('[data-vehicle-report-request]')).toHaveCount(0);
    const links = page.locator(`[data-vehicle-contacts="${id}"] a`).filter({ visible: true });
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      const url = new URL((await link.getAttribute('href'))!);
      expect(['https://t.me/HD_Auto_CN', 'https://wa.me/8618215932610']).toContain(url.origin + url.pathname);
      const draft = url.searchParams.get('text')!;
      expect(draft).toContain(title);
      expect(draft).toContain('EXT-000001');
      expect(draft).toContain(`/${locale}/cars/${id}/`);
    }
    const destination = page.getByTestId('vehicle-import-estimate').locator('[name="country"]');
    await expect(destination.locator('option:checked')).toContainText('🇷🇺');
    await expect(destination.locator('option')).toHaveCount(7);
    await destination.selectOption('KZ');
    await expect(destination.locator('option:checked')).toContainText('🇰🇿');
    await expect(page.getByTestId('vehicle-import-estimate')).toHaveAttribute('data-country', 'KZ');
    await expect(page.locator('[data-vehicle-equipment] > details')).toHaveAttribute('open', '');
  }
});

test('removing all photos from an open gallery restores scrolling and keyboard focus', async ({ page, request }) => {
  const original = await request.get('/api/v1/media/media_fixture_car_2/');
  expect(original.status()).toBe(200);
  const png = await original.body();
  await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ contentType: 'image/png', body: png }));
  const id = externalFixtureId(1);
  await page.goto(`/en/cars/${id}/`);
  await page.locator('[data-vehicle-photo-opener]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await setPublicFixtureState(request, { importedPhotosRemoved: true });
  const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/vehicles/${id}/`);
  await page.evaluate(() => dispatchEvent(new PopStateEvent('popstate', { state: history.state })));
  expect((await refresh).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Vehicle photos' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
