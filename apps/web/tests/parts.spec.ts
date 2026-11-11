import { expect, test } from '@playwright/test';

const paginationNames = {
  zh: '配件目录分页',
  en: 'Parts catalog pagination',
  ru: 'Страницы каталога запчастей',
};

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: search and pagination reload the catalog and part drafts use the requested quantity`, async ({ page }) => {
    await page.goto(`/${locale}/parts/`);
    const records = page.locator('main [data-part]');
    await expect(records).toHaveCount(44);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('[data-counter-target="48689"] [data-counter-value]'))
      .toHaveText(new Intl.NumberFormat(locale).format(48_689));
    await expect(page.getByRole('link', { name: 'Genesis GV80 JX1 (2020–…)', exact: true }))
      .toHaveAttribute('href', '#parts-catalog');
    const pagination = page.getByRole('navigation', { name: paginationNames[locale] });
    const currentPage = pagination.locator('[aria-current="page"]');
    await expect(currentPage).toHaveText('1');
    await expect(pagination.locator('button[value="2029"]')).toBeEnabled();
    await page.goto(`/${locale}/parts/?category=chassis`);
    await expect(records).toHaveCount(16);
    const ids = () => records.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-part')));
    const search = page.locator('main form').first();
    await search.locator('[name="q"]').fill('52910K2200');
    const [navigation] = await Promise.all([
      page.waitForResponse((response) => response.request().resourceType() === 'document'),
      search.locator('[type="submit"]').click(),
    ]);
    expect(navigation.status()).toBe(200);
    expect(new URL(navigation.url()).searchParams.get('category')).toBe('chassis');
    expect(new URL(navigation.url()).searchParams.get('q')).toBe('52910K2200');
    await expect(page.locator('input[type=radio][name=category][value=chassis]')).toBeChecked();
    await expect(records).toHaveCount(1);
    expect(await ids()).toEqual(['52910k2200']);
    const [pageResponse] = await Promise.all([
      page.waitForResponse((response) => response.request().resourceType() === 'document'),
      pagination.getByText('2', { exact: true }).click(),
    ]);
    expect(pageResponse.status()).toBe(200);
    expect(pageResponse.request().method()).toBe('GET');
    const pageParams = new URL(pageResponse.url()).searchParams;
    expect(pageParams.get('page')).toBe('2');
    expect(pageParams.get('category')).toBe('chassis');
    expect(pageParams.get('q')).toBe('52910K2200');
    await expect(currentPage).toHaveText('2');
    expect(await ids()).toEqual(['52910k2200']);
    await page.goBack();
    await expect(currentPage).toHaveText('1');
    await expect(search.locator('[name="q"]')).toHaveValue('52910K2200');
    await page.goForward();
    await expect(currentPage).toHaveText('2');
    await expect(search.locator('[name="q"]')).toHaveValue('52910K2200');
    await expect(page.locator('input[type=radio][name=category][value=chassis]')).toBeChecked();
    await expect(page.locator('main')).not.toContainText(/演示|示例|例子|\bdemo\b|\bsample\b|демо|пример/i);
    for (const input of await page.locator('main input[name="q"]').all()) {
      await expect(input).not.toHaveAttribute('placeholder', /例如|示例|e\.g\.|например/i);
    }
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
    await page.goto('/ru/parts/?category=chassis');
    const pagination = page.getByRole('navigation', { name: paginationNames.ru });
    const catalogSearch = page.locator('main input[name="q"][form="parts-filters"]');
    await catalogSearch.fill('52910K2200');
    await pagination.getByRole('button', { name: 'Страница 2029', exact: true }).click();
    await expect(pagination.locator('[aria-current="page"]')).toHaveText('2029');
    const pagedUrl = new URL(page.url());
    expect(pagedUrl.searchParams.get('page')).toBe('2029');
    expect(pagedUrl.searchParams.get('q')).toBe('52910K2200');
    await expect(catalogSearch).toHaveValue('52910K2200');
    await expect(pagination.getByRole('button', { name: 'Следующая страница', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const search = page.locator('main form').first();
    await search.locator('[name="q"]').fill('52910K2200');
    await search.locator('[type="submit"]').click();
    await expect(page).toHaveURL(/q=52910K2200/);
    await expect(pagination.locator('[aria-current="page"]')).toHaveText('1');
    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    await expect(page.locator('input[type=radio][name=category][value=chassis]')).toBeChecked();
    await expect(page.locator('main [data-part]')).toHaveCount(1);
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

test('the catalog search reloads, header navigation clears it, and Back restores it', async ({ page }) => {
  await page.goto('/en/parts/');
  const search = page.locator('main form').first();
  const catalogSearch = page.locator('main input[name="q"][form="parts-filters"]');
  await catalogSearch.fill('52910K2200');
  const [navigation] = await Promise.all([
    page.waitForResponse((response) => response.request().resourceType() === 'document'),
    catalogSearch.locator('..').getByRole('button').click(),
  ]);
  expect(navigation.status()).toBe(200);
  await expect(page).toHaveURL(/q=52910K2200/);
  await expect(page.locator('main [data-part]')).toHaveCount(1);
  await page.locator('header a[href="/en/parts/"]').first().click();
  await expect(page).toHaveURL(/\/en\/parts\/$/);
  await expect(page.locator('main [data-part]')).toHaveCount(44);
  await expect(page.locator('main form').first().locator('[name="q"]')).toHaveValue('');
  await search.locator('[name="q"]').fill('52910K2200'); await search.locator('[type="submit"]').click();
  await expect(page.locator('main [data-part]')).toHaveCount(1);
  await page.locator('main [data-part="52910k2200"] h3 a').click(); await expect(page.getByTestId('part-detail')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/q=52910K2200/);
  await expect(page.locator('main [data-part]')).toHaveCount(1);
  await expect(search.locator('[name="q"]')).toHaveValue('52910K2200');
});

test('part favorites persist separately and synchronize catalog, details and saved selection', async ({ page }) => {
  await page.goto('/en/parts/');
  const rows = page.locator('main [data-part]');
  const savedFilter = page.getByTestId('saved-parts-filter');
  await expect(savedFilter).toBeEnabled();
  await expect(rows).toHaveCount(44);
  await page.locator('main select[name="sort"]').selectOption('price-asc');
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect(page.locator('main select[name="sort"]')).toHaveValue('price-asc');
  await expect(savedFilter).toBeEnabled();
  await expect(rows).toHaveCount(44);
  const prices = (await rows.locator('strong').allTextContents()).map((text) => Number(text.replace(/[$,]/g, '')));
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
  await page.goto('/en/parts/?q=52910K2200&page=2');
  const card = page.locator('[data-part="52910k2200"]');
  await card.hover(); await card.getByRole('button', { name: 'Save part', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Unsave part', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hd-auto:part-favorites:v1')!));
  expect(stored).toEqual({ version: 1, ids: ['52910k2200'] });
  await page.reload();
  await savedFilter.click();
  await expect(page.locator('main [data-part]')).toHaveCount(1);
  await expect(page.getByText('Showing 1 part record', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: paginationNames.en })).toHaveCount(0);
  await page.locator('main h3 a').click();
  const detailSave = page.locator('main > div > div > aside').getByRole('button', { name: 'Unsave part', exact: true });
  await expect(detailSave).toHaveAttribute('aria-pressed', 'true'); await detailSave.click();
  await page.goto('/en/parts/'); await savedFilter.click();
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
