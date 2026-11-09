import { expect, test } from '@playwright/test';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated catalog fixture only.');
test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
  await setPublicFixtureState(request, { richCatalog: true });
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

for (const locale of ['zh', 'en', 'ru']) {
  test(`${locale}: reference filter groups use real options, render before JS and fit the screen`, async ({
    page,
    request,
  }) => {
    const response = await request.get(`/${locale}/cars/`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    for (const name of [
      'generation',
      'drivetrain',
      'trim',
      'priceMin',
      'priceMax',
      'mileageMin',
      'mileageMax',
      'yearMin',
      'yearMax',
    ])
      expect(html).toContain(`name="${name}"`);
    await page.goto(`/${locale}/cars/`);
    const form = page.locator('main form').first();
    await expect(form.locator('[name=priceCurrency]')).toHaveValue('USD');
    await expect(form.locator('[name=model]')).toBeDisabled();
    await form.locator('[name=make]').selectOption('beta');
    await expect(form.locator('[name=model]')).toBeEnabled();
    await form.locator('[name=model]').selectOption('beta_model');
    await expect(form.locator('[name=trim] option[value=beta_model_trim]')).toHaveCount(1);
    await expect(form.locator('[name=generation] option[value=alpha_model_gen]')).toHaveCount(0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const min = await form.locator('[name=priceMin]').boundingBox(),
        max = await form.locator('[name=priceMax]').boundingBox();
      expect(Math.abs(min!.y - max!.y)).toBeLessThan(1);
      expect(min!.x + min!.width).toBeLessThan(max!.x);
    }
  });
}

test('combined criteria filter the whole catalog before pagination and survive links, reload and Back', async ({
  page,
  request,
}) => {
  await page.goto('/en/cars/?pageSize=2');
  const form = page.locator('main form').first();
  for (const [name, value] of Object.entries({
    make: 'beta',
    model: 'beta_model',
    generation: 'beta_model_gen',
    powertrain: 'petrol',
    drivetrain: 'awd',
    trim: 'beta_model_trim',
    priceMin: '5000',
    priceMax: '20000',
    mileageMin: '0',
    mileageMax: '150000',
    yearMin: '2020',
    yearMax: '2025',
  }))
    await form.locator(`[name=${name}]`).selectOption(value);
  await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.locator('main [data-public-vehicle]')).toHaveCount(2);
  await expect(page.locator('main')).toContainText('5 vehicle records');
  const first = page.url();
  const wanted = new URL(first).searchParams;
  expect(wanted.get('mileageMin')).toBe('0');
  const next = page.locator('main a[rel=next]');
  for (const [key, value] of wanted)
    if (key !== 'page')
      expect(new URL((await next.getAttribute('href'))!, first).searchParams.get(key)).toBe(value);
  await next.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
  await expect(page.locator('main')).toContainText('5 vehicle records');
  await page.goBack();
  await expect(page).toHaveURL(first);
  await expect(form.locator('[name=trim]')).toHaveValue('beta_model_trim');
  await page.reload();
  await expect(form.locator('[name=mileageMin]')).toHaveValue('0');
  await form.locator('[name=make]').selectOption('alpha');
  for (const name of ['model', 'generation', 'trim'])
    await expect(form.locator(`[name=${name}]`)).toHaveValue('');
  const calls = await (
    await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)
  ).json();
  expect(
    calls.requests.some(
      (x: { path: string; query: Record<string, string> }) =>
        x.path === '/api/v1/vehicles' &&
        x.query.trim === 'beta_model_trim' &&
        x.query.page === '2' &&
        x.query.view === 'localized',
    ),
  ).toBe(true);
});

test('range validation blocks a reversed UI range; the BFF rejects malformed and repeated filters', async ({
  page,
  request,
}) => {
  await page.goto('/en/cars/');
  const form = page.locator('main form').first();
  await form.locator('[name=priceMin]').selectOption('50000');
  await form.locator('[name=priceMax]').selectOption('10000');
  await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('upper limit');
  await expect(page).toHaveURL(/\/en\/cars\/$/);
  for (const query of [
    'mileageMin=1e3',
    'yearMin=2025&yearMax=2020',
    'priceMin=100&priceMax=5&priceCurrency=USD',
    'priceMin=50',
    'mileageMin=0&mileageMin=1',
    'generation=ii',
  ]) {
    for (const path of ['vehicles', 'vehicle-filters'])
      expect(
        (await request.get(`/api/v1/${path}/?locale=en&view=localized&${query}`)).status(),
      ).toBe(400);
  }
});

test('currency-only does not discard cars; zero mileage and native-currency bounds exclude unknown facts', async ({
  request,
  page,
}) => {
  const read = async (q: string) => {
    const res = await request.get(`/api/v1/vehicles/?locale=en&view=localized&${q}`);
    expect(res.status()).toBe(200);
    return res.json();
  };
  expect((await read('priceCurrency=USD')).meta.total).toBe(26);
  expect((await read('mileageMin=0')).meta.total).toBe(24);
  const usd = await read('priceMin=0&priceMax=20000&priceCurrency=USD&pageSize=48');
  expect(
    usd.data.items.every(
      (v: { price: { money: { currency: string; amount: string } } }) =>
        v.price.money.currency === 'USD' && Number(v.price.money.amount) <= 20000,
    ),
  ).toBe(true);
  expect(usd.meta.total).toBe(10);
  const cny = await read('priceMin=0&priceMax=20000&priceCurrency=CNY&pageSize=48');
  expect(cny.meta.total).toBe(5);
  await setPublicFixtureState(request, { richCatalog: false });
  await page.goto('/en/cars/');
  for (const name of ['generation', 'trim', 'drivetrain'])
    await expect(page.locator(`main form select[name=${name}]`)).toHaveCount(0);
  expect((await read('mileageMin=0')).meta.total).toBe(0);
});

test('native GET form works without JavaScript with restored parent, range and currency fields', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/en/cars/?make=beta&model=beta_model&pageSize=2');
    const form = page.locator('main form').first();
    await form.locator('[name=drivetrain]').selectOption('awd');
    await form.locator('[name=priceMin]').selectOption('5000');
    await form.locator('[name=priceMax]').selectOption('20000');
    await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(2);
    await expect(page.locator('main')).toContainText('5 vehicle records');
    expect(new URL(page.url()).searchParams.get('priceCurrency')).toBe('USD');
  } finally {
    await context.close();
  }
});

test('a model-only URL remains constrained when submitting other criteria, with or without JavaScript', async ({
  browser,
  baseURL,
}) => {
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ baseURL, javaScriptEnabled });
    try {
      const page = await context.newPage();
      await page.goto('/en/cars/?model=beta_model&pageSize=2');
      const form = page.locator('main form').first();
      await expect(form.locator('[name=model]')).toHaveValue('beta_model');
      await expect(form.locator('[name=model]')).toBeEnabled();
      await form.locator('[name=mileageMin]').selectOption('0');
      await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await expect(page.locator('main')).toContainText('12 vehicle records');
      expect(new URL(page.url()).searchParams.get('model')).toBe('beta_model');
    } finally {
      await context.close();
    }
  }
});

test('restored decimal money bounds keep their exact cents in the option label and the query', async ({
  page,
}) => {
  await page.goto('/en/cars/?priceMin=99999999999999.99&priceCurrency=USD');
  const form = page.locator('main form').first();
  await expect(form.locator('[name=priceMin] option:checked')).toHaveText('99,999,999,999,999.99');
  await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
  expect(new URL(page.url()).searchParams.get('priceMin')).toBe('99999999999999.99');
});

test('reset clears unapplied drafts and validation on the already-unfiltered URL', async ({
  page,
}) => {
  await page.goto('/en/cars/');
  const form = page.locator('main form').first();
  await form.locator('[name=q]').fill('unapplied inquiry');
  for (const [name, value] of Object.entries({
    make: 'beta',
    model: 'beta_model',
    trim: 'beta_model_trim',
    generation: 'beta_model_gen',
    powertrain: 'petrol',
    drivetrain: 'awd',
    priceCurrency: 'CNY',
    priceMin: '50000',
    priceMax: '10000',
    mileageMin: '0',
    yearMin: '2021',
  }))
    await form.locator(`[name=${name}]`).selectOption(value);
  await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await form.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveCount(0);
  for (const name of [
    'q',
    'make',
    'model',
    'trim',
    'generation',
    'powertrain',
    'drivetrain',
    'priceMin',
    'priceMax',
    'mileageMin',
    'yearMin',
  ])
    await expect(form.locator(`[name=${name}]`)).toHaveValue('');
  await expect(form.locator('[name=priceCurrency]')).toHaveValue('USD');
  await expect(form.locator('[name=model]')).toBeDisabled();
  await expect(page).toHaveURL(/\/en\/cars\/$/);
});

test('vehicle detail opens at the top from a scrolled catalog', async ({ page }) => {
  await page.goto('/en/cars/');
  const link = page.locator('main').getByRole('link', { name: 'View details', exact: true }).last();
  await link.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
  await link.click();
  await expect(page).toHaveURL(/\/en\/cars\/fixture_car_\d+\/$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});
