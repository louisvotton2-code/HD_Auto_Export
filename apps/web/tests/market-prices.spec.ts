import { expect, test, type Page } from '@playwright/test';
import { MarketPriceResponseSchema, type MarketPriceResponse } from '@hd/contracts/public';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';

const marketPath = /^\/api\/v1\/public\/market-prices\/?$/;
const filtersPath = /^\/api\/v1\/vehicle-filters\/?$/;
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
  const min = count ? prices('18000.00', '126000.00') : null;
  const max = count === 1 ? min : count ? prices('24000.00', '168000.00') : null;
  return MarketPriceResponseSchema.parse({ data: {
    sampleCount: count, asOf, fx: count ? { asOf, source: 'synthetic' } : null,
    statistics: { min, max, mean: count > 1 ? prices('20900.00', '146300.00') : min,
      median: count > 1 ? prices('21000.00', '147000.00') : min,
      p25: count >= 10 ? prices('20000.00', '140000.00') : null,
      p75: count >= 10 ? prices('22000.00', '154000.00') : null },
    extremes: { min: count ? extreme(1) : null, max: count === 1 ? extreme(1) : count ? extreme(2) : null },
  }, meta: { requestId: 'market-fixture' } });
}

async function useFacetFixtures(page: Page) {
  await page.route(url => filtersPath.test(url.pathname), (route) => {
    const params = new URL(route.request().url()).searchParams;
    const make = params.get('make') ?? 'alpha';
    const projection = params.get('projection');
    return route.fulfill({ json: { data: { catalog: 'curated',
      makes: projection === 'overview' ? [{ id: 'alpha', name: 'Alpha', count: 100 }, { id: 'beta', name: 'Beta', count: 100 }] : [],
      models: projection === 'models' ? [{ id: `${make}_model`, makeId: make, name: `${make} Model`, count: 8 }] : [],
      trims: projection === 'variants' ? [{ id: 'touring', makeId: make, modelId: `${make}_model`, name: 'Touring', count: 4 }] : [],
      powertrains: [],
    }, meta: { requestId: 'market-options-fixture' } } });
  });
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
  await form.locator('[name="make"]').selectOption('alpha');
  await form.locator('[name="model"]').selectOption('alpha_model');
  await form.locator('[name="trim"]').selectOption('touring');
  await form.locator('[name="yearMin"]').fill('2020');
  await form.locator('[name="yearMax"]').fill('2025');
  await form.locator('[name="mileageMax"]').fill('80000');
  await form.locator('[name="powertrain"]').selectOption('petrol');
  expect(sent).toHaveLength(0);
  await form.locator('button[type="submit"]').click();
  const query = `${selected}&trim=touring&yearMin=2020&yearMax=2025&mileageMax=80000&powertrain=petrol`;
  await expect(page).toHaveURL(new RegExp(`\\?${query}$`));
  await expect(page.getByTestId('market-result-region')).toContainText('21,000');
  await expect(page.getByTestId('market-result-region')).toContainText('USD');
  await expect(page.getByTestId('market-result-region')).toContainText('共 13 辆在售车源');
  await expect(page.getByTestId('market-submitted-filters')).toContainText('Touring');
  await expect(page.getByTestId('market-submitted-filters')).toContainText('2020 – 2025');
  await expect(page.getByTestId('market-result-region')).toContainText(/P25/);
  expect(sent.map(params => params.toString())).toEqual([`${query}&locale=zh`]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制查询链接' }).click();
  await expect(page.getByRole('status').filter({ hasText: '查询链接已复制' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  const detail = page.getByTestId('market-result-region').locator('a[href="/zh/cars/fixture_car_1/"]').first();
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('2024');
  await expect(detail).toContainText('10,000');
  await expect(detail.locator('img')).toHaveAttribute('src', /\/api\/v1\/media\/media_fixture_car_1\/\?variant=card$/);
  await detail.click();
  await expect(page).toHaveURL(/\/zh\/cars\/fixture_car_1\//);
  await page.goBack();
  await expect(form.locator('[name="trim"]')).toHaveValue('touring');
  await expect(form.locator('[name="mileageMax"]')).toHaveValue('80000');
  await expect(page.getByTestId('market-result-region')).toContainText(/P25/);
  await form.locator('[name="make"]').selectOption('beta');
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
  await expect(page.getByTestId('market-result-region').getByRole('alert')).toContainText('temporarily unavailable');
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
  await expect(page.getByTestId('market-result-region')).toContainText(/21\s?000/);
  expect(requests).toBe(3);
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
  await page.locator('[name="make"]').selectOption('beta');
  await expect(summary).toContainText('alpha Model');
  await page.locator('header summary[aria-controls="site-mobile-nav"]').click();
  await expect(page.locator('#site-mobile-nav').getByRole('link', { name: 'China Used Car Prices' })).toBeVisible();
  await page.locator('header summary[aria-controls="site-mobile-nav"]').click();
  await page.goto(`/en/market-prices/?${selected}&trim=touring`);
  await expect(result).toContainText('18,000');
  await expect(result.locator('a[href^="/en/cars/"]')).toHaveCount(1);
  await expect(result).not.toContainText('P25');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test('a missing USD rate keeps exact CNY and never infers an exchange rate', async ({ page }) => {
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
  await expect(result.getByText('99,999,999,999,999.99 CNY', { exact: true })).toHaveCount(1);
  await expect(result).toContainText('USD prices are unavailable');
});
