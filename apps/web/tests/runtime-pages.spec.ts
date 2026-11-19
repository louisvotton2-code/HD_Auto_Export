import { fillNumericDate } from './helpers/numeric-date';
import { expect, test } from '@playwright/test';

const destinations = [
  'russia',
  'kazakhstan',
  'uzbekistan',
  'georgia',
  'armenia',
  'kyrgyzstan',
  'albania',
] as const;

for (const locale of ['zh', 'en', 'ru'] as const) {
  for (const destination of destinations) {
    test(`${locale}/${destination} opens and refreshes as an independent server-rendered page`, async ({
      page,
      request,
    }) => {
      await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const route = `/${locale}/calculator/${destination}/`;
      const html = await request.get(route);
      expect(html.status()).toBe(200);
      expect(html.headers()['content-type']).toContain('text/html');
      // These exist before JavaScript runs, so indexing never depends on hydration.
      const heading = (await html.text())
        .match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
        .replace(/<[^>]+>/g, '')
        .trim();
      expect(
        heading,
        'SSR must include the actual localized heading, including nested accent spans',
      ).toBeTruthy();
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute(
        'lang',
        locale === 'zh' ? 'zh-Hans' : locale,
      );
      await expect(page.locator('.reset-button')).toBeEnabled();
      const defaultResult = page.getByTestId(destination === 'albania' ? 'total' : 'manufacture-range-total');
      await expect(defaultResult).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/calculator/${destination}/?$`),
      );
      const refreshed = await page.reload();
      expect(refreshed?.status()).toBe(200);
      await expect(page.locator('.reset-button')).toBeEnabled();
      await expect(defaultResult).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test('root defaults to Russian home and calculator shortcuts still reach their destinations', async ({
  page,
  request,
}) => {
  const entry = await request.get('/', { maxRedirects: 0 });
  expect(entry.status()).toBe(307);
  expect(entry.headers()['location']).toBe('/ru/');
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/ru\/$/);
  await expect(page.getByTestId('home-page')).toBeVisible();
  for (const locale of ['zh', 'en', 'ru']) {
    const home = await page.goto(`/${locale}/`);
    expect(home?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/${locale}/$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'zh' ? 'zh-Hans' : locale);
    await expect(page.getByTestId('home-page')).toBeVisible();
    await page.goto(`/${locale}/calculator/`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/calculator/russia/?$`));
    await expect(page.locator('.reset-button')).toBeEnabled();
    await expect(page.getByTestId('manufacture-range-total')).toBeVisible();
  }
});

test('home and calculator entries remain usable with JavaScript disabled', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/ru\/$/);
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.locator('#home-shortcuts a[href="/ru/calculator/russia/"]').click();
  await expect(page).toHaveURL(/\/ru\/calculator\/russia\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/zh/calculator/');
  const countryChoices = page.locator('main').getByRole('navigation');
  await expect(countryChoices.getByRole('link')).toHaveCount(7);
  const calculatorLink = countryChoices.getByRole('link', { name: '俄罗斯', exact: true });
  await expect(calculatorLink).toHaveAttribute('href', '/zh/calculator/russia/');
  await expect(countryChoices.getByRole('link', { name: '哈萨克斯坦', exact: true })).toHaveAttribute('href', '/zh/calculator/kazakhstan/');
  await calculatorLink.click();
  await expect(page).toHaveURL(/\/zh\/calculator\/russia\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.close();
});

test('unknown routes, removed server APIs and traversal attempts never receive a calculator fallback', async ({
  request,
}) => {
  for (const route of [
    '/missing-static-page/',
    '/zh/calculator/unknown-destination/',
    '/fr/calculator/russia/',
    '/api/health',
    '/api/v1/calculations',
  ]) {
    const response = await request.get(route);
    expect(response.status()).toBe(404);
    const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
    if (route.startsWith('/api/v1/')) {
      expect(response.headers()['content-type']).toContain('application/json');
      expect(JSON.parse(html).error.code).toBe('NOT_FOUND');
    } else expect(html).toContain('HD Auto Export / 404');
  }
  const post = await request.post('/api/v1/calculations', { data: {} });
  expect([404, 405]).toContain(post.status());
  for (const route of ['/..%2fAGENTS.md', '/brand/%2e%2e%2f..%2fAGENTS.md']) {
    const response = await request.get(route);
    expect([400, 403, 404]).toContain(response.status());
    expect(await response.text()).not.toContain('项目协作说明');
  }
});

test('invalid locale and unknown pages have a branded, usable 404 without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const path of [
      '/missing-static-page/',
      '/fr/calculator/russia/',
      '/zh/calculator/unknown-destination/',
    ]) {
      expect((await page.goto(path))?.status()).toBe(404);
      await expect(page.locator('main')).toContainText('HD Auto Export / 404');
      await expect(page.locator('main a').first()).toBeVisible();
    }
    await page.locator('main a').first().click();
    expect((await page.locator('main').textContent())?.length).toBeGreaterThan(10);
  } finally {
    await context.close();
  }
});

test('calculating and navigating use local assets without a calculation API or runtime FX service', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
  const requests: { url: string; method: string }[] = [];
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await page.locator('#displacementCc').fill('1700');
  await expect(page.getByTestId('manufacture-range-total')).toBeVisible();
  await page.locator('.country-nav a[href^="/zh/calculator/georgia"]').click();
  await expect(page).toHaveURL(/\/zh\/calculator\/georgia\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expect(page.getByTestId('manufacture-range-total')).toHaveText('480.00 – 480.00 GEL');
  await page.waitForLoadState('networkidle');
  const origin = new URL(page.url()).origin;
  expect(requests.filter(({ url, method }) => {
    const { origin: requestOrigin, pathname } = new URL(url);
    const analytics = requestOrigin === origin && pathname === '/api/v1/analytics/events' && method === 'POST';
    return pathname.startsWith('/api/') && !analytics;
  })).toEqual([]);
  expect(requests.filter(({ url }) => /open\.er-api\.com|exchangerate-api\.com/.test(url))).toEqual([]);
  expect(requests.filter(({ url }) => new URL(url).pathname.startsWith('/_next/image'))).toEqual([]);
});

test('browser initialization and reset use the Shanghai calendar date and ignore an obsolete stored date', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-12-10T20:30:00Z'));
  await page.addInitScript(() => {
    sessionStorage.setItem('hd-auto.calculator.draft.v2', JSON.stringify({
      input: { customsDate: '2025-09-30' },
    }));
  });
  const effectiveDate = () => page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hd-auto.calculator.draft.v2') ?? '{}').input?.customsDate);
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('[name^="customsDate"]')).toHaveCount(0);
  await expect.poll(effectiveDate).toBe('2026-12-11');
  await expect(page.getByTestId('manufacture-range-total')).toBeVisible();
  await page.reload();
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect.poll(effectiveDate).toBe('2026-12-11');
  await page.clock.setFixedTime(new Date('2026-12-20T20:30:00Z'));
  await page.locator('.reset-button').click();
  await expect.poll(effectiveDate).toBe('2026-12-21');
  await expect(page.getByTestId('manufacture-range-total')).toBeVisible();
});

test('a future browser year remains explicit instead of silently applying expired reference rules', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2027-01-01T04:00:00Z'));
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('[name^="customsDate"]')).toHaveCount(0);
  await expect(page.getByTestId('manufacture-range-total')).toHaveCount(0);
  await fillNumericDate(page, 'manufactureDate', '2021-01');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await expect(page.getByTestId('result-stamp')).toHaveAttribute('data-stamp-tone', 'muted');
  await expect(page.getByTestId('result-status')).toBeVisible();
});

test('FX labels identify a frozen build snapshot or reference fallback and manual overrides remain effective', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  const fx = page.getByTestId('fx-status');
  await expect(fx).toContainText(/构建时汇率快照|默认参考汇率/);
  await expect(fx).toContainText(/\d{4}-\d{2}-\d{2}/);
  await expect(fx).not.toContainText(/每小时|实时|自动更新/);
  await page.locator('#transactionRate').fill('100');
  await expect(fx).toContainText('使用你手动设置的参考汇率');
  await expect(page.locator('#transactionRate')).toHaveValue('100');
  await page.reload();
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#transactionRate')).toHaveValue('100.00');
  await expect(fx).toContainText('使用你手动设置的参考汇率');
});
