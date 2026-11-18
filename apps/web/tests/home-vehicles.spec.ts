import { expect, test } from '@playwright/test';
import { chooseCatalogBrand } from './helpers/catalog-brand';
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
    const heading = page.locator('main h1');
    await expect(heading).toHaveText(publicFixtureLabels.en.title);
    await expect(heading).toHaveAttribute('lang', 'en');
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
  await chooseCatalogBrand(form, 'alpha');
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

test('home keeps its section order and presents the editorial hero on desktop', async ({
  page,
  request,
}) => {
  await patchPublicFixture(request, { sectionCount: 2 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/');
  const hero = page.locator('[data-home-section="hero"]');
  await expect(hero.locator('canvas')).toHaveCount(0);
  const artwork = hero.locator('img[src^="/media/home/dawn-convoy.webp"]');
  await expect(artwork).toHaveAttribute('alt', '');
  await expect.poll(() => artwork.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  const header = await page.locator('.site-header').boundingBox();
  expect(header!.height).toBe(68);
  const bounds = await hero.boundingBox();
  expect(bounds!.y).toBe(0);
  expect(bounds!.height).toBeGreaterThan(700);
  const heading = await hero.locator('h1').boundingBox();
  expect(heading!.x).toBeLessThan(280);
  expect(heading!.y).toBeGreaterThan(header!.height);
  expect(heading!.y + heading!.height).toBeLessThan(bounds!.height);
  await expect(hero.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(hero.locator('a[href="/en/cars/"]')).toHaveCount(1);
  const shortcuts = hero.locator('#home-shortcuts');
  await expect(shortcuts.getByRole('link')).toHaveCount(3);
  for (const [href, background, icon] of [
    ['/en/cars/', 'rgba(182, 119, 73, 0.08)', 'rgb(182, 119, 73)'],
    ['/en/parts/', 'rgba(59, 130, 246, 0.08)', 'rgb(96, 165, 250)'],
    ['/en/calculator/russia/', 'rgba(34, 197, 94, 0.08)', 'rgb(74, 222, 128)'],
  ]) {
    const shortcut = shortcuts.locator(`a[href="${href}"]`);
    await expect(shortcut).toBeVisible();
    await expect(shortcut).toHaveCSS('background-color', background);
    await expect(shortcut.locator('strong')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(shortcut.locator('strong + span')).toHaveCSS('color', 'rgb(138, 138, 138)');
    await expect(shortcut.locator('svg').first()).toHaveCSS('color', icon);
  }
  await expect(page.locator('[data-home-section="calculator"]').getByRole('link', { name: 'Calculate cost' }))
    .toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('[data-home-section="cta"]').getByRole('link', { name: 'Contact us' }))
    .toHaveCSS('color', 'rgb(255, 255, 255)');
  const cue = hero.getByRole('link', { name: 'Scroll down', exact: true });
  await expect(cue).toHaveAttribute('href', '#home-vehicles');
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

test('HTTP vehicle rails support manual browsing, favorites and automatic movement', async ({
  page,
}) => {
  test.setTimeout(25_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/zh/');
  const featured = page.locator('[data-home-section^="vehicles-"]');
  const rail = featured.locator('[tabindex="0"]');
  await rail.scrollIntoViewIfNeeded();
  await featured.getByRole('button', { name: '配置精选 — 下一组车辆' }).click();
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft)).toBeGreaterThan(100);
  const save = featured.locator('article').nth(1).getByRole('button');
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await rail.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.locator('.site-header .brand').focus();
  const position = await rail.evaluate((n) => n.scrollLeft);
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft), { timeout: 9000 }).not.toBe(position);
  await page.goto('/zh/cars/fixture_demo/');
  await expect(page.locator('main')).not.toContainText('展示样例，非实际库存');
});

test('parts shortcut opens the catalog and mobile menu remains keyboard operable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh/');
  await page
    .locator('#home-shortcuts')
    .getByRole('link', { name: /汽车配件/ })
    .click();
  await expect(page).toHaveURL(/\/zh\/parts\/$/);
  await expect(page.locator('main h1')).toBeVisible();
  const menu = page.locator('.site-header [aria-controls="site-mobile-nav"]');
  await menu.click();
  await expect(page.locator('#site-mobile-nav')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.locator('#site-mobile-nav')).not.toBeVisible();
});

test('all locales fit the hero, three shortcuts and vehicle rails across viewport sizes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const viewports = [
    [320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [1280, 900], [1440, 900],
  ];
  for (const locale of ['zh', 'en', 'ru']) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const heading = await page.locator('main h1').boundingBox();
      expect(heading!.x).toBeGreaterThanOrEqual(0);
      expect(heading!.x + heading!.width).toBeLessThanOrEqual(width);
      const layout = await page.locator('[data-home-section="hero"]').evaluate((hero) => {
        const stats = hero.querySelector('[data-testid="hero-stats"]')!;
        const tiles = Array.from(hero.querySelectorAll('#home-shortcuts > a'), (link) =>
          link.getBoundingClientRect(),
        );
        const center = (rect: DOMRect) => rect.left + rect.width / 2;
        const values = Array.from(stats.querySelectorAll('dd'), (value) =>
          center(value.getBoundingClientRect()),
        );
        const dividers = Array.from(stats.children).slice(1).map((item) => {
          const rule = getComputedStyle(item, '::before');
          return item.getBoundingClientRect().left + parseFloat(rule.left) + parseFloat(rule.width) / 2;
        });
        return {
          tileTops: tiles.map((tile) => tile.top),
          tileCenters: tiles.map(center),
          statsBottom: stats.getBoundingClientRect().bottom,
          values,
          dividers,
        };
      });
      expect(new Set(layout.tileTops).size).toBe(1);
      expect(layout.tileTops[0]! - layout.statsBottom).toBeGreaterThanOrEqual(23.9);
      for (const [index, center] of layout.tileCenters.entries()) {
        expect(layout.values[index]).toBeCloseTo(center, 0);
        if (index > 0) {
          expect(layout.dividers[index - 1]).toBeCloseTo((layout.tileCenters[index - 1]! + center) / 2, 0);
        }
      }
      if (width <= 760) {
        const cue = (await page.locator('a[href="#home-vehicles"]').boundingBox())!;
        const vehicleTitle = (await page.locator('#home-vehicles h2').first().boundingBox())!;
        const gap = vehicleTitle.y - (cue.y + cue.height);
        expect(gap).toBeGreaterThanOrEqual(48);
        expect(gap).toBeLessThan(80);
      }
      const featured = page.locator('[data-home-section^="vehicles-"] article').first();
      const card = await featured.boundingBox();
      expect(card!.width).toBeGreaterThan(width < 640 ? width - 35 : 250);
      expect(card!.width).toBeLessThanOrEqual(width - 30);
    }
  }
});

test('mobile model pager and service questions remain usable at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/zh/');
  const models = page.locator('[data-home-section="popular-models"]');
  const next = models.getByRole('button', { name: '下一组车型', exact: true });
  const previous = models.getByRole('button', { name: '上一组车型', exact: true });
  const counter = models.getByTestId('home-model-count');
  await expect(counter).toHaveText('1 / 2');
  const previousBox = (await previous.boundingBox())!;
  const nextBox = (await next.boundingBox())!;
  expect(previousBox.width).toBeGreaterThanOrEqual(44);
  expect(nextBox.width).toBeGreaterThanOrEqual(44);
  expect(previousBox.y).toBeCloseTo(nextBox.y, 1);
  await next.click();
  await expect(counter).toHaveText('2 / 2');
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await previous.click();
  await expect(counter).toHaveText('1 / 2');
  const questions = page.locator('[data-home-section="reviews"]');
  await expect(questions).not.toContainText(/演示|虚构|样例|客户评价/);
  await questions.locator('button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/车型|选车|咨询/);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

for (const [locale, contactLabel] of [
  ['zh', '联系我们'],
  ['en', 'Contact us'],
  ['ru', 'Свяжитесь с нами'],
] as const) {
  for (const javaScriptEnabled of [true, false]) {
    test(`${locale}: home contact opens WhatsApp directly (JS ${javaScriptEnabled})`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ baseURL, javaScriptEnabled });
      const outbound: string[] = [];
      // Verify the destination without contacting the real chat service.
      await context.route('https://wa.me/**', (route) => {
        outbound.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<title>Intercepted contact</title>',
        });
      });
      try {
        const page = await context.newPage();
        const posts: string[] = [];
        page.on('request', (request) => {
          if (request.method() === 'POST') posts.push(request.url());
        });
        await page.goto(`/${locale}/`);
        const section = page.locator('[data-home-section="cta"]');
        await expect(section.locator('form, input, textarea')).toHaveCount(0);
        const link = section.getByRole('link', { name: contactLabel, exact: true });
        await expect(link).toHaveAttribute('href', 'https://wa.me/8618215932610');
        expect(outbound).toEqual([]);
        const popup = context.waitForEvent('page');
        await link.click();
        const contact = await popup;
        await contact.waitForLoadState('domcontentloaded');
        expect(outbound).toEqual(['https://wa.me/8618215932610']);
        expect(posts).toEqual([]);
        await expect(page).toHaveURL(new RegExp(`/${locale}/$`));
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
    await expect(page.locator('main h1')).toContainText('从中国出发');
    await page.getByRole('link', { name: '向下探索', exact: true }).click();
    await expect(page).toHaveURL(/#home-vehicles$/);
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
