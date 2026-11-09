import { expect, test } from '@playwright/test';

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: demo results stay fixed while existing part drafts use the requested quantity`, async ({ page }) => {
    await page.goto(`/${locale}/parts/`);
    await expect(page.locator('main [data-part]')).toHaveCount(24);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const records = page.locator('main [data-part]');
    const ids = () => records.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-part')));
    const initial = await ids();
    const mock = page.locator('main [data-part^="DEMO-"]');
    await expect(mock).toHaveCount(12);
    await expect(mock.locator('img, a')).toHaveCount(0);
    const pagination = page.locator('main nav').filter({ has: page.locator('[aria-current="page"]') });
    await pagination.getByRole('button').last().click();
    await expect(pagination.locator('[aria-current="page"]')).toHaveText('2');
    expect(await ids()).toEqual(initial);
    const search = page.locator('main form').first();
    await search.locator('[name="q"]').fill('52910K2200');
    await search.locator('[type="submit"]').click();
    await expect(page).toHaveURL(/q=52910K2200/);
    expect(await ids()).toEqual(initial);
    await page.locator('main [data-part="52910k2200"] h3 a').click();
    await expect(page.getByTestId('part-detail')).toHaveAttribute('data-part-detail', '52910k2200');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('main h1')).not.toBeEmpty();
    await page.locator('input[name="quantity"]').fill('3');
    await page.locator('main form [type="submit"]').click();
    const heading = await page.locator('main h1').textContent();
    const links = page.locator('[data-part-contacts="52910k2200"] a[href]');
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      const url = new URL((await link.getAttribute('href'))!);
      expect(['https://t.me/HD_Auto_CN', 'https://wa.me/8618215932610']).toContain(url.origin + url.pathname);
      const draft = url.searchParams.get('text')!;
      expect(draft).toContain('52910K2200'); expect(draft).toContain(heading!);
      expect(draft).toMatch({ zh: /咨询数量: 3/, en: /Enquiry quantity: 3/, ru: /Количество для запроса: 3/ }[locale]);
      expect(draft).toContain(`/${locale}/parts/52910k2200/`);
    }
    await page.locator('[data-part-gallery] > a').click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  });
}

test('Russian 320px without JavaScript retains search, quantity update, images and native contact drafts', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('/ru/parts/?q=52910K2200');
    await expect(page.locator('main [data-part]')).toHaveCount(24);
    await page.locator('main [data-part="52910k2200"] h3 a').click();
    await page.locator('input[name="quantity"]').fill('2');
    await page.locator('main form [type="submit"]').click();
    await expect(page).toHaveURL(/quantity=2/);
    const href = await page.locator('[data-part-contacts] a').first().getAttribute('href');
    expect(new URL(href!).searchParams.get('text')).toContain('Количество для запроса: 2');
    await expect(page.locator('[data-part-gallery] > a')).toHaveAttribute('href', /\/parts\/.+\.jpg$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});

test('unknown part identifiers return a real 404 rather than another product', async ({ request }) => {
  expect((await request.get('/en/parts/not-a-part/')).status()).toBe(404);
});

test('header parts navigation clears a local filter even when Next reuses the catalog', async ({ page }) => {
  await page.goto('/en/parts/');
  const localRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url()), headers = request.headers();
    const queryRsc = headers.rsc === '1' && url.pathname === '/en/parts/' && url.searchParams.get('q') === '52910K2200';
    if (request.resourceType() === 'document' || queryRsc || url.pathname.startsWith('/api/')) localRequests.push(request.url());
  });
  const search = page.locator('main form').first();
  await search.locator('[name="q"]').fill('52910K2200'); await search.locator('[type="submit"]').click();
  await expect(page.locator('main [data-part]')).toHaveCount(24);
  await expect(page).toHaveURL(/q=52910K2200/);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(localRequests).toEqual([]);
  await page.locator('header a[href="/en/parts/"]').first().click();
  await expect(page).toHaveURL(/\/en\/parts\/$/);
  await expect(page.locator('main [data-part]')).toHaveCount(24);
  await expect(page.locator('main form').first().locator('[name="q"]')).toHaveValue('');
  await search.locator('[name="q"]').fill('52910K2200'); await search.locator('[type="submit"]').click();
  await expect(page.locator('main [data-part]')).toHaveCount(24);
  await page.locator('main [data-part="52910k2200"] h3 a').click(); await expect(page.getByTestId('part-detail')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/q=52910K2200/);
  await expect(page.locator('main [data-part]')).toHaveCount(24);
  await expect(search.locator('[name="q"]')).toHaveValue('52910K2200');
});

test('part favorites persist separately and synchronize catalog, details and saved selection', async ({ page }) => {
  await page.goto('/en/parts/');
  const rows = page.locator('main [data-part]');
  const before = await rows.allTextContents();
  await page.locator('main select[name="sort"]').selectOption('price-asc');
  await expect(page).toHaveURL(/sort=price-asc/);
  expect(await rows.allTextContents()).toEqual(before);
  await page.goto('/en/parts/?q=52910K2200');
  const card = page.locator('[data-part="52910k2200"]');
  await card.hover(); await card.getByRole('button', { name: 'Save part', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Unsave part', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hd-auto:part-favorites:v1')!));
  expect(stored).toEqual({ version: 1, ids: ['52910k2200'] });
  await page.reload();
  await page.getByTestId('saved-parts-filter').click();
  await expect(page.locator('main [data-part]')).toHaveCount(1);
  await page.locator('main h3 a').click();
  const detailSave = page.locator('main > div > div > aside').getByRole('button', { name: 'Unsave part', exact: true });
  await expect(detailSave).toHaveAttribute('aria-pressed', 'true'); await detailSave.click();
  await page.goto('/en/parts/'); await page.getByTestId('saved-parts-filter').click();
  await expect(page.locator('main [data-part]')).toHaveCount(0);
});

test('parts remain readable with corrupt preferences and storage denial falls back to memory', async ({ browser, baseURL }) => {
  for (const denied of [false, true]) {
    const context = await browser.newContext({ baseURL });
    try {
      await context.addInitScript((deny) => {
        if (deny) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Disabled', 'SecurityError'); } });
        else localStorage.setItem('hd-auto:part-favorites:v1', '{bad');
      }, denied);
      const page = await context.newPage(); await page.goto('/en/parts/?q=52910K2200');
      const card = page.locator('[data-part="52910k2200"]'); await expect(card).toBeVisible();
      await card.hover(); await card.getByRole('button', { name: 'Save part', exact: true }).click();
      await page.getByTestId('saved-parts-filter').click();
      await expect(page.locator('main [data-part]')).toHaveCount(1);
    } finally { await context.close(); }
  }
});
