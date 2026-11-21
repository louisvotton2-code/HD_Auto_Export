import { expect, test } from '@playwright/test';
import { chooseCatalogBrand } from './helpers/catalog-brand';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Isolated catalog fixture only.');
test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
  await setPublicFixtureState(request, { richCatalog: true });
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

test('SSR and browser facet requests use scoped API projections', async ({ request }) => {
  await setPublicFixtureState(request, { largeFacetDictionary: true });
  const read = async (path: string) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    return response;
  };
  const condition = 'q=Beta&priceMin=0&priceMax=100000&priceCurrency=USD';
  const modelOnly = await read(`/en/cars/?model=beta_model&${condition}`);
  expect(await modelOnly.text()).toContain('value="beta_model"');
  const both = await read(`/en/cars/?make=beta&model=beta_model&${condition}`);
  expect(await both.text()).toContain('value="beta_model_trim"');
  await read('/en/');

  const facets = '/catalog-facets.json?locale=en&view=localized&priceView=usd';
  const overview = await (await read(facets)).json();
  expect(overview).toMatchObject({ hasTrims: true, hasGenerations: true, data: { models: [] } });
  expect(overview.data).not.toHaveProperty('trims');
  expect((await (await read(`${facets}&selectedModel=beta_model`)).json()).data.models)
    .toContainEqual(expect.objectContaining({ id: 'beta_model' }));
  const modelOptions = await (await read(`${facets}&make=beta`)).json();
  expect(modelOptions.data.models).toEqual([expect.objectContaining({ id: 'beta_model', makeId: 'beta' })]);
  expect(modelOptions.data).not.toHaveProperty('trims');
  const variants = await (await read(`${facets}&make=beta&model=beta_model`)).json();
  expect(variants.data.trims).toEqual([expect.objectContaining({ id: 'beta_model_trim', modelId: 'beta_model' })]);

  const fixture = await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`);
  expect(fixture.status()).toBe(200);
  const rows: { path: string; query: Record<string, string> }[] = (await fixture.json()).requests;
  const ssr = rows.filter(row => row.path === '/internal/public-catalog/vehicle-filters').map(row => row.query);
  const dynamic = rows.filter(row => row.path === '/api/v1/vehicle-filters').map(row => row.query);
  const bounds = { q: 'Beta', priceMin: '0', priceMax: '100000.49', priceCurrency: 'USD' };
  expect(ssr).toEqual(expect.arrayContaining([
    { catalog: 'curated', locale: 'en', view: 'localized', priceView: 'usd', projection: 'overview' },
    { catalog: 'curated', locale: 'en', view: 'localized', priceView: 'usd', projection: 'home-models' },
    expect.objectContaining({ ...bounds, projection: 'overview-models' }),
    expect.objectContaining({ ...bounds, projection: 'overview' }),
    expect.objectContaining({ ...bounds, projection: 'models', make: 'beta' }),
    expect.objectContaining({ ...bounds, projection: 'variants', make: 'beta', model: 'beta_model' }),
  ]));
  expect(ssr.every(query => query.projection)).toBe(true);
  expect(dynamic.map(query => query.projection)).toEqual(['overview', 'overview-models', 'models', 'variants']);
  expect(dynamic[1]).not.toHaveProperty('selectedModel');
  expect(dynamic[1]).not.toHaveProperty('model');
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
      'make',
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
    await chooseCatalogBrand(form, 'beta');
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

test('brand search filters available options before selection on touch and keyboard in all languages', async ({
  browser, baseURL,
}) => {
  const context = await browser.newContext({ baseURL, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const reads: string[] = [];
    page.on('request', request => {
      const { pathname } = new URL(request.url());
      if (pathname === '/catalog-facets.json' || /^\/api\/v1\/(?:vehicles|vehicle-filters)\/?$/.test(pathname))
        reads.push(request.url());
    });
    for (const [locale, label, placeholder, empty] of [
      ['zh', '品牌', '搜索品牌', '没有找到匹配的品牌'],
      ['en', 'Make', 'Search brands', 'No matching brands'],
      ['ru', 'Марка', 'Поиск по маркам', 'Подходящих марок нет'],
    ] as const) {
      await page.goto(`/${locale}/cars/?make=beta&model=beta_model&trim=beta_model_trim`);
      const initialUrl = page.url();
      const form = page.locator('main form').first();
      const search = form.getByTestId('catalog-brand-search');
      const brand = form.locator('select[name="make"]');
      const list = form.getByRole('listbox', { name: label });
      await expect(brand).toHaveCount(1);
      await expect(brand).toHaveValue('beta');
      await expect(search).toHaveAccessibleName(label);
      await expect(form.locator('[role="listbox"]')).toHaveCount(0);
      if (locale === 'ru') {
        const title = page.getByRole('heading', { name: 'Найдите свой следующий автомобиль', level: 1 });
        await expect(title).toBeInViewport({ ratio: 1 });
        await expect(search).toBeInViewport({ ratio: 1 });
        await expect(search).toHaveCSS('font-size', '16px');
        const searchBox = (await search.boundingBox())!;
        const generalSearch = (await form.locator('[name="q"]').boundingBox())!;
        expect(searchBox.height).toBeGreaterThanOrEqual(44);
        expect(searchBox.y).toBeLessThan(generalSearch.y);
      }
      const initialReads = reads.length;
      await search.tap();
      await expect(search).toHaveAttribute('placeholder', placeholder);
      await search.fill('zzz');
      await expect(form.getByText(empty, { exact: true })).toBeVisible();
      await search.press('Escape');
      await expect(list).toBeHidden();
      await expect(brand).toHaveValue('beta');

      await search.tap();
      await search.fill('L');
      const alpha = list.getByRole('option', { name: /Alpha Motors/ });
      await expect(alpha).toBeVisible();
      await expect(list.getByRole('option', { name: /Beta Motors/ })).toHaveCount(0);
      expect(reads).toHaveLength(initialReads);
      if (locale === 'en') {
        await search.press('ArrowDown');
        await expect(search).toHaveAttribute('aria-activedescendant', (await alpha.getAttribute('id'))!);
        await search.press('Enter');
      } else {
        await search.dispatchEvent('focusout', { relatedTarget: null });
        await alpha.tap();
      }
      await expect(brand).toHaveValue('alpha');
      await expect(search).toHaveAttribute('placeholder', 'Alpha Motors');
      await expect(list).toBeHidden();
      await expect(form.locator('[name=model]')).toHaveValue('');
      await expect(form.locator('[name=trim]')).toHaveValue('');
      await expect(page).toHaveURL(initialUrl);
    }
  } finally {
    await context.close();
  }
});

test('Russian mobile brand works with the native control before JavaScript is available', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, javaScriptEnabled: false, isMobile: true, hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/ru/cars/');
    const brand = page.getByRole('combobox', { name: 'Марка' });
    await expect(brand).toBeInViewport({ ratio: 1 });
    await expect(brand).toHaveCSS('font-size', '16px');
    expect((await brand.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await brand.selectOption('beta');
    await page.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('make')).toBe('beta');
    await expect(brand).toHaveValue('beta');
  } finally {
    await context.close();
  }
});

test('Russian mobile brand search keeps typed text while the catalog dictionary loads', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 },
  });
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  try {
    const page = await context.newPage();
    await page.route(url => url.pathname === '/catalog-facets.json', async route => {
      await pending;
      await route.continue();
    });
    await page.goto('/ru/');
    await expect(page.locator('html')).toHaveAttribute('data-public-history-ready', '');
    await page.locator('#home-shortcuts a[href="/ru/cars/"]').tap();
    const search = page.getByTestId('catalog-brand-search');
    await expect(search).toHaveAttribute('aria-busy', 'true');
    await search.tap();
    await search.fill('L');
    const picker = search.locator('../..');
    await expect(picker.getByRole('status')).toHaveText('Загружаем варианты фильтра…');
    release();
    await expect(search).toHaveValue('L');
    await expect(picker.getByRole('option', { name: /Alpha Motors/ })).toBeVisible();
    await expect(picker.getByRole('option', { name: /Beta Motors/ })).toHaveCount(0);
  } finally {
    release();
    await context.close();
  }
});

test('combined criteria filter the whole catalog before pagination and survive links, reload and Back', async ({
  page,
  request,
}) => {
  await page.goto('/en/cars/?pageSize=2');
  const form = page.locator('main form').first();
  await chooseCatalogBrand(form, 'beta');
  for (const [name, value] of Object.entries({
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
  const pageTwo = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/vehicles/' && url.searchParams.get('page') === '2' &&
      url.searchParams.get('trim') === 'beta_model_trim';
  });
  await next.click();
  expect((await pageTwo).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
  await expect(page.locator('main')).toContainText('5 vehicle records');
  await page.goBack();
  await expect(page).toHaveURL(first);
  await expect(form.locator('[name=trim]')).toHaveValue('beta_model_trim');
  await page.reload();
  await expect(form.locator('[name=mileageMin]')).toHaveValue('0');
  await chooseCatalogBrand(form, 'alpha');
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

test('shared catalog selections hydrate without facet reads and draft requests stay in their locale', async ({ page }) => {
  const reads: URL[] = [];
  const isFacet = (url: URL) => url.pathname.replace(/\/$/, '') === '/catalog-facets.json';
  const isScope = (url: URL, locale: string, make: string, model: string | null = null) =>
    isFacet(url) && url.searchParams.get('locale') === locale &&
    url.searchParams.get('make') === make && url.searchParams.get('model') === model;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (isFacet(url)) reads.push(url);
  });

  await page.goto('/ru/cars/?make=beta&model=beta_model&trim=beta_model_trim');
  const sharedUrl = page.url();
  const form = page.locator('main form').first();
  const make = form.locator('[name=make]');
  const model = form.locator('[name=model]');
  await expect(make).toHaveValue('beta');
  await expect(model).toHaveValue('beta_model');
  await expect(form.locator('[name=trim]')).toHaveValue('beta_model_trim');
  expect(reads).toHaveLength(0);

  // Keep the older draft request pending while returning to the server-provided brand.
  const russianAlpha = (url: URL) => isScope(url, 'ru', 'alpha');
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(russianAlpha, async (route) => {
    await held;
    if (!route.request().failure()) await route.continue();
  });
  try {
    const requested = page.waitForRequest((request) => russianAlpha(new URL(request.url())));
    await chooseCatalogBrand(form, 'alpha');
    await requested;
    expect(reads).toHaveLength(1);
    await expect(model).toHaveValue('');
    await expect(page).toHaveURL(sharedUrl);

    const aborted = page.waitForEvent('requestfailed', (request) => russianAlpha(new URL(request.url())));
    await chooseCatalogBrand(form, 'beta');
    expect((await aborted).failure()?.errorText).toContain('ERR_ABORTED');
    await expect(model.locator('option[value=beta_model]')).toHaveCount(1);
    await expect(model.locator('option[value=alpha_model]')).toHaveCount(0);
    await expect(form.locator('[name=trim]')).toHaveValue('');
    await expect(page).toHaveURL(sharedUrl);

    await page.locator('.language-switch summary').click();
    await page.locator('.language-switch a[lang=en]').click();
    await expect(page).toHaveURL(/\/en\/cars\/$/);
    await expect(make).toHaveValue('');
    await expect(model).toBeDisabled();
    await expect(make.locator('option[value=beta]')).toHaveCount(1);
    expect(reads).toHaveLength(2);
    expect(reads[1]?.searchParams.get('locale')).toBe('en');
    expect(reads[1]?.searchParams.has('make')).toBe(false);
  } finally {
    release();
    await page.unroute(russianAlpha);
  }

  await chooseCatalogBrand(form, 'beta');
  await expect(model.locator('option[value=beta_model]')).toHaveCount(1);
  await model.selectOption('beta_model');
  await expect(form.locator('[name=trim] option[value=beta_model_trim]')).toHaveCount(1);
  await expect(page).toHaveURL(/\/en\/cars\/$/);
  expect(reads).toHaveLength(4);
  expect(isScope(reads[2]!, 'en', 'beta')).toBe(true);
  expect(isScope(reads[3]!, 'en', 'beta', 'beta_model')).toBe(true);
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
    await expect(form.locator('select[name="make"]')).toBeVisible();
    await chooseCatalogBrand(form, 'beta', true);
    await form.locator('[name=drivetrain]').selectOption('awd');
    await form.locator('[name=priceMin]').selectOption('5000');
    await form.locator('[name=priceMax]').selectOption('20000');
    await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(2);
    await expect(page.locator('main')).toContainText('5 vehicle records');
    expect(new URL(page.url()).searchParams.get('make')).toBe('beta');
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
      await expect(form.locator('[name=model] option[value=alpha_model]')).toHaveCount(1);
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
  await chooseCatalogBrand(form, 'beta');
  for (const [name, value] of Object.entries({
    model: 'beta_model',
    trim: 'beta_model_trim',
    generation: 'beta_model_gen',
    powertrain: 'petrol',
    drivetrain: 'awd',
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
