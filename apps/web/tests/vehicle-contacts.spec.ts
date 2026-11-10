import { expect, test, type Locator } from '@playwright/test';
import { resetPublicFixture, publicFixtureLabels } from './helpers/public-fixture';

test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

type Locale = keyof typeof publicFixtureLabels;
async function expectVehicleContacts(contacts: Locator, id: string, locale: Locale, demo = true) {
  const telegram = contacts.locator('a[href^="https://t.me/"]');
  const whatsapp = contacts.locator('a[href^="https://wa.me/"]');
  const stockCode = demo ? 'SHOW-ALPHA' : `HD-${id}`;
  const title = demo
    ? publicFixtureLabels[locale].title
    : `${publicFixtureLabels[locale].manual} ${id}`;
  const drafts: string[] = [];
  for (const link of [telegram, whatsapp]) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAccessibleName(/Telegram|WhatsApp/);
    const href = new URL((await link.getAttribute('href'))!);
    const text = href.searchParams.get('text')!;
    expect(text).toContain(id);
    expect(text).toContain(stockCode);
    expect(text).toContain(title);
    expect(text).toContain(`/${locale}/cars/${id}/`);
    expect(text).not.toMatch(/(?:里程|Mileage|Пробег):\s*0\s*(?:km|公里|км)/i);
    expect(text).not.toMatch(/\b0(?:\.00)?\s*USD\b/);
    if (demo) {
      expect(text).not.toContain(publicFixtureLabels[locale].demo);
      expect(text).toContain(
        { zh: '待询价', en: 'Price on request', ru: 'Цена по запросу' }[locale],
      );
      // The fixture has unknown year, manufacture date and mileage. Old defaults must not leak.
      expect(text).not.toMatch(/(?:年款|Model year|Модельный год):/);
      expect(text).not.toMatch(/(?:制造时间|Manufactured|Дата выпуска):/);
    } else {
      expect(text).toContain('2024');
      expect(text).toContain('23500 USD');
      expect(text).not.toContain(publicFixtureLabels[locale].demo);
    }
    drafts.push(text);
  }
  expect(drafts[0]).toBe(drafts[1]);
  expect(new URL((await telegram.getAttribute('href'))!).pathname).toBe('/HD_Auto_CN');
  expect(new URL((await whatsapp.getAttribute('href'))!).pathname).toBe('/8618215932610');
}

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: HTTP home vehicle cards use the same contextual contact links as their detail page`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/`);
    const cards = page.locator('[data-home-section^="vehicles-"] article');
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      const contacts = card.locator('[data-vehicle-contacts]');
      await expect(contacts.locator('a[href^="https://t.me/HD_Auto_CN?"]')).toHaveCount(1);
      await expect(contacts.locator('a[href^="https://wa.me/8618215932610?"]')).toHaveCount(1);
      await expect(contacts.locator('a[href^="tel:"]')).toHaveCount(0);
    }
    const contacts = cards.first().locator('[data-vehicle-contacts]');
    const id = await contacts.getAttribute('data-vehicle-contacts');
    expect(id).toBe('fixture_demo');
    await expectVehicleContacts(contacts, id!, locale);
    const homeHrefs = await contacts
      .locator('a[target="_blank"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    await page.goto(`/${locale}/cars/${id}/`);
    const detailContacts = page.locator(`[data-vehicle-contacts="${id}"]`);
    await expectVehicleContacts(detailContacts, id!, locale);
    expect(
      await detailContacts
        .locator('a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(homeHrefs);
  });

  test(`${locale}: HTTP catalog and detail preserve public vehicle contact context`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/cars/`);
    const cards = page.locator('main article');
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      await expect(card.locator('[data-vehicle-contacts] a')).toHaveCount(2);
      await expect(card.locator('a a')).toHaveCount(0);
    }
    for (const id of ['fixture_demo', 'fixture_car_1']) {
      await page.goto(`/${locale}/cars/`);
      const catalogContacts = page.locator(`[data-vehicle-contacts="${id}"]`);
      await expectVehicleContacts(catalogContacts, id, locale, id === 'fixture_demo');
      const catalogHrefs = await catalogContacts
        .locator('a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      await page.locator(`main a[href="/${locale}/cars/${id}/"]`).first().click();
      const detailContacts = page.locator(`[data-vehicle-contacts="${id}"]`);
      await expectVehicleContacts(detailContacts, id, locale, id === 'fixture_demo');
      expect(
        await detailContacts
          .locator('a')
          .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
      ).toEqual(catalogHrefs);
    }
  });
}

test('mobile vehicle contacts remain keyboard accessible without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/ru/cars/fixture_demo/');
    const contacts = page.locator('[data-vehicle-contacts="fixture_demo"]');
    await expectVehicleContacts(contacts, 'fixture_demo', 'ru');
    await contacts.locator('a').first().focus();
    await expect(contacts.locator('a').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(contacts.locator('a').nth(1)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
