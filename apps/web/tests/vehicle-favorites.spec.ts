import { expect, test } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

const storageKey = 'hd-auto:vehicle-favorites:v1';
test.describe('persistent vehicle identities and aligned cards', () => {
  test.skip(
    !process.env.PUBLIC_FIXTURE_API_URL,
    'Requires the isolated fixture API, never live inventory.',
  );
  test.beforeEach(async ({ request }) => {
    await resetPublicFixture(request);
  });
  test.afterEach(async ({ request }) => {
    await resetPublicFixture(request);
  });

  test('a saved API identity survives refresh and locale routes, and synchronizes across tabs', async ({
    page,
    context,
  }) => {
    await page.goto('/en/');
    const first = page.locator('main [data-vehicle-favorite]').first();
    const id = (await first.getAttribute('data-vehicle-favorite'))!;
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
    expect(stored).toEqual({ version: 1, ids: [id] });
    await page.reload();
    await expect(page.locator(`main [data-vehicle-favorite="${id}"]`).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const other = await context.newPage();
    await other.goto(`/ru/cars/${id}/`);
    const detailHeart = other.locator(`main [data-vehicle-favorite="${id}"]`);
    await expect(detailHeart).toHaveAttribute('aria-pressed', 'true');
    await detailHeart.click();
    await expect(detailHeart).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(`main [data-vehicle-favorite="${id}"]`).first()).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.goto('/zh/cars/');
    const catalogHeart = page.locator(`main [data-vehicle-favorite="${id}"]`);
    await catalogHeart.click();
    await expect(detailHeart).toHaveAttribute('aria-pressed', 'true');
    await other.evaluate((key) => localStorage.removeItem(key), storageKey);
    await expect(catalogHeart).toHaveAttribute('aria-pressed', 'false');
    await other.close();
  });

  test('preloaded favorites hydrate without mismatches and broken JSON remains usable', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
      key: storageKey,
      raw: JSON.stringify({ version: 1, ids: ['fixture_car_2'] }),
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat|server.render|did not match/i.test(message.text()))
        errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/ru/cars/fixture_car_2/');
    await expect(page.locator('main [data-vehicle-favorite="fixture_car_2"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(errors).toEqual([]);
    await context.close();

    const broken = await browser.newContext({ baseURL });
    await broken.addInitScript((key) => localStorage.setItem(key, '{broken'), storageKey);
    const brokenPage = await broken.newPage();
    await brokenPage.goto('/en/cars/fixture_car_2/');
    const button = brokenPage.locator('main [data-vehicle-favorite="fixture_car_2"]');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(
      await brokenPage.evaluate((key) => JSON.parse(localStorage.getItem(key)!).ids, storageKey),
    ).toEqual(['fixture_car_2']);
    await broken.close();
  });

  test('disabled storage keeps multiple local selections instead of throwing or dropping the first', async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (name) {
        if (name === key) throw new DOMException('Storage disabled', 'SecurityError');
        return get.call(this, name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Storage disabled', 'SecurityError');
        return set.call(this, name, value);
      };
    }, storageKey);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/en/');
    const buttons = page.locator('main [data-vehicle-favorite]');
    await buttons.nth(0).click();
    await buttons.nth(1).click();
    await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await buttons.nth(0).click();
    await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });

  test('long Russian titles, missing state and long prices keep the rail footers aligned at desktop and phone widths', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const title =
      'Очень длинное название автомобиля с подробным описанием комплектации и оборудования';
    await page.route(
      (url) => url.pathname.replace(/\/$/, '') === '/api/v1/home/vehicles',
      async (route) => {
        const response = await route.fetch(),
          body = await response.json();
        const cars = body.data.sections[0].vehicles.filter(
          (vehicle: { source: { kind: string } }) => vehicle.source.kind === 'manual',
        );
        expect(cars.length).toBeGreaterThanOrEqual(2);
        body.data.sections[0].vehicles = cars;
        cars[0].content.title.text = title;
        cars[0].availability = 'sold';
        cars[0].price = {
          kind: 'reference',
          money: { amount: '99999999999999.99', currency: 'KGS' },
          includes: [],
        };
        cars[1].availability = 'unknown';
        cars[1].availabilityCheckedAt = null;
        await route.fulfill({ response, json: body });
      },
    );
    await page.goto('/ru/');
    await expect(page.getByTestId('hero-ripple-canvas')).toHaveAttribute('width', /^[1-9]\d*$/);
    // A real client navigation lets the public-resource lifecycle mount before
    // Back triggers its explicit recheck. A synthetic hash jump could run first.
    await page
      .locator('[data-home-section^="vehicles-"] [data-vehicle-contacts] a[href*="/cars/"]')
      .first()
      .click();
    await expect(page.locator('main[data-public-vehicle-detail]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/ru\/$/);
    const rail = page.locator('[data-home-section^="vehicles-"]').first();
    await expect(rail.locator('h3').first()).toHaveText(title);
    await expect(rail.locator('h3').first()).toHaveAttribute('title', title);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await rail.locator('article').evaluateAll((cards) =>
        cards.map((card) => {
          const footer = card.querySelector('[data-vehicle-contacts]')!,
            details = footer.querySelector('a:last-child')!;
          return {
            y: footer.getBoundingClientRect().y,
            height: card.getBoundingClientRect().height,
            fits: details.scrollWidth <= details.clientWidth,
            label: details.textContent?.trim(),
          };
        }),
      );
      expect(
        Math.max(...geometry.map((item) => item.y)) - Math.min(...geometry.map((item) => item.y)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...geometry.map((item) => item.height)) -
          Math.min(...geometry.map((item) => item.height)),
      ).toBeLessThanOrEqual(1);
      expect(geometry.every((item) => item.fits && item.label)).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
    }
  });
});
