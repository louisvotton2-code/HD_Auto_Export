import { expect, test } from '@playwright/test';

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: home, demo catalog and vehicle detail are linked and localized`, async ({
    page,
    request,
  }) => {
    const route = `/${locale}/`;
    const html = await request.get(route);
    expect(html.status()).toBe(200);
    expect(await html.text()).toContain('data-testid="home-page"');
    await page.goto(route);
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/$`),
    );
    await page.locator('main').locator(`a[href="/${locale}/cars/"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/cars/$`));
    await expect(page.locator('main h1')).toBeVisible();
    const vehicle = page.locator(`main a[href="/${locale}/cars/byd-seagull/"]`).first();
    await expect(vehicle).toBeVisible();
    await vehicle.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/cars/byd-seagull/$`));
    await expect(page.locator('main h1')).toHaveText('Seagull');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
}

test('demo filters, empty state and reset operate on the sample vehicles', async ({ page }) => {
  await page.goto('/zh/cars/');
  const initialCount = await page.locator('main article').count();
  expect(initialCount).toBeGreaterThan(0);
  await page.getByRole('searchbox', { name: '搜索品牌或车型' }).fill('K3 (Forte)');
  await expect(page.locator('main article')).toHaveCount(1);
  await expect(page.locator('main article')).toContainText('K3');
  await page.getByLabel('动力类型').selectOption('electric');
  await expect(page.locator('main article')).toHaveCount(0);
  await expect(page.getByText('没有找到符合条件的示例车辆，请试试其他筛选条件。')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('main article')).toHaveCount(initialCount);
});

test('home follows the reference section order and measured desktop hero geometry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/');
  const hero = page.locator('[data-home-section="hero"]');
  await expect(hero.locator('canvas')).toBeVisible();
  await expect(hero.locator('img')).toHaveCount(0);
  const header = await page.locator('.site-header').boundingBox();
  expect(header!.height).toBe(68);
  const bounds = await hero.boundingBox();
  expect(bounds!.y).toBe(0);
  expect(bounds!.height).toBeCloseTo(828, 0);
  const heading = await hero.locator('h1').boundingBox();
  expect(Math.abs(heading!.x + heading!.width / 2 - 720)).toBeLessThan(1);
  await expect(hero.locator('h1')).toHaveCSS('font-size', '72px');
  const details = page
    .locator('[data-home-section="vehicles-kia"] article')
    .first()
    .getByRole('link', { name: 'Details' });
  await expect(details).toHaveCSS('border-radius', '12px');
  await expect(details).toHaveCSS('color', 'rgb(245, 240, 235)');
  expect(await details.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain(
    'linear-gradient',
  );
  await expect(
    page.locator('[data-home-section="vehicles-kia"] article strong').first(),
  ).toContainText('USD');
  const order = await page
    .locator('[data-home-section]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-home-section')));
  expect(order).toEqual([
    'hero',
    'shortcuts',
    'vehicles-kia',
    'vehicles-hyundai',
    'popular-models',
    'why',
    'buying-process',
    'reviews',
    'calculator',
    'cta',
  ]);
});

test('sample rails support manual browsing, favorites, pause and automatic movement', async ({
  page,
}) => {
  test.setTimeout(25_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/zh/');
  const home = page.getByTestId('home-page');
  await page.getByRole('button', { name: '暂停自动播放', exact: true }).click();
  await expect(home).toHaveAttribute('data-motion-paused', 'true');
  const kia = page.locator('[data-home-section="vehicles-kia"]');
  const rail = kia.locator('[tabindex="0"]');
  await rail.scrollIntoViewIfNeeded();
  await kia.getByRole('button', { name: 'Kia — 下一组车辆' }).click();
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft)).toBeGreaterThan(100);
  const save = kia.locator('article').nth(1).getByRole('button');
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '恢复自动播放', exact: true }).click();
  await rail.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.locator('.site-header .brand').focus();
  const position = await rail.evaluate((n) => n.scrollLeft);
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft), { timeout: 9000 }).not.toBe(position);
  await page.goto('/zh/cars/kia-k3-2015/');
  await expect(page.getByText('演示车辆 · 韩国参考站样例')).toBeVisible();
});

test('parts placeholder and mobile menu are explicit and keyboard operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh/');
  await page
    .locator('#home-shortcuts')
    .getByRole('button', { name: /汽车配件/ })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const menu = page.locator('.site-header [aria-controls="site-mobile-nav"]');
  await menu.click();
  await expect(page.locator('#site-mobile-nav')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.locator('#site-mobile-nav')).not.toBeVisible();
});

test('all locales preserve centered hero, three shortcuts and usable rails across viewport sizes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const locale of ['zh', 'en', 'ru']) {
    for (const width of [320, 360, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const heading = await page.locator('main h1').boundingBox();
      expect(heading!.x).toBeGreaterThanOrEqual(0);
      expect(heading!.x + heading!.width).toBeLessThanOrEqual(width);
      const shortcuts = await page
        .locator('#home-shortcuts')
        .evaluate((n) => Array.from(n.children).map((c) => c.getBoundingClientRect().y));
      expect(new Set(shortcuts).size).toBe(1);
      const kia = page.locator('[data-home-section="vehicles-kia"] article').first();
      const card = await kia.boundingBox();
      expect(card!.width).toBeGreaterThan(width < 640 ? width - 35 : 250);
      expect(card!.width).toBeLessThanOrEqual(width - 30);
    }
  }
});

test('model controls, demo conversation dialog and local enquiry work without sending data', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/zh/');
  const models = page.locator('[data-home-section="popular-models"]');
  await models.getByRole('button', { name: '查看车型 2', exact: true }).click();
  await expect(models.getByRole('button', { name: '查看车型 2', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  const reviews = page.locator('[data-home-section="reviews"]');
  await expect(reviews).toContainText('不是真实客户评价');
  await reviews.getByRole('button', { name: '放大查看: 选车咨询 · 演示', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('虚构对话');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  const enquiries = page.locator('[data-home-section="cta"]');
  await enquiries.getByRole('textbox').fill('+86 18215932610');
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') requests.push(r.url());
  });
  await enquiries.getByRole('button', { name: /发送/ }).click();
  await expect(enquiries.getByRole('status')).toBeVisible();
  await expect(enquiries.getByRole('status')).toContainText('未');
  expect(requests).toEqual([]);
});

test('mobile home navigation and language menu remain usable without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/zh/');
    await expect(page.locator('main h1')).toContainText('梦想座驾');
    await page.locator('.language-switch summary').click();
    await page.locator('.language-switch a[lang="en"]').click();
    await expect(page).toHaveURL(/\/en\/$/);
    await page.locator('[aria-controls="site-mobile-nav"]').click();
    await page.locator('#site-mobile-nav a[href="/en/cars/"]').click();
    await expect(page).toHaveURL(/\/en\/cars\/$/);
    await expect(page.locator('main article').first()).toBeVisible();
  } finally {
    await context.close();
  }
});
