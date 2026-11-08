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
      await expect(page.getByTestId('total')).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/calculator/${destination}/?$`),
      );
      const refreshed = await page.reload();
      expect(refreshed?.status()).toBe(200);
      await expect(page.locator('.reset-button')).toBeEnabled();
      await expect(page.getByTestId('total')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test('root defaults to Russian home and calculator shortcuts still reach their destinations', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/ru\/$/);
  await expect(page.getByTestId('home-page')).toBeVisible();
  for (const locale of ['zh', 'en', 'ru']) {
    await page.goto(`/${locale}/`);
    await expect(page.getByTestId('home-page')).toBeVisible();
    await page.goto(`/${locale}/calculator/`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/calculator/russia/?$`));
    await expect(page.locator('.reset-button')).toBeEnabled();
    await expect(page.getByTestId('total')).toBeVisible();
  }
});

test('home and calculator entries remain usable with JavaScript disabled', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/');
  const homeLink = page.getByRole('link', { name: 'На главную', exact: true });
  await expect(homeLink).toHaveAttribute('href', '/ru/');
  await homeLink.click();
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.goto('/zh/calculator/');
  const calculatorLink = page.getByRole('link', { name: '前往计算器', exact: true });
  await expect(calculatorLink).toHaveAttribute('href', '/zh/calculator/russia/');
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

test('calculating and navigating use local assets without calling an API or runtime FX service', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await page.locator('#displacementCc').fill('1700');
  await expect(page.getByTestId('total')).toBeVisible();
  await page.locator('.country-nav a[href^="/zh/calculator/georgia"]').click();
  await expect(page).toHaveURL(/\/zh\/calculator\/georgia\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await page.getByRole('button', { name: '纯电 BEV', exact: true }).click();
  await expect(page.getByTestId('total')).toContainText('480');
  await page.waitForLoadState('networkidle');
  expect(requests.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([]);
  expect(requests.filter((url) => /open\.er-api\.com|exchangerate-api\.com/.test(url))).toEqual([]);
  expect(requests.filter((url) => new URL(url).pathname.startsWith('/_next/image'))).toEqual([]);
});

test('browser initialization and reset use the Shanghai calendar date after the build day while preserving a chosen draft date', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-12-10T20:30:00Z'));
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#customsDate')).toHaveValue('2026-12-11');
  await expect(page.getByTestId('total')).toBeVisible();
  await page.locator('#customsDate').fill('2026-09-30');
  await page.reload();
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#customsDate')).toHaveValue('2026-09-30');
  await page.clock.setFixedTime(new Date('2026-12-20T20:30:00Z'));
  await page.locator('.reset-button').click();
  await expect(page.locator('#customsDate')).toHaveValue('2026-12-21');
  await expect(page.getByTestId('total')).toBeVisible();
});

test('a future browser year remains explicit instead of silently applying expired reference rules', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2027-01-01T04:00:00Z'));
  await page.goto('/zh/calculator/russia/');
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#customsDate')).toHaveValue('2027-01-01');
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
  await expect(page.locator('#transactionRate')).toHaveValue('100');
  await expect(fx).toContainText('使用你手动设置的参考汇率');
});
