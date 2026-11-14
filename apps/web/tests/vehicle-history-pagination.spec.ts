import { expect, test, type Locator } from '@playwright/test';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Uses only the health-marked isolated catalog fixture.');
test.beforeEach(async ({ request }) => { await resetPublicFixture(request); });
test.afterEach(async ({ request }) => { await resetPublicFixture(request); });

const copy = {
  zh: { pagination: '车辆目录分页', page: (n: number) => `第 ${n} 页`, inspection: '车辆检测摘要', inspect: '查看检测报告', no: '无' },
  en: { pagination: 'Vehicle catalog pages', page: (n: number) => `Page ${n}`, inspection: 'Vehicle inspection summary', inspect: 'View inspection report', no: 'No' },
  ru: { pagination: 'Страницы каталога автомобилей', page: (n: number) => `Страница ${n}`, inspection: 'Результаты осмотра автомобиля', inspect: 'Посмотреть отчёт об осмотре', no: 'Нет' },
};
const kinds = ['accidents', 'transfers', 'owners', 'plateChanges'];
const inspectionOnlyKinds = ['theft', 'flood', 'waterDamage', 'fire', 'totalLoss'];
const filteredQuery = new URLSearchParams({
  q: 'fixture_car', make: 'alpha', model: 'alpha_model', powertrain: 'bev',
  priceCurrency: 'USD', priceMin: '0', priceMax: '999999', yearMin: '2020', yearMax: '2026', pageSize: '5',
});

async function ids(cards: Locator) {
  return cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-public-vehicle')));
}

for (const [locale, width] of [['zh', 1440], ['en', 390], ['ru', 320]] as const) {
  test(`${locale}: explicit history retains zero and does not derive events from inspection findings at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setPublicFixtureState(request, { importedPublished: true, historyScenario: 'complete', inspectionSummaryStatus: 'available' });
    const image = await (await request.get('/api/v1/media/media_fixture_car_2/')).body();
    await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ contentType: 'image/png', body: image }));
    await page.goto(`/${locale}/cars/${externalFixtureId(1)}/`);
    const main = page.locator('main');
    const history = main.locator('[data-vehicle-history]');
    await expect(history).toBeVisible();
    await expect(history.locator('[data-history-kind]')).toHaveCount(kinds.length);
    for (const kind of kinds) await expect(history.locator(`[data-history-kind="${kind}"]`)).toBeVisible();
    for (const kind of ['accidents', 'plateChanges'])
      await expect(history.locator(`[data-history-kind="${kind}"] dd`)).toHaveText('0');
    await expect(history.locator('[data-history-kind="transfers"] dd')).toHaveText('2');
    await expect(history.locator('[data-history-kind="owners"] dd')).toHaveText('3');
    for (const kind of inspectionOnlyKinds)
      await expect(history.locator(`[data-history-kind="${kind}"]`)).toHaveCount(0);
    await expect(history).not.toContainText('9 / 24');
    await expect(history).not.toContainText('0 / 18');
    const inspection = main.getByRole('region', { name: copy[locale].inspection, exact: true });
    await expect(inspection).toBeVisible();
    // The summary and sales sidebar intentionally offer separate report entry points.
    const inspectLink = inspection.getByRole('link', { name: copy[locale].inspect, exact: true });
    const sidebarLink = main.locator('aside').getByRole('link', { name: copy[locale].inspect, exact: true });
    const reportPath = `/${locale}/cars/${externalFixtureId(1)}/inspection/`;
    for (const link of [inspectLink, sidebarLink]) {
      await expect(link).toHaveCount(1);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', reportPath);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    const [reportPage] = await Promise.all([page.waitForEvent('popup'), inspectLink.click()]);
    try {
      await expect(reportPage).toHaveURL(url => url.pathname === reportPath);
      await expect(reportPage.locator(`[data-vehicle-inspection-page="${externalFixtureId(1)}"]`)).toBeVisible();
    } finally { await reportPage.close(); }
    await expect(main.locator('a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

for (const scenario of ['empty', 'conflict'] as const) {
  test(`${scenario}: dates, unknown values and contradictory history do not create a history card`, async ({ page, request }) => {
    await setPublicFixtureState(request, { importedPublished: true, historyScenario: scenario, reportPresenceMode: 'known' });
    await page.route('https://photos.example.invalid/**', (route) => route.fulfill({ status: 410 }));
    const id = externalFixtureId(1);
    const response = await request.get(`/api/v1/vehicles/${id}/?locale=en&view=localized`);
    expect(response.status()).toBe(200);
    const vehicle = (await response.json()).data;
    expect(vehicle.facts.firstRegistration).not.toBeNull();
    expect(vehicle.external.detail.inspection).toBeNull();
    await page.goto(`/en/cars/${id}/`);
    await expect(page.locator('main [data-vehicle-history]')).toHaveCount(0);
    await expect(page.getByRole('region', { name: copy.en.inspection, exact: true })).toBeVisible();
    await expect(page.locator('main a[href^="https://reports.example.invalid/"]')).toHaveCount(0);
    await expect(page.locator('[data-public-inspection-item]')).toHaveCount(0);
    const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
    expect(events.requests.filter((event: { path: string }) => /\/inspection\/?$/.test(event.path))).toHaveLength(0);
  });
}

for (const [locale, width] of [['zh', 1440], ['en', 390], ['ru', 320]] as const) {
  test(`${locale}: pagination uses the matching API total and keeps filters through the last page at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setPublicFixtureState(request, { catalogSampleCount: 120 });
    const query = new URLSearchParams(filteredQuery);
    const response = await request.get(`/api/v1/vehicles/?${query}&locale=${locale}&view=localized&priceView=usd`);
    expect(response.status()).toBe(200);
    const api = await response.json();
    expect(api.meta.total).toBe(60);
    expect(api.data.items).toHaveLength(5);
    const totalPages = Math.ceil(api.meta.total / api.data.pageSize);
    expect(totalPages).toBe(12);
    await page.goto(`/${locale}/cars/?${query}`);
    const pager = page.getByRole('navigation', { name: copy[locale].pagination, exact: true });
    await expect(pager.locator('[data-catalog-page-count]')).toHaveAttribute('data-catalog-page-count', String(totalPages));
    await expect(pager.locator('[aria-current="page"]')).toHaveText('1');
    await expect(pager).toContainText('…');
    const cards = page.locator('main article[data-public-vehicle]');
    await expect(cards).toHaveCount(5);
    const firstPageIds = await ids(cards);
    expect(new Set(firstPageIds).size).toBe(5);
    const last = pager.getByRole('link', { name: copy[locale].page(totalPages), exact: true });
    const href = new URL((await last.getAttribute('href'))!, page.url());
    for (const [key, value] of filteredQuery) expect(href.searchParams.get(key), key).toBe(value);
    expect(href.searchParams.get('page')).toBe('12');
    await last.click();
    await expect(page).toHaveURL((url) => url.pathname === `/${locale}/cars/` && url.searchParams.get('page') === '12');
    await expect(pager.locator('[aria-current="page"]')).toHaveText('12');
    await expect(pager.locator('[data-catalog-page-count]')).toHaveText('12 / 12');
    await expect(cards).toHaveCount(5);
    const lastPageIds = await ids(cards);
    expect(new Set(lastPageIds).size).toBe(5);
    expect(lastPageIds.every((id) => !firstPageIds.includes(id))).toBe(true);
    const next = pager.locator('[rel="next"]');
    await expect(next).toHaveCount(0);
    for (const [key, value] of filteredQuery) expect(new URL(page.url()).searchParams.get(key), key).toBe(value);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.reload();
    await expect(pager.locator('[aria-current="page"]')).toHaveText('12');
    expect(await ids(cards)).toEqual(lastPageIds);
  });
}

test('numbered pagination remains real links without JavaScript', async ({ browser, request, baseURL }) => {
  await setPublicFixtureState(request, { catalogSampleCount: 120 });
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 320, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(`/ru/cars/?${filteredQuery}`);
    const pager = page.getByRole('navigation', { name: copy.ru.pagination, exact: true });
    await expect(pager.locator('[data-catalog-page-count]')).toHaveText('1 / 12');
    await expect(pager).toContainText('…');
    await pager.getByRole('link', { name: copy.ru.page(12), exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('page') === '12' && url.searchParams.get('make') === 'alpha');
    await expect(pager.locator('[aria-current="page"]')).toHaveText('12');
    await expect(page.locator('main article[data-public-vehicle]')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});
