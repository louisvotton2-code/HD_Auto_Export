import { expect, test, type Page, type Request } from '@playwright/test';
import {
  resetPublicFixture,
  patchPublicFixture,
  publicFixtureLabels,
} from './helpers/public-fixture';

test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

const demoPhone = '15550007654';

function trackRequests(page: Page) {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  return requests;
}

function expectNoPhoneTransmission(requests: Request[], phone: string) {
  const transmissions = requests
    .map((request) => ({
      method: request.method(),
      url: request.url(),
      body: request.postData(),
      headers: request.headers(),
    }))
    .filter((request) => JSON.stringify(request).includes(phone));
  expect(
    transmissions,
    'the entered phone must not appear in a website request before contact draft navigation',
  ).toEqual([]);
}

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: home, HTTP catalog and public vehicle details are linked and localized`, async ({
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
    const vehicle = page.locator(`main a[href="/${locale}/cars/fixture_demo/"]`).first();
    await expect(vehicle).toBeVisible();
    await vehicle.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/cars/fixture_demo/$`));
    await expect(page.locator('main h1')).toHaveText(publicFixtureLabels[locale].title);
    await expect(page.locator('main')).not.toContainText(publicFixtureLabels[locale].demo);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
}

test('HTTP-supported filters, empty state and reset operate on published vehicle information', async ({
  page,
}) => {
  await page.goto('/zh/cars/');
  const initialCount = await page.locator('main article').count();
  expect(initialCount).toBeGreaterThan(0);
  const form = page.locator('main form');
  await form.locator('select[name="make"]').selectOption('alpha');
  await form.locator('select[name="model"]').selectOption('alpha_model');
  await form.locator('select[name="powertrain"]').selectOption('petrol');
  await form.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByTestId('public-catalog-empty')).toBeVisible();
  await expect(page.locator('main article')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('make')).toBe('alpha');
  await form.getByRole('link', { name: '清除筛选' }).click();
  await expect(page.locator('main article')).toHaveCount(initialCount);
  await expect(form.locator('select[name="make"]')).toHaveValue('');
});

test('home follows the reference section order and measured desktop hero geometry', async ({
  page,
  request,
}) => {
  await patchPublicFixture(request, { sectionCount: 2 });
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
    .locator('[data-home-section^="vehicles-"] article')
    .first()
    .getByRole('link', { name: 'Details' });
  await expect(details).toHaveCSS('border-radius', '12px');
  await expect(details).toHaveCSS('color', 'rgb(245, 240, 235)');
  expect(await details.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain(
    'linear-gradient',
  );
  await expect(
    page.locator('[data-home-section^="vehicles-"] article').nth(1).locator('strong').last(),
  ).toContainText('USD');
  const order = await page
    .locator('[data-home-section]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-home-section')));
  expect(order).toEqual([
    'hero',
    'shortcuts',
    'vehicles-featured',
    'vehicles-recent',
    'popular-models',
    'why',
    'buying-process',
    'reviews',
    'calculator',
    'cta',
  ]);
});

test('HTTP vehicle rails support manual browsing, favorites, pause and automatic movement', async ({
  page,
}) => {
  test.setTimeout(25_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/zh/');
  const home = page.getByTestId('home-page');
  await page.getByRole('button', { name: '暂停自动播放', exact: true }).click();
  await expect(home).toHaveAttribute('data-motion-paused', 'true');
  const featured = page.locator('[data-home-section^="vehicles-"]');
  const rail = featured.locator('[tabindex="0"]');
  await rail.scrollIntoViewIfNeeded();
  await featured.getByRole('button', { name: '配置精选 — 下一组车辆' }).click();
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft)).toBeGreaterThan(100);
  const save = featured.locator('article').nth(1).getByRole('button');
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '恢复自动播放', exact: true }).click();
  await rail.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.locator('.site-header .brand').focus();
  const position = await rail.evaluate((n) => n.scrollLeft);
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft), { timeout: 9000 }).not.toBe(position);
  await page.goto('/zh/cars/fixture_demo/');
  await expect(page.locator('main')).not.toContainText('展示样例，非实际库存');
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
      const featured = page.locator('[data-home-section^="vehicles-"] article').first();
      const card = await featured.boundingBox();
      expect(card!.width).toBeGreaterThan(width < 640 ? width - 35 : 250);
      expect(card!.width).toBeLessThanOrEqual(width - 30);
    }
  }
});

test('model controls and service questions use the reference interactions without presentation-only notices', async ({
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
  const questions = page.locator('[data-home-section="reviews"]');
  await expect(questions).not.toContainText(/演示|虚构|样例|客户评价/);
  await questions.locator('button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/车型|选车|咨询/);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

for (const locale of ['zh', 'en', 'ru'] as const) {
  for (const javaScriptEnabled of [true, false]) {
    test(`${locale}: inquiry opens a WhatsApp draft only after explicit submission (JS ${javaScriptEnabled})`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ baseURL, javaScriptEnabled });
      const outbound: string[] = [];
      // Inspect the draft navigation without contacting a real chat service.
      await context.route('https://wa.me/**', (route) => {
        outbound.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<title>Intercepted contact draft</title>',
        });
      });
      try {
        const page = await context.newPage();
        const requests = trackRequests(page);
        await page.goto(`/${locale}/`);
        const form = page.locator('[data-home-section="cta"] form');
        await form.getByRole('textbox').fill(demoPhone);
        expect(outbound).toEqual([]);
        const popup = context.waitForEvent('page');
        await form.getByRole('button').click();
        const contact = await popup;
        await contact.waitForLoadState('domcontentloaded');
        expect(outbound).toHaveLength(1);
        const url = new URL(outbound[0]!);
        expect(url.origin + url.pathname).toBe('https://wa.me/8618215932610');
        expect([...url.searchParams.keys()]).toEqual(['text']);
        const text = url.searchParams.get('text')!;
        if (javaScriptEnabled) expect(text).toContain(demoPhone);
        else expect(text).not.toContain(demoPhone);
        expect(text).not.toMatch(/演示|demo|fictional|демонстрац/i);
        expectNoPhoneTransmission(requests, demoPhone);
        expect(requests.filter((request) => request.method() === 'POST')).toEqual([]);
        await expect(page).toHaveURL(new RegExp(`/${locale}/$`));
        await expect(page.locator('[data-home-section="cta"] [role="status"]')).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
}

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
