import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';

// State-changing test controls are never sent to a real API, including the local 3320 DB.
const fixtureBaseValue = process.env.PUBLIC_FIXTURE_API_URL;
const fixtureBase = fixtureBaseValue ? new URL(fixtureBaseValue).origin : undefined;
const suite = 'hd-web-public-catalog-v1';
if (fixtureBaseValue) {
  const url = new URL(fixtureBaseValue);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port === '3320' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'PUBLIC_FIXTURE_API_URL must be a dedicated loopback fixture origin, never API 3320.',
    );
}

const labels = {
  zh: {
    title: '展示车型 Alpha',
    demo: '展示样例，非实际库存',
    home: '配置精选',
    price: /待询价|价格面议|请询价/,
  },
  en: {
    title: 'Showcase Alpha',
    demo: 'Display example, not actual inventory',
    home: 'Configured selection',
    price: /on request|contact for price/i,
  },
  ru: {
    title: 'Образец Alpha',
    demo: 'Демонстрационный образец, не реальное наличие',
    home: 'Подборка из настроек',
    price: /по запросу|уточн/i,
  },
};

async function fixture(
  request: APIRequestContext,
  method: 'post' | 'put' | 'get',
  path: string,
  data?: object,
) {
  // The marker is checked before each mutation, not just once at module import.
  const health = await request.get(`${fixtureBase}/__fixtures/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ suite });
  const response = await request[method](
    `${fixtureBase}/__fixtures/${path}`,
    data ? { data } : undefined,
  );
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.suite).toBe(suite);
  return result;
}

async function expectContacts(
  contacts: Locator,
  locale: string,
  stockCode: string,
  id: string,
  isDemo = true,
) {
  const links = contacts.locator('a[href^="https://t.me/"], a[href^="https://wa.me/"]');
  await expect(links).toHaveCount(2);
  const drafts = [];
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const url = new URL((await link.getAttribute('href'))!);
    expect(['https://t.me/HD_Auto_CN', 'https://wa.me/8618215932610']).toContain(
      url.origin + url.pathname,
    );
    const text = url.searchParams.get('text');
    expect(text).toContain(stockCode);
    expect(text).toContain(`/${locale}/cars/${id}/`);
    expect(text).not.toMatch(/(?:里程|Mileage|Пробег):\s*0\s*km/i);
    expect(text).not.toMatch(/\b0(?:\.00)?\s*USD\b/);
    expect(text).not.toContain(labels[locale as keyof typeof labels].demo);
    drafts.push(text);
  }
  expect(drafts[0]).toBe(drafts[1]);
  return drafts[0];
}

test.describe('public HTTP catalog against an isolated fixture API', () => {
  test.skip(
    !fixtureBase,
    'Requires PUBLIC_FIXTURE_API_URL and a website using that isolated fixture API.',
  );

  test.beforeEach(async ({ request }) => {
    await fixture(request, 'post', 'reset');
  });
  test.afterEach(async ({ request }) => {
    await fixture(request, 'post', 'reset');
  });

  for (const locale of ['zh', 'en', 'ru'] as const) {
    test(`${locale}: SSR, formal wording and the same vehicle/contact identity across pages`, async ({
      page,
      request,
    }) => {
      const response = await request.get(`/${locale}/`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain(labels[locale].home);
      expect(html).not.toContain(labels[locale].demo);
      expect(html).not.toContain('127.0.0.1:3327');
      expect(html).not.toContain('INTERNAL_FIXTURE_NOT_PUBLIC');
      await page.goto(`/${locale}/`);
      const home = page.locator('[data-home-section="vehicles-featured"]');
      await expect(home.locator('h2')).toHaveText(labels[locale].home);
      const homeCar = home.locator('[data-public-vehicle="fixture_demo"]');
      await expect(homeCar).not.toContainText(labels[locale].demo);
      await expect(homeCar).toContainText(labels[locale].price);
      const homeDraft = await expectContacts(homeCar, locale, 'SHOW-ALPHA', 'fixture_demo');

      await page.goto(`/${locale}/cars/`);
      const catalogCar = page.locator('main [data-public-vehicle="fixture_demo"]');
      await expect(catalogCar).toContainText(labels[locale].title);
      await expect(catalogCar).not.toContainText(labels[locale].demo);
      expect(await expectContacts(catalogCar, locale, 'SHOW-ALPHA', 'fixture_demo')).toBe(
        homeDraft,
      );
      await catalogCar.locator(`a[href="/${locale}/cars/fixture_demo/"]`).first().click();
      await expect(page.locator('main h1')).toHaveText(labels[locale].title);
      await expect(page.locator('main')).not.toContainText(labels[locale].demo);
      await expect(page.locator('main')).toContainText(labels[locale].price);
      expect(
        await expectContacts(
          page.locator('[data-vehicle-contacts="fixture_demo"]'),
          locale,
          'SHOW-ALPHA',
          'fixture_demo',
        ),
      ).toBe(homeDraft);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      const canonical = new URL(
        (await page.locator('link[rel="canonical"]').getAttribute('href'))!,
      );
      expect(canonical.pathname).toBe(`/${locale}/cars/fixture_demo/`);
      await expect(page.locator('main')).not.toContainText(/\b0\s*km\b|\b0(?:\.00)?\s*USD\b/);
    });
  }

  test('pagination and make/model/powertrain are served by HTTP and restored from the URL', async ({
    page,
    request,
  }) => {
    await page.goto('/en/cars/?page=2&pageSize=2');
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(2);
    await expect(page.locator('main [data-public-vehicle="fixture_demo"]')).toHaveCount(0);
    const form = page.locator('main form').first();
    await form.locator('select[name="make"]').selectOption('alpha');
    await form.locator('select[name="model"]').selectOption('alpha_model');
    await form.locator('select[name="powertrain"]').selectOption('bev');
    await form.locator('[type="submit"]').last().click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('1');
    const params = new URL(page.url()).searchParams;
    expect(params.get('make')).toBe('alpha');
    expect(params.get('model')).toBe('alpha_model');
    expect(params.get('powertrain')).toBe('bev');
    await expect(page.locator('main [data-public-vehicle="fixture_demo"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('select[name="make"]')).toHaveValue('alpha');
    await expect(page.locator('select[name="model"]')).toHaveValue('alpha_model');
    await expect(page.locator('select[name="powertrain"]')).toHaveValue('bev');
    const requests = (await fixture(request, 'get', 'requests')).requests;
    expect(
      requests.some(
        (r: { path: string; query: Record<string, string>; serviceAuthenticated?: boolean; hasVisitorIp?: boolean }) =>
          r.path === '/internal/public-catalog/vehicles' && r.serviceAuthenticated === true
          && r.hasVisitorIp === false && r.query.page === '2' && r.query.pageSize === '2',
      ),
    ).toBe(true);
    expect(
      requests.some(
        (r: { path: string; query: Record<string, string> }) =>
          r.path === '/api/v1/vehicles' &&
          r.query.make === 'alpha' &&
          r.query.model === 'alpha_model' &&
          r.query.powertrain === 'bev' &&
          r.query.page === '1',
      ),
    ).toBe(true);
    const next = page.locator('main a[href*="page=2"]').first();
    await expect(next).toBeVisible();
    await next.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    await expect(page.locator('main [data-public-vehicle="fixture_demo"]')).toHaveCount(0);
  });

  test('zero/one/two configured sections respect content and order without legacy mock filler', async ({
    page,
    request,
  }) => {
    await fixture(request, 'put', 'state', { sectionCount: 0 });
    await page.goto('/en/');
    await expect(page.locator('[data-home-section^="vehicles-"]')).toHaveCount(0);
    await expect(page.getByTestId('home-catalog-empty')).toBeVisible();
    await fixture(request, 'put', 'state', { sectionCount: 1 });
    await page.reload();
    await expect(page.locator('[data-home-section^="vehicles-"]')).toHaveCount(1);
    await expect(page.locator('[data-home-section="vehicles-featured"] article')).toHaveCount(3);
    await fixture(request, 'put', 'state', { sectionCount: 2 });
    await page.reload();
    const sections = page.locator('[data-home-section^="vehicles-"]');
    await expect(sections).toHaveCount(2);
    expect(
      await sections.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-home-section')),
      ),
    ).toEqual(['vehicles-featured', 'vehicles-recent']);
    await expect(sections.nth(1).locator('article')).toHaveCount(1);
    await expect(page.locator('main a[href*="/cars/kia-k3-2015/"]')).toHaveCount(0);
    await expect(page.locator('main a[href*="/cars/byd-seagull/"]')).toHaveCount(0);
  });

  test('API empty, unavailable and malformed responses stay distinct and retry recovers', async ({
    page,
    request,
  }) => {
    await fixture(request, 'put', 'state', { mode: 'empty' });
    await page.goto('/en/cars/');
    await expect(page.getByTestId('public-catalog-empty')).toBeVisible();
    await expect(page.getByTestId('public-catalog-error')).toHaveCount(0);
    for (const mode of ['unavailable', 'malformed']) {
      await fixture(request, 'put', 'state', { mode });
      await page.reload();
      await expect(page.getByTestId('public-catalog-error')).toBeVisible();
      await expect(page.getByTestId('public-catalog-empty')).toHaveCount(0);
      await expect(page.locator('main [data-public-vehicle]')).toHaveCount(0);
      await page.goto('/en/');
      await expect(page.getByTestId('home-catalog-error')).toBeVisible();
      await expect(page.locator('[data-home-section^="vehicles-"]')).toHaveCount(0);
      await fixture(request, 'put', 'state', { mode: 'normal' });
      await page.getByTestId('home-catalog-error').getByRole('link').first().click();
      await expect(page.locator('[data-home-section="vehicles-featured"]')).toBeVisible();
      await page.goto('/en/cars/');
    }
    await expect(page.locator('main [data-public-vehicle="fixture_demo"]')).toBeVisible();
  });

  test('filter service outage preserves a successful catalog and can recover independently', async ({
    page,
    request,
  }) => {
    await fixture(request, 'put', 'state', { filtersUnavailable: true });
    await page.goto('/en/cars/?page=2&pageSize=2');
    await expect(page.getByTestId('public-catalog-error')).toHaveCount(0);
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(2);
    const warning = page.getByTestId('public-filter-unavailable');
    await expect(warning).toBeVisible();
    await fixture(request, 'put', 'state', { filtersUnavailable: false });
    await warning.getByRole('link').click();
    await expect(page.locator('select[name="make"] option[value="alpha"]')).toHaveCount(1);
    await expect(page.locator('main [data-public-vehicle]')).toHaveCount(2);
    expect(new URL(page.url()).searchParams.get('page')).toBe('2');
  });

  test('publication, sold and archived status changes are visible without a website rebuild', async ({
    page,
    request,
  }) => {
    expect((await request.get('/en/cars/fixture_future/')).status()).toBe(404);
    await fixture(request, 'put', 'state', { futurePublished: true });
    await page.goto('/en/cars/fixture_future/');
    await expect(page.locator('main h1')).toHaveText('Newly published vehicle');
    await expectContacts(
      page.locator('[data-vehicle-contacts="fixture_future"]'),
      'en',
      'HD-FUTURE-01',
      'fixture_future',
      false,
    );
    await page.goto('/en/');
    await expect(page.locator('[data-public-vehicle="fixture_future"]')).toHaveCount(1);
    await fixture(request, 'put', 'state', { futureAvailability: 'sold' });
    await page.reload();
    await expect(page.locator('[data-public-vehicle="fixture_future"]')).toHaveCount(0);
    await page.goto('/en/cars/');
    await expect(page.locator('[data-public-vehicle="fixture_future"]')).toHaveCount(0);
    const sold = await page.goto('/en/cars/fixture_future/');
    expect(sold?.status()).toBe(200);
    await expect(page.locator('main')).toContainText(/sold/i);
    const soldDraft = await expectContacts(
      page.locator('[data-vehicle-contacts="fixture_future"]'),
      'en',
      'HD-FUTURE-01',
      'fixture_future',
      false,
    );
    expect(soldDraft).toMatch(/sold|similar/i);
    await fixture(request, 'put', 'state', { futureArchived: true });
    expect((await request.get('/en/cars/fixture_future/')).status()).toBe(404);
    expect((await request.get('/api/v1/media/media_fixture_future')).status()).toBe(404);
    for (const id of ['fixture_draft', 'fixture_archived', 'unknown_vehicle', 'byd-seagull'])
      expect((await request.get(`/en/cars/${id}/`)).status()).toBe(404);
  });

  test('detail service outage has readable retry content without JavaScript and recovers', async ({
    browser,
    baseURL,
    request,
  }) => {
    await fixture(request, 'put', 'state', { mode: 'unavailable' });
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto('/en/cars/fixture_demo/');
      const fallback = page.getByTestId('public-vehicle-unavailable');
      await expect(fallback.getByRole('heading')).not.toBeEmpty();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await fixture(request, 'put', 'state', { mode: 'normal' });
      await fallback.getByRole('link', {name: 'Reload', exact: true}).click();
      await expect(page.locator('main h1')).toHaveText(labels.en.title);
    } finally {
      await context.close();
    }
  });

  test('Back and Forward refresh restored vehicle state instead of reviving a cached available listing', async ({
    page,
    request,
  }) => {
    await fixture(request, 'put', 'state', { futurePublished: true });
    await page.goto('/en/cars/fixture_future/');
    await expect(page.locator('[data-availability="available"]')).toBeVisible();
    await page.getByRole('link', { name: /Back to selected vehicles/ }).click();
    await expect(page).toHaveURL(/\/en\/cars\/$/);
    await fixture(request, 'put', 'state', { futureAvailability: 'sold' });
    await page.goBack();
    await expect(page.locator('[data-availability="sold"]')).toBeVisible();
    await expect(page.locator('[data-availability="available"]')).toHaveCount(0);
    const draft = await expectContacts(
      page.locator('[data-vehicle-contacts="fixture_future"]'),
      'en',
      'HD-FUTURE-01',
      'fixture_future',
      false,
    );
    expect(draft).toContain('similar');
    await page.goForward();
    await expect(page.locator('[data-public-vehicle="fixture_future"]')).toHaveCount(0);
    await fixture(request, 'put', 'state', { futureArchived: true });
    await page.goBack();
    await expect(page.locator('[data-public-vehicle="fixture_future"]')).toHaveCount(0);
    await expect(page.getByTestId('public-vehicle-missing')).toBeVisible();
    expect((await request.get('/en/cars/fixture_future/')).status()).toBe(404);
  });

  test('browser API/media proxy is public-only and does not forward credentials or upstream private headers', async ({
    page,
    request,
  }) => {
    const headers = {
      Cookie: 'fake_employee_cookie=must-stay-at-web',
      Authorization: 'Bearer FIXTURE_ONLY_DO_NOT_FORWARD',
    };
    const api = await request.get('/api/v1/vehicles?locale=en&catalog=curated&page=1&pageSize=2', {
      headers,
    });
    expect(api.status()).toBe(200);
    expect((await api.json()).data.items).toHaveLength(2);
    const media = await request.get('/api/v1/media/media_fixture_demo', { headers });
    expect(media.status()).toBe(200);
    expect(media.headers()['content-type']).toMatch(/^image\//);
    expect(media.headers()['set-cookie']).toBeUndefined();
    expect(media.headers()['x-fixture-internal']).toBeUndefined();
    const requests = (await fixture(request, 'get', 'requests')).requests as Array<{
      cookie: string | null;
      authorization: string | null;
    }>;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.cookie === null && r.authorization === null)).toBe(true);
    for (const path of ['/api/v1/admin/me', '/api/auth/get-session', '/__fixtures/state'])
      expect((await request.get(path)).status()).toBe(404);
    expect((await request.post('/api/v1/vehicles', { data: {} })).status()).toBe(405);
    const outgoing: string[] = [];
    page.on('request', (req) => outgoing.push(req.url()));
    await page.goto('/en/cars/fixture_demo/');
    const image = page.locator('main img').first();
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(outgoing.some((url) => url.includes('127.0.0.1:3327'))).toBe(false);
  });

  test('320px Russian vehicle information remains readable and contactable without JavaScript', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width: 320, height: 844 },
    });
    const page = await context.newPage();
    await page.goto('/ru/cars/fixture_demo/');
    await expect(page.locator('main h1')).toHaveText(labels.ru.title);
    await expect(page.locator('main')).not.toContainText(labels.ru.demo);
    const contacts = page.locator('[data-vehicle-contacts="fixture_demo"]');
    await expectContacts(contacts, 'ru', 'SHOW-ALPHA', 'fixture_demo');
    await contacts.locator('a').first().focus();
    await expect(contacts.locator('a').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(contacts.locator('a').nth(1)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await context.close();
  });
});
