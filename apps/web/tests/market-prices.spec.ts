import { expect, test, type Page } from '@playwright/test';
import { MarketPriceResponseSchema, type MarketPriceResponse } from '@hd/contracts/public';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';

const marketPath = /^\/api\/v1\/public\/market-prices\/?$/;
const filtersPath = /^\/api\/v1\/vehicle-filters\/?$/;
const historyPath = /^\/api\/v1\/vehicles\/(fixture_car_\d+)\/price-history\/?$/;
const selected = 'make=alpha&model=alpha_model';
const asOf = '2026-11-27T12:00:00.000Z';

type Language = 'zh' | 'en' | 'ru';
function fixtureReport(locale: Language, count: number): MarketPriceResponse {
  const base = makePublicVehicleFixture();
  const prices = (usd: string, cny: string) => ({ usd: { amount: usd, currency: 'USD' }, cny: { amount: cny, currency: 'CNY' } });
  const extreme = (index: number) => {
    const id = `fixture_car_${index}`;
    const detailPath = `/${locale}/cars/${id}/`;
    return { detailPath, vehicle: {
      id, detailPath, stockCode: `HD-00000${index}`, source: base.source,
      facts: { ...base.facts, trim: { id: 'touring', name: 'Touring' }, mileageKm: index * 10_000 },
      price: base.price, content: { title: { ...base.content.title, text: `Alpha Touring ${index}`, requestedLocale: locale, contentLocale: locale } },
      images: [{ ...base.images[0], id: `media_${id}`, url: `/api/v1/media/media_${id}` }],
      availability: base.availability, availabilityCheckedAt: base.availabilityCheckedAt, fetchedAt: base.fetchedAt,
      sourceUpdatedAt: base.sourceUpdatedAt, publishedAt: base.publishedAt,
    } };
  };
  const min = count ? prices('18000.99', '126000.99') : null;
  const max = count === 1 ? min : count ? prices('24000.99', '168000.99') : null;
  return MarketPriceResponseSchema.parse({ data: {
    sampleCount: count, asOf, fx: count ? { asOf, source: 'synthetic' } : null,
    statistics: { min, max, mean: count > 1 ? prices('20900.99', '146300.99') : min,
      median: count > 1 ? prices('21000.99', '147000.99') : min,
      p25: count >= 10 ? prices('20000.99', '140000.99') : null,
      p75: count >= 10 ? prices('22000.99', '154000.99') : null },
    extremes: { min: count ? extreme(1) : null, max: count === 1 ? extreme(1) : count ? extreme(2) : null },
  }, meta: { requestId: 'market-fixture' } });
}

async function useFacetFixtures(page: Page, searchableNames = false) {
  await page.route(url => filtersPath.test(url.pathname), (route) => {
    const params = new URL(route.request().url()).searchParams;
    const make = params.get('make') ?? 'alpha';
    const projection = params.get('projection');
    return route.fulfill({ json: { data: { catalog: 'curated',
      makes: projection === 'overview'
        ? [{ id: 'alpha', name: searchableNames ? 'Alpha · Motors' : 'Alpha', count: 100 }, { id: 'beta', name: 'Beta', count: 100 }]
        : [],
      models: projection === 'models' ? [
        { id: `${make}_model`, makeId: make, name: searchableNames ? 'Road-GT / Pro' : `${make} Model`, count: 8 },
        ...(searchableNames ? [{ id: `${make}_city`, makeId: make, name: 'City', count: 2 }] : []),
      ] : [],
      trims: projection === 'variants' ? [{ id: 'touring', makeId: make, modelId: `${make}_model`, name: 'Touring', count: 4 }] : [],
      powertrains: [],
    }, meta: { requestId: 'market-options-fixture' } } });
  });
}

async function chooseMarketOption(page: Page, field: 'make' | 'model', name: string) {
  await page.getByTestId(`market-${field}-search`).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('market form sends committed filters only, restores them after back, and links to the extreme vehicle', async ({ page, context }) => {
  await useFacetFixtures(page);
  const sent: URLSearchParams[] = [];
  await page.route(url => marketPath.test(url.pathname), (route) => {
    sent.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: fixtureReport('zh', 13) });
  });
  await page.goto('/zh/market-prices/');
  await expect(page.getByRole('heading', { name: '中国二手车行情查询' })).toBeVisible();
  await expect(page.locator('header a[href="#contact"]')).toHaveCount(0);
  await expect(page.locator('header a[href="/zh/market-prices/"]:visible')).toHaveAttribute('aria-current', 'page');
  const form = page.locator('main form');
  const optional = form.getByTestId('market-optional-filters');
  const optionalToggle = optional.locator('summary');
  const earliestYear = form.locator('[name="yearMin"]');
  await expect(optional).toHaveAttribute('open', '');
  await expect(earliestYear).toBeVisible();
  await expect(form.getByTestId('market-make-search')).toHaveAccessibleName('品牌');
  await expect(form.getByTestId('market-model-search')).toHaveAccessibleName('车型');
  await chooseMarketOption(page, 'make', 'Alpha');
  await chooseMarketOption(page, 'model', 'alpha Model');
  await form.locator('[name="trim"]').selectOption('touring');
  await earliestYear.fill('2020');
  await form.locator('[name="yearMax"]').fill('2025');
  await form.locator('[name="mileageMax"]').fill('80000');
  await form.locator('[name="powertrain"]').selectOption('petrol');
  await optionalToggle.press('Enter');
  await expect(earliestYear).toBeHidden();
  await optionalToggle.press('Space');
  await expect(earliestYear).toBeVisible();
  await expect(earliestYear).toHaveValue('2020');
  await expect(form.locator('[name="trim"]')).toHaveValue('touring');
  await expect(form.locator('[name="mileageMax"]')).toHaveValue('80000');
  expect(sent).toHaveLength(0);
  await form.locator('button[type="submit"]').click();
  const query = `${selected}&trim=touring&yearMin=2020&yearMax=2025&mileageMax=80000&powertrain=petrol`;
  await expect(page).toHaveURL(new RegExp(`\\?${query}$`));
  const result = page.getByTestId('market-result-region');
  const prices = result.locator('dl');
  for (const amount of ['21,000 USD', '20,900 USD', '18,000 USD', '24,000 USD', '≈ 147,000 CNY']) {
    await expect(prices.getByText(amount, { exact: true })).toBeVisible();
  }
  await expect(result).toContainText('共 13 辆在售车源');
  await expect(page.getByTestId('market-submitted-filters')).toContainText('Touring');
  await expect(page.getByTestId('market-submitted-filters')).toContainText('2020 – 2025');
  const percentile = result.getByTestId('market-percentile-range');
  await expect(percentile).toContainText(/P25/);
  await expect(percentile.getByText('20,000 USD – 22,000 USD', { exact: true })).toBeVisible();
  await expect(percentile.getByText('≈ 140,000 CNY – 154,000 CNY', { exact: true })).toBeVisible();
  await expect(page.getByTestId('market-listing-range')).toBeVisible();
  expect(sent.map(params => params.toString())).toEqual([`${query}&locale=zh`]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制查询链接' }).click();
  await expect(page.getByRole('status').filter({ hasText: '查询链接已复制' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  const detail = result.locator('a[href="/zh/cars/fixture_car_1/"]').first();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('2024');
  await expect(detail).toContainText('10,000');
  await expect(detail.getByText('18,000 USD', { exact: true })).toBeVisible();
  await expect(detail.getByText('≈ 126,000 CNY', { exact: true })).toBeVisible();
  await expect(detail.locator('img')).toHaveAttribute('src', /\/api\/v1\/media\/media_fixture_car_1\/(?:\?variant=thumb)?$/);
  await detail.click();
  await expect(page).toHaveURL(/\/zh\/cars\/fixture_car_1\//);
  await page.goBack();
  await expect(optionalToggle).toContainText('4');
  await expect(form.locator('[name="trim"]')).toHaveValue('touring');
  await expect(form.locator('[name="mileageMax"]')).toHaveValue('80000');
  await expect(page.getByTestId('market-result-region')).toContainText(/P25/);
  await chooseMarketOption(page, 'make', 'Beta');
  await expect(form.locator('[name="model"]')).toHaveValue('');
  await expect(form.locator('[name="trim"]')).toHaveValue('');
  await expect(page.getByTestId('market-submitted-filters')).not.toContainText('Beta');
});

test('shareable query retries in place after an API 503 and preserves filters on another language', async ({ page }) => {
  await useFacetFixtures(page);
  let requests = 0;
  await page.route(url => marketPath.test(url.pathname), (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('make')).toBe('alpha');
    expect(params.get('model')).toBe('alpha_model');
    requests++;
    return requests === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: fixtureReport(params.get('locale') as Language, 3) });
  });
  await page.goto(`/en/market-prices/?${selected}`);
  const optional = page.getByTestId('market-optional-filters');
  await expect(page.getByTestId('market-result-region').getByRole('alert')).toContainText('temporarily unavailable');
  await expect(optional).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('market-result-region')).toContainText('21,000');
  await expect(page.getByTestId('market-result-region')).not.toContainText('P25');
  const canonical = page.locator('link[rel="canonical"]');
  await expect(canonical).toHaveAttribute('href', /\/en\/market-prices\/$/);
  await expect(page.locator('link[rel="alternate"][hreflang="ru"]')).toHaveAttribute('href', /\/ru\/market-prices\/$/);
  const header = page.locator('header');
  await header.locator('.language-switch summary').click();
  await header.locator('.language-switch a[lang="ru"]').click();
  await expect(page).toHaveURL(/\/ru\/market-prices\/\?make=alpha&model=alpha_model$/);
  await expect(page.getByRole('heading', { name: 'Цены на автомобили с пробегом в Китае' })).toBeVisible();
  await expect(page.getByTestId('market-make-search')).toHaveAccessibleName('Марка');
  await expect(page.getByTestId('market-model-search')).toHaveAccessibleName('Модель');
  await expect(optional).toHaveAttribute('open', '');
  await expect(optional.locator('[name="yearMin"]')).toBeVisible();
  await expect(page.getByTestId('market-result-region')).toContainText(/21\s?000/);
  expect(requests).toBe(3);
});

test('slow first statistics can finish and returning cancels an obsolete query', async ({ page }) => {
  await useFacetFixtures(page);
  await page.clock.install();
  let releaseFirst = () => {};
  let releaseObsolete = () => {};
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  const obsoleteResponse = new Promise<void>(resolve => { releaseObsolete = resolve; });
  await page.route(url => marketPath.test(url.pathname), async (route) => {
    const obsolete = new URL(route.request().url()).searchParams.has('yearMin');
    await (obsolete ? obsoleteResponse : firstResponse);
    if (!route.request().failure()) await route.fulfill({ json: fixtureReport('en', obsolete ? 1 : 3) });
  });

  try {
    const firstRequest = page.waitForRequest(request => marketPath.test(new URL(request.url()).pathname));
    await page.goto(`/en/market-prices/?${selected}`);
    await firstRequest;
    const result = page.getByTestId('market-result-region');
    await expect(result).toHaveAttribute('aria-busy', 'true');
    await page.clock.fastForward(14_000);
    // Releasing the response after 14 seconds must still produce a result.
    releaseFirst();
    await expect(result).toContainText('21,000');

    const filteredRequest = page.waitForRequest(request => {
      const url = new URL(request.url());
      return marketPath.test(url.pathname) && url.searchParams.get('yearMin') === '2021';
    });
    await page.locator('[name="yearMin"]').fill('2021');
    await page.getByRole('button', { name: 'Check prices', exact: true }).click();
    const pendingRequest = await filteredRequest;
    await expect(result).toHaveAttribute('aria-busy', 'true');
    const aborted = page.waitForEvent('requestfailed', request => request === pendingRequest);
    await page.evaluate(() => history.back());
    expect((await aborted).failure()?.errorText).toContain('ERR_ABORTED');
    await expect(page).toHaveURL(new RegExp(`\\?${selected}$`));
    await expect(result).toContainText('21,000');
    await expect(result.getByRole('alert')).toHaveCount(0);
  } finally {
    releaseFirst();
    releaseObsolete();
  }
});

test('mobile empty and one-sample results are honest about the available data', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await useFacetFixtures(page);
  await page.route(url => marketPath.test(url.pathname), (route) => {
    const one = new URL(route.request().url()).searchParams.has('trim');
    return route.fulfill({ json: fixtureReport('en', one ? 1 : 0) });
  });
  await page.goto(`/en/market-prices/?${selected}`);
  const result = page.getByTestId('market-result-region');
  await expect(page.getByTestId('market-results')).toHaveAttribute('data-sample-state', 'empty');
  await expect(result).toContainText('No price samples');
  await expect(result).not.toContainText(/P25/);
  const summary = page.getByTestId('market-submitted-filters');
  await expect(summary).toContainText('alpha Model');
  await chooseMarketOption(page, 'make', 'Beta');
  await expect(summary).toContainText('alpha Model');
  await page.locator('header summary[aria-controls="site-mobile-nav"]').click();
  await expect(page.locator('#site-mobile-nav').getByRole('link', { name: 'China Used Car Prices' })).toBeVisible();
  await page.locator('header summary[aria-controls="site-mobile-nav"]').click();
  await page.goto(`/en/market-prices/?${selected}&trim=touring`);
  await expect(result.getByText('18,000 USD', { exact: true })).toBeVisible();
  await expect(result.locator('a[href^="/en/cars/"]:not([href*="#"])')).toHaveCount(1);
  await expect(result.getByTestId('market-listing-range')).toHaveCount(0);
  await expect(result).not.toContainText('P25');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test.describe('market filters on a touch screen', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('market make and model search locally, clear dependent filters, and commit only on query', async ({ page }) => {
    await useFacetFixtures(page, true);
    const facetReads: string[] = [];
    const marketReads: string[] = [];
    page.on('request', (request) => {
      const { pathname, search } = new URL(request.url());
      if (filtersPath.test(pathname)) facetReads.push(search);
      if (marketPath.test(pathname)) marketReads.push(search);
    });
    await page.route(url => marketPath.test(url.pathname), route => route.fulfill({ json: fixtureReport('en', 2) }));
    await page.goto('/en/market-prices/');

    const form = page.getByTestId('market-query-form');
    const optional = form.getByTestId('market-optional-filters');
    const make = form.getByTestId('market-make-search');
    const model = form.getByTestId('market-model-search');
    const brandOptions = form.getByRole('listbox', { name: 'Make', exact: true });
    const modelOptions = form.getByRole('listbox', { name: 'Model', exact: true });
    const initialUrl = page.url();
    await expect(make).toHaveAccessibleName('Make');
    await expect(model).toHaveAccessibleName('Model');
    await expect(model).toBeDisabled();
    await expect(optional).toHaveAttribute('open', '');
    await expect(form.locator('[name="yearMin"]')).toBeVisible();

    await make.tap();
    await expect(brandOptions.getByRole('option', { name: 'Alpha · Motors' })).toBeVisible();
    const initialReadCount = facetReads.length;
    await make.pressSequentially('H A-MoT', { delay: 20 });
    await expect(brandOptions.getByRole('option', { name: 'Alpha · Motors' })).toBeVisible();
    await expect(brandOptions.getByRole('option', { name: 'Beta' })).toHaveCount(0);
    await make.press('Escape');
    await expect(brandOptions).toBeHidden();
    await expect(form.locator('[name="make"]')).toHaveValue('');
    await expect(page).toHaveURL(initialUrl);
    expect(facetReads).toHaveLength(initialReadCount);
    expect(marketReads).toEqual([]);

    await make.tap();
    await make.fill('HAMOT');
    await brandOptions.getByRole('option', { name: 'Alpha · Motors' }).tap();
    await expect(form.locator('[name="make"]')).toHaveValue('alpha');
    await model.tap();
    await expect(modelOptions.getByRole('option', { name: 'Road-GT / Pro' })).toBeVisible();
    const committedMakeReadCount = facetReads.length;
    await model.pressSequentially('DGT/PR', { delay: 20 });
    await expect(modelOptions.getByRole('option', { name: 'Road-GT / Pro' })).toBeVisible();
    await expect(modelOptions.getByRole('option', { name: 'City' })).toHaveCount(0);
    await expect(form.locator('[name="model"]')).toHaveValue('');
    expect(facetReads).toHaveLength(committedMakeReadCount);
    await model.press('ArrowDown');
    await model.press('Enter');
    await expect(modelOptions).toBeHidden();
    await expect(form.locator('[name="model"]')).toHaveValue('alpha_model');
    await expect(page).toHaveURL(initialUrl);
    expect(marketReads).toEqual([]);

    await form.locator('[name="trim"]').selectOption('touring');
    await form.locator('[name="yearMin"]').fill('2020');
    await make.tap();
    await brandOptions.locator('[role="option"][data-option-id=""]').tap();
    await expect(form.locator('[name="make"]')).toHaveValue('');
    await expect(form.locator('[name="model"]')).toHaveValue('');
    await expect(form.locator('[name="trim"]')).toHaveValue('');
    await expect(form.locator('[name="yearMin"]')).toHaveValue('2020');
    await expect(model).toBeDisabled();

    await make.tap();
    await brandOptions.getByRole('option', { name: 'Alpha · Motors' }).tap();
    await model.tap();
    await modelOptions.getByRole('option', { name: 'Road-GT / Pro' }).tap();
    await expect(page).toHaveURL(initialUrl);
    expect(marketReads).toEqual([]);
    await form.getByRole('button', { name: 'Check prices' }).tap();
    const query = `${selected}&yearMin=2020`;
    await expect(page).toHaveURL(new RegExp(`\\?${query}$`));
    await expect(page.getByTestId('market-result-region')).toContainText('21,000');
    expect(marketReads).toEqual([`?${query}&locale=en`]);

    await page.reload();
    await expect(optional).toHaveAttribute('open', '');
    await expect(optional.locator('summary')).toContainText('1');
    await expect(form.locator('[name="make"]')).toHaveValue('alpha');
    await expect(form.locator('[name="model"]')).toHaveValue('alpha_model');
    await expect(form.locator('[name="yearMin"]')).toHaveValue('2020');
    await model.tap();
    await expect(modelOptions.getByRole('option', { name: 'Road-GT / Pro', selected: true })).toBeVisible();
  });
});

test('listing comparison opens vehicle history and draws only completed positive dated prices', async ({ page }) => {
  await useFacetFixtures(page);
  await page.route(url => marketPath.test(url.pathname), route => route.fulfill({ json: fixtureReport('en', 13) }));
  const historyReads: string[] = [];
  await page.route(url => historyPath.test(url.pathname), route => {
    const url = new URL(route.request().url());
    const vehicleId = historyPath.exec(url.pathname)![1];
    expect(url.searchParams.get('locale')).toBe('en');
    historyReads.push(vehicleId);
    const paged = vehicleId === 'fixture_car_1';
    const hasCursor = url.searchParams.has('cursor');
    const items = [{ id: 'latest', at: '2026-11-26T10:00:00Z', money: { amount: '9600.01', currency: 'CNY' }, kind: 'asking' }];
    if (paged) items.push(
      { id: 'earlier', at: '2026-11-23T10:00:00Z', money: { amount: '9600.99', currency: 'CNY' }, kind: 'asking' },
      { id: 'zero', at: '2026-11-27T10:00:00Z', money: { amount: '0', currency: 'CNY' }, kind: 'asking' },
    );
    const pageItems = hasCursor ? [{ id: 'undated', at: null, money: { amount: '9700', currency: 'CNY' }, kind: 'asking' }] : items;
    return route.fulfill({ json: { data: { vehicleId, locale: 'en', revision: 'a'.repeat(64), total: paged ? 4 : 1,
      items: pageItems, nextCursor: paged && !hasCursor ? 'next-history-page' : null },
      meta: { requestId: 'market-history-fixture' } } });
  });
  await page.goto(`/en/market-prices/?${selected}`);
  const links = page.getByRole('link', { name: 'Vehicle price history' });
  await expect(links).toHaveCount(2);
  expect(historyReads).toEqual([]);
  await links.first().click();
  await expect(page).toHaveURL(/fixture_car_1\/#vehicle-price-history-fixture_car_1$/);
  const section = page.locator('[data-public-price-history]');
  const historyRows = section.locator('[data-price-history-item]');
  const historyChart = section.getByTestId('vehicle-price-history-chart');
  await expect(historyRows).toHaveCount(3);
  await expect(historyChart).toHaveCount(0);
  await expect(section).toContainText('More price records are available.');
  expect(historyReads).toEqual(['fixture_car_1']);
  await section.getByRole('button', { name: 'Load more' }).click();
  await expect(historyRows).toHaveCount(4);
  await expect(historyChart).toBeVisible();
  const points = historyChart.locator('circle');
  await expect(points).toHaveCount(2);
  await expect(points.locator('title')).toHaveText([/ · 9,600 CNY$/, / · 9,600 CNY$/]);
  expect(Number(await points.first().getAttribute('cy'))).toBeLessThan(Number(await points.last().getAttribute('cy')));
  await expect(section.locator('[data-price-history-item="zero"] td').nth(1)).toHaveText('0');
  await expect(section.locator('[data-price-history-item="latest"] td').nth(1)).toHaveText('9,600');
  await expect(section.locator('[data-price-history-item="earlier"] td').nth(1)).toHaveText('9,600');
  expect(historyReads).toEqual(['fixture_car_1', 'fixture_car_1']);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`\\?${selected}$`));
  await links.last().click();
  await expect(historyRows).toHaveCount(1);
  await expect(historyChart).toHaveCount(0);
  expect(historyReads).toEqual(['fixture_car_1', 'fixture_car_1', 'fixture_car_2']);
});

test('a missing USD rate displays the whole part of a large CNY value without inferring an exchange rate', async ({ page }) => {
  await useFacetFixtures(page);
  await page.route(url => marketPath.test(url.pathname), (route) => {
    const fixture = fixtureReport('en', 1);
    fixture.data.fx = null;
    const amount = { usd: null, cny: { amount: '99999999999999.99', currency: 'CNY' as const } };
    fixture.data.statistics = { ...fixture.data.statistics, min: amount, max: amount, mean: amount, median: amount };
    return route.fulfill({ json: fixture });
  });
  await page.goto(`/en/market-prices/?${selected}`);
  const result = page.getByTestId('market-result-region');
  await expect(result.getByText('99,999,999,999,999 CNY', { exact: true })).toHaveCount(1);
  await expect(result).toContainText('USD prices are unavailable');
});

test('market extremes show current approved photos while missing photos stay read-only', async ({ page }) => {
  await page.clock.setFixedTime(new Date(asOf));
  await useFacetFixtures(page);
  const approved = 'https://erscglobal2.autoimg.cn/market-fixture.webp';
  const unrelated = 'https://market-images.example.invalid/market-fixture-unrelated.webp';
  const expired = 'https://erscglobal2.autoimg.cn/market-fixture-expired.webp';
  const broken = 'https://erscglobal2.autoimg.cn/market-fixture-broken.webp';
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4vyT/PwAHSgLyk2ZIzwAAAABJRU5ErkJggg==', 'base64');
  const imageRequests: string[] = [];
  const failureReports: string[] = [];

  await page.route(url => url.pathname.startsWith('/market-fixture'), async (route) => {
    const request = route.request();
    imageRequests.push(request.url());
    if (request.url() !== approved) return route.fulfill({ status: 404 });
    expect((await request.allHeaders()).referer).toBeUndefined();
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.route(url => url.pathname.startsWith('/api/v1/external-media/'), (route) => {
    failureReports.push(route.request().url());
    return route.fulfill({ status: 404 });
  });
  await page.route(url => marketPath.test(url.pathname), (route) => {
    const useUnavailableImages = new URL(route.request().url()).searchParams.has('trim');
    const fixture = fixtureReport('en', 2);
    const { min, max } = fixture.data.extremes;
    if (!min || !max) throw new Error('Missing extreme fixture');
    const cover = (index: number, url: string, expiresAt = '2026-11-27T13:00:00.000Z') => ({
      ...makePublicVehicleFixture().images[0]!,
      id: `ximg-a0b1c2d3-0000-4000-8000-00000000000${index}`,
      url,
      remote: { revision: 1, refreshedAt: '2026-11-27T10:00:00.000Z', expiresAt },
    });
    min.vehicle.images = [useUnavailableImages ? cover(3, expired, '2026-11-27T11:00:00.000Z') : cover(1, approved)];
    max.vehicle.images = [useUnavailableImages ? cover(4, broken) : cover(2, unrelated)];
    return route.fulfill({ json: MarketPriceResponseSchema.parse(fixture) });
  });

  const result = page.getByTestId('market-result-region');
  const minCard = result.locator('a[href="/en/cars/fixture_car_1/"]');
  const maxCard = result.locator('a[href="/en/cars/fixture_car_2/"]');
  const fallback = '[data-vehicle-photo-unavailable]';
  await page.goto(`/en/market-prices/?${selected}`);
  const approvedPhoto = minCard.locator('img');
  await approvedPhoto.scrollIntoViewIfNeeded();
  await expect(approvedPhoto).toHaveAttribute('src', approved);
  await expect.poll(() => approvedPhoto.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  await expect(maxCard.locator(fallback)).toBeVisible();
  await expect(maxCard.locator('img')).toHaveCount(0);
  expect(imageRequests).toEqual([approved]);

  await page.goto(`/en/market-prices/?${selected}&trim=touring`);
  await maxCard.scrollIntoViewIfNeeded();
  await expect.poll(() => imageRequests).toEqual([approved, broken]);
  await expect(minCard.locator(fallback)).toBeVisible();
  await expect(maxCard.locator(fallback)).toBeVisible();
  await expect(result.locator('img')).toHaveCount(0);
  expect(failureReports).toEqual([]);
});
