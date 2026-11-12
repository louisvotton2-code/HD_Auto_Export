import { expect, test, type Locator } from '@playwright/test';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated USD quotation fixtures only.');
test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
  await setPublicFixtureState(request, { richCatalog: true, sectionCount: 2 });
});
test.afterEach(async ({ request }) => resetPublicFixture(request));

const convertedId = 'fixture_car_3';
const nativeId = 'fixture_car_2';
const displayed = (scope: Locator, text: string) =>
  scope.getByText(text, { exact: true }).filter({ visible: true }).first();
const priceLine = (scope: Locator, type: 'original-price' | 'usd-approx') =>
  scope.locator(`[data-vehicle-${type}]`).filter({ visible: true }).first();

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: home, catalog, detail, saved cars and inquiry show source and rounded USD prices`, async ({ page }) => {
    const number = new Intl.NumberFormat(locale);
    const expectPrices = async (scope: Locator) => {
      const original = priceLine(scope, 'original-price');
      const approximation = priceLine(scope, 'usd-approx');
      await expect(original).toHaveText(`¥ ${number.format(8000)}`);
      await expect(approximation).toHaveText(`≈ ${number.format(1000)} USD`);
      expect((await original.boundingBox())!.y).toBeLessThan((await approximation.boundingBox())!.y);
    };
    const provider = 'https://www.exchangerate-api.com';
    const providerLink = (scope: Locator) =>
      scope.locator('[data-vehicle-rate-note]').getByRole('link', {
        name: 'Rates By Exchange Rate API', exact: true,
      });

    await page.goto(`/${locale}/`);
    const home = page.locator(`[data-public-vehicle="${convertedId}"]`);
    await expectPrices(home);
    await expect(providerLink(page.locator('main')).first()).toHaveAttribute('href', provider);

    await page.goto(`/${locale}/cars/?q=HD-${convertedId}`);
    const card = page.locator(`[data-public-vehicle="${convertedId}"]`);
    await expectPrices(card);
    await expect(page.locator('main [name=priceCurrency]')).toHaveValue('USD');
    await expect(page.locator('main [data-vehicle-rate-note] time')).toHaveCount(1);
    const inquiry = card.locator('a[href^="https://t.me/"]');
    const text = new URL((await inquiry.getAttribute('href'))!).searchParams.get('text');
    expect(text).toContain('8000 CNY (≈ 1000 USD)');
    await card.locator('button[aria-pressed]').click();
    await page.locator('button[aria-controls=vehicle-favorites]').click();
    const drawer = page.locator('#vehicle-favorites');
    await expectPrices(drawer.locator(`[data-favorite-vehicle="${convertedId}"]`));
    await expect(providerLink(drawer)).toHaveAttribute('href', provider);

    await page.goto(`/${locale}/cars/${convertedId}/`);
    await expectPrices(page.locator('main'));
    await expect(providerLink(page.locator('main'))).toHaveAttribute('href', provider);
    await page.setViewportSize({ width: 390, height: 920 });
    await expectPrices(page.locator('main'));
    const note = page.locator('main [data-vehicle-rate-note]').filter({ visible: true });
    await expect(note).toHaveCount(1);
    await expect(note.locator('time')).toHaveAttribute('datetime', '2026-11-08');
    await expect(providerLink(page.locator('main'))).toHaveAttribute('lang', 'en');
  });
}

test('USD boundaries are inclusive on the projected cents, while original requests keep source currency', async ({ request, page }) => {
  const path = '/api/v1/vehicles/?view=localized&locale=en&priceCurrency=';
  const source = await (await request.get(path + 'CNY&priceMin=8000&priceMax=8000')).json();
  expect(source.data.items.map((row: { id: string }) => row.id)).toEqual([convertedId]);
  expect(source.data.items[0].displayPrice).toBeUndefined();
  const bounds = 'priceCurrency=USD&priceMin=1000.00&priceMax=1000.00';
  const converted = await (await request.get('/api/v1/vehicles/?view=localized&locale=en&priceView=usd&' + bounds)).json();
  expect(converted.data.items.map((row: { id: string }) => row.id)).toEqual([convertedId]);
  expect(converted.data.items[0].price.money).toEqual({ amount: '8000', currency: 'CNY' });
  expect(converted.data.items[0].displayPrice.money).toEqual({ amount: '1000.00', currency: 'USD' });
  const facets = await (await request.get('/api/v1/vehicle-filters/?view=localized&locale=en&priceView=usd&' + bounds)).json();
  expect(facets.data.priceCurrencies).toEqual([{ id: 'USD', count: 1 }]);
  const outside = await (await request.get(path + 'USD&priceView=usd&priceMin=1000.01&priceMax=1000.01')).json();
  expect(outside.meta.total).toBe(0);
  expect((await request.get(path + 'CNY&priceView=usd&priceMin=8000')).status()).toBe(400);
  for (const resource of ['vehicles', 'vehicle-filters', 'home/vehicles', `vehicles/${convertedId}`]) {
    expect((await request.get(`/api/v1/${resource}/?locale=en&view=localized&priceView=`)).status()).toBe(400);
  }

  const q = `HD-${convertedId}`;
  await page.goto(`/en/cars/?q=${q}&${bounds}`);
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  for (const resource of ['vehicles', 'vehicle-filters']) {
    expect(events.requests).toEqual(expect.arrayContaining([expect.objectContaining({
      path: `/internal/public-catalog/${resource}`,
      serviceAuthenticated: true,
      hasVisitorIp: false,
      hasCookie: false,
      hasAuthorization: false,
      hasRequestId: false,
      query: expect.objectContaining({ q, priceView: 'usd', priceCurrency: 'USD', priceMin: '999.50', priceMax: '1000.49' }),
    })]));
  }
  const facetRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/v1/vehicle-filters/' &&
      url.searchParams.get('priceView') === 'usd' &&
      url.searchParams.get('priceCurrency') === 'USD' &&
      url.searchParams.get('priceMin') === '999.50' &&
      url.searchParams.get('priceMax') === '5000.49';
  });
  await page.locator('main form [name=priceMax]').selectOption('5000');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await facetRequest;

  await page.goto('/en/cars/?make=beta&priceCurrency=CNY&priceMin=8000&priceMax=8000');
  const form = page.locator('main form').first();
  await expect(form.locator('[name=make]')).toHaveValue('beta');
  await expect(form.locator('[name=priceMin]')).toHaveValue('');
  await expect(form.locator('[name=priceMax]')).toHaveValue('');
  await expect(form.locator('[name=priceCurrency]')).toHaveValue('USD');
  await expect(page.locator('main [data-public-vehicle]')).not.toHaveCount(1);
});

test('an unavailable conversion keeps the original amount, with whole dollars for a native USD price', async ({ request, page }) => {
  await setPublicFixtureState(request, { usdRateAvailable: false });
  await page.goto('/en/cars/');
  const main = page.locator('main');
  const converted = main.locator(`[data-public-vehicle="${convertedId}"]`);
  await expect(priceLine(converted, 'original-price')).toHaveText('¥ 8,000');
  await expect(converted.locator('[data-vehicle-usd-approx]')).toHaveCount(0);
  await expect(displayed(main.locator('[data-public-vehicle="fixture_demo"]'), 'Price on request')).toBeVisible();
  await expect(displayed(main.locator(`[data-public-vehicle="${nativeId}"]`), '7,000 USD')).toBeVisible();
  await expect(main.locator('[data-vehicle-rate-note]')).toHaveCount(0);
  const href = await converted.locator('a[href^="https://wa.me/"]').getAttribute('href');
  const text = new URL(href!).searchParams.get('text');
  expect(text).toContain('8000 CNY');
  expect(text).not.toContain('USD');
});
