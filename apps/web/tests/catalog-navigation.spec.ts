import { expect, test, type Locator } from '@playwright/test';
import { chooseCatalogBrand } from './helpers/catalog-brand';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

// OPS runs this against the isolated health-marked fixture, never against published inventory.
test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

async function documentTop(locator: Locator) {
  return locator.evaluate(node => node.getBoundingClientRect().top + window.scrollY);
}

test('mobile catalog navigation shows cards before filters and keeps the paginated results in view', async ({ page, request }) => {
  await setPublicFixtureState(request, { catalogSampleCount: 26 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('data-public-history-ready', '');
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const facetPath = (url: URL) => url.pathname === '/catalog-facets.json';
  let reads = 0;
  await page.route(facetPath, async route => {
    reads++;
    await held;
    await route.continue();
  });
  const results = page.locator('#catalog-results');
  const cards = results.locator('[data-public-vehicle]');
  let resultsTop = 0;
  try {
    await page.locator('#home-shortcuts a[href="/en/cars/"]').click();
    await expect(page).toHaveURL(/\/en\/cars\/$/);
    await expect(cards.first().locator('h2 a')).toBeVisible();
    await expect(results).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('public-filter-loading')).toBeVisible();
    await expect.poll(() => reads).toBe(1);
    const firstId = await cards.first().getAttribute('data-public-vehicle');
    await results.locator('a[rel="next"]').click();
    await expect(results.locator('[aria-current="page"]')).toHaveText('2');
    await expect(cards.first()).not.toHaveAttribute('data-public-vehicle', firstId!);
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    resultsTop = await results.evaluate(node => node.getBoundingClientRect().top);
  } finally {
    release();
  }
  await expect(page.locator('select[name="make"] option[value="beta"]')).toHaveCount(1);
  await expect(page.getByTestId('public-filter-loading')).toHaveCount(0);
  expect(reads).toBe(1);
  expect(Math.abs(await results.evaluate(node => node.getBoundingClientRect().top) - resultsTop)).toBeLessThanOrEqual(2);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/cars\/$/);
  await expect(results.locator('[aria-current="page"]')).toHaveText('1');
  await expect(page.locator('select[name="make"] option[value="beta"]')).toHaveCount(1);
});

test('mobile catalog keeps its scroll position when model variants arrive before the other filters', async ({ page, request }) => {
  await setPublicFixtureState(request, { richCatalog: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('data-public-history-ready', '');
  // Exercise the app's correction when the browser does not preserve a scroll anchor.
  await page.addStyleTag({ content: 'html { overflow-anchor: none; }' });
  const link = page.locator('[data-home-section="popular-models"] a[href*="model="]').first();
  const destination = new URL((await link.getAttribute('href'))!, page.url());
  const model = destination.searchParams.get('model');
  const results = page.locator('#catalog-results');
  const position = () => results.evaluate(node => node.getBoundingClientRect().top);
  let releaseVariants = () => {};
  let releaseRemaining = () => {};
  const variants = new Promise<void>(resolve => { releaseVariants = resolve; });
  const remaining = new Promise<void>(resolve => { releaseRemaining = resolve; });
  await page.route(url => url.pathname === '/catalog-facets.json', async route => {
    const url = new URL(route.request().url());
    await (url.searchParams.has('model') ? variants : remaining);
    await route.continue();
  });
  try {
    await link.click();
    await expect(page).toHaveURL(destination.href);
    await expect(results.locator('[data-public-vehicle]').first()).toBeVisible();
    await expect(page.getByTestId('public-filter-loading')).toBeVisible();
    await results.evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const before = await position();
    releaseVariants();
    await expect(page.locator(`select[name="trim"] option[value="${model}_trim"]`)).toHaveCount(1);
    await expect(page.getByTestId('public-filter-loading')).toBeVisible();
    expect(Math.abs(await position() - before)).toBeLessThanOrEqual(2);
    releaseRemaining();
    await expect(page.getByTestId('public-filter-loading')).toHaveCount(0);
    expect(Math.abs(await position() - before)).toBeLessThanOrEqual(2);
    await expect(page.locator('select[name="model"]')).toHaveValue(model!);
  } finally {
    releaseVariants();
    releaseRemaining();
  }
});

test('catalog pagination shows immediate local busy feedback, retains its cards and recovers after an error', async ({ page }) => {
  await page.goto('/en/cars/?pageSize=2');
  const catalog = page.getByTestId('public-vehicle-catalog');
  const resource = page.locator('[data-resource-url]').filter({ has: catalog });
  await expect(resource).toHaveAttribute('data-freshness', 'fresh');
  const resourcePath = new URL((await resource.getAttribute('data-resource-url'))!, page.url()).pathname;
  const results = page.locator('#catalog-results');
  const cards = results.locator('[data-public-vehicle]');
  const retainedIds = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')));
  expect(retainedIds.length).toBe(2);
  const topBefore = await documentTop(cards.first());
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let fail = true;
  await page.route(url => url.pathname === resourcePath && url.searchParams.get('page') === '2', async route => {
    if (fail) {
      await held;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    } else await route.continue();
  });
  try {
    await results.locator('a[rel="next"]').click();
    await expect(results).toHaveAttribute('aria-busy', 'true');
    await expect(resource).toHaveAttribute('data-freshness', 'checking');
    expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')))).toEqual(retainedIds);
    expect(Math.abs(await documentTop(cards.first()) - topBefore)).toBeLessThan(1);
  } finally {
    release();
  }
  await expect(resource).toHaveAttribute('data-freshness', 'error');
  await expect(results).toHaveAttribute('aria-busy', 'false');
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-public-vehicle')))).toEqual(retainedIds);
  fail = false;
  await results.getByTestId('public-resource-status').getByRole('button').click();
  await expect(resource).toHaveAttribute('data-freshness', 'fresh');
  await expect(results).toHaveAttribute('aria-busy', 'false');
  await expect(results.locator('[aria-current="page"]')).toHaveText('2');
});

test('a vehicle card opens a live document with no background detail prefetch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/cars/?pageSize=2');
  const link = page.locator('[data-public-vehicle] h2 a').first();
  const destination = new URL((await link.getAttribute('href'))!, page.url());
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === destination.pathname) requests.push(request.resourceType());
  });
  await link.hover();
  expect(requests).toEqual([]);
  const response = page.waitForResponse(response => response.url() === destination.href && response.request().isNavigationRequest());
  await link.click();
  expect((await response).status()).toBe(200);
  expect(requests).toEqual(['document']);
  await expect(page.locator('[data-public-vehicle-detail]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('browser Back and the detail return link preserve a filtered and paginated catalog', async ({ page, request }) => {
  await setPublicFixtureState(request, { catalogSampleCount: 26 });
  await page.goto('/en/cars/?pageSize=2');
  const form = page.locator('main form').first();
  await chooseCatalogBrand(form, 'alpha');
  await form.locator('select[name="sort"]').selectOption('price_asc');
  await form.locator('[type="submit"]').last().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('make')).toBe('alpha');
  await page.locator('#catalog-results a[rel="next"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
  await expect(page.locator('#catalog-results [aria-current="page"]')).toHaveText('2');
  const original = new URL(page.url());
  expect(original.searchParams.get('sort')).toBe('price_asc');
  expect(original.searchParams.get('pageSize')).toBe('2');
  const filtered = original.pathname + original.search;
  const cards = page.locator('[data-public-vehicle] h2 a');
  const first = await cards.first().getAttribute('href');
  await cards.first().click();
  await expect(page.locator('[data-public-vehicle-detail]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(original.href);
  await expect(cards.first()).toHaveAttribute('href', first!);
  await expect(page.locator('#catalog-results [aria-current="page"]')).toHaveText('2');
  await expect(page.locator('select[name="make"]')).toHaveValue('alpha');
  await cards.first().click();
  const back = page.locator('[data-public-vehicle-detail] a[href^="/en/cars/?"]').first();
  await expect(back).toHaveAttribute('href', filtered);
  await back.click();
  await expect(cards.first()).toHaveAttribute('href', first!);
  await expect(page.locator('#catalog-results [aria-current="page"]')).toHaveText('2');
  await expect(page.locator('select[name="make"]')).toHaveValue('alpha');
});

test('an already rendered catalog card cannot open a withdrawn detail', async ({ page, request }) => {
  await setPublicFixtureState(request, { futurePublished: true });
  await page.goto('/en/cars/');
  const staleCard = page.locator('[data-public-vehicle="fixture_future"] h2 a');
  await expect(staleCard).toBeVisible();
  await setPublicFixtureState(request, { futureArchived: true });
  const detail = page.waitForResponse(response => response.request().isNavigationRequest() && response.url().endsWith('/en/cars/fixture_future/'));
  await staleCard.click();
  expect((await detail).status()).toBe(404);
  await expect(page.locator('[data-public-vehicle-detail]')).toHaveCount(0);
});

test('a restored detail hides old facts during revalidation and keeps them hidden on failure', async ({ page }) => {
  await page.goto('/en/cars/fixture_car_1/');
  const detail = page.locator('[data-public-vehicle-detail]');
  await expect(detail).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-public-history-ready', '');
  const isDetailApi = (url: URL) => url.pathname === '/api/v1/vehicles/fixture_car_1/';
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(isDetailApi, async route => {
    await held;
    await route.fulfill({ status: 503, json: {} });
  });
  try {
    const requested = page.waitForRequest(request => isDetailApi(new URL(request.url())));
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await requested;
    await expect(detail).not.toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByTestId('public-vehicle-unavailable')).toBeVisible();
  const status = page.getByTestId('public-resource-status');
  await expect(status.getByRole('button')).toBeVisible();
  await expect(detail).not.toBeVisible();
  await page.unroute(isDetailApi);
  await status.getByRole('button').click();
  await expect(detail).toBeVisible();
});

test('route skeletons do not change missing vehicle or invalid catalog queries into streamed success responses', async ({ request }) => {
  for (const locale of ['zh', 'en', 'ru']) {
    const missing = await request.get(`/${locale}/cars/fixture_ext07_missing/`);
    expect(missing.status()).toBe(404);
    const invalid = await request.get(`/${locale}/cars/?page=0`);
    expect(invalid.status()).toBe(404);
  }
});

test('vehicle details render the same English heading and metadata with one localized read per language', async ({ browser, baseURL, request }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    let englishHeading = '';
    let englishDocumentTitle = '';
    for (const locale of ['en', 'zh', 'ru']) {
      const response = await page.goto(`/${locale}/cars/fixture_car_3/`);
      expect(response?.status()).toBe(200);
      const main = page.locator('main[data-public-vehicle-detail="fixture_car_3"]');
      await expect(main).toBeVisible();
      await expect(main.locator('h1')).toBeVisible();
      const heading = main.locator('h1');
      await expect(heading).toHaveAttribute('lang', 'en');
      if (locale === 'en') {
        englishHeading = await heading.innerText();
        englishDocumentTitle = await page.title();
      }
      await expect(heading).toHaveText(englishHeading);
      await expect(page).toHaveTitle(englishDocumentTitle);
      await expect(main.locator('[data-vehicle-original-price]').filter({ visible: true }).first()).toContainText(/\d/);
      await expect(main.locator('[data-vehicle-contacts] a[href^="https://t.me/"]').first()).toBeVisible();
      await expect(main.locator('[data-vehicle-contacts] a[href^="https://wa.me/"]').first()).toBeVisible();
    }
    const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
    const details = events.requests.filter((entry: { path: string }) => entry.path.endsWith('/vehicles/fixture_car_3'));
    expect(details.map(({ query }: { query: { locale: string; titleView?: string } }) => [query.locale, query.titleView])).toEqual([
      ['en', undefined], ['zh', 'english'], ['ru', 'english'],
    ]);
  } finally {
    await context.close();
  }
});

test('an absent English title keeps the localized heading, metadata and share link consistent', async ({ page, request }) => {
  await setPublicFixtureState(request, { omitEnglishTitle: true });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (value: string) => { document.documentElement.dataset.copiedLink = value; } },
    });
  });
  await page.goto('/ru/cars/fixture_car_3/');
  const heading = page.locator('main[data-public-vehicle-detail] h1');
  await expect(heading).toHaveAttribute('lang', 'ru');
  await expect(heading).toContainText('Подобранный автомобиль');
  await expect(page).toHaveTitle(await heading.innerText());
  await expect(page.locator('html')).toHaveAttribute('data-public-history-ready', '');
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-copied-link', page.url());
  const events = await (await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`)).json();
  const details = events.requests.filter((entry: { path: string }) => entry.path.endsWith('/vehicles/fixture_car_3'));
  expect(details.map(({ query }: { query: { locale: string } }) => query.locale)).toEqual(['ru']);
});
