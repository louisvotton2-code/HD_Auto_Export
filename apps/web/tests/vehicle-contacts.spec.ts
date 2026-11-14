import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetPublicFixture, publicFixtureLabels } from './helpers/public-fixture';

test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

type Locale = keyof typeof publicFixtureLabels;
async function expectVehicleContacts(contacts: Locator, id: string, locale: Locale, demo = true) {
  await expect(contacts).toHaveCount(1);
  await expect(contacts).toHaveAttribute('data-vehicle-contacts', id);
  const telegram = contacts.locator('a[href^="https://t.me/"]');
  const whatsapp = contacts.locator('a[href^="https://wa.me/"]');
  await expect(telegram).toHaveCount(1);
  await expect(whatsapp).toHaveCount(1);
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

async function platformHrefs(contacts: Locator) {
  return contacts.locator('a[href^="https://t.me/"], a[href^="https://wa.me/"]')
    .evaluateAll(links => links.map(link => link.getAttribute('href')).sort());
}

async function expectDetailContactAreas(page: Page, id: string, locale: Locale, demo = true) {
  const sidebar = page.locator(`#vehicle-contact-${id} [data-vehicle-contacts="${id}"]`);
  const service = page.locator(`#inspection[data-inspection-service] [data-vehicle-contacts="${id}"]`);
  // The inspection service and the sidebar deliberately expose their own complete platform pair.
  for (const contacts of [sidebar, service]) await expectVehicleContacts(contacts, id, locale, demo);
  return { sidebar, service };
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
      const id = await card.getAttribute('data-public-vehicle');
      expect(id).toBeTruthy();
      const details = contacts.locator(`a[href="/${locale}/cars/${id}/"]`);
      await expect(details).toHaveCount(1);
      await expect(details).toHaveAttribute('href', `/${locale}/cars/${id}/`);
      await expect(details).toBeEnabled();
    }
    const contacts = page.locator('[data-home-section="vehicles-featured"] [data-public-vehicle="fixture_demo"] [data-vehicle-contacts]');
    const id = await contacts.getAttribute('data-vehicle-contacts');
    expect(id).toBe('fixture_demo');
    await expectVehicleContacts(contacts, id!, locale);
    const homeHrefs = await platformHrefs(contacts);
    // The homepage contact area also owns a distinct detail CTA; exercise it instead of dropping it from coverage.
    await contacts.locator(`a[href="/${locale}/cars/${id}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/cars/${id}/$`));
    const { sidebar, service } = await expectDetailContactAreas(page, id!, locale);
    for (const detailContacts of [sidebar, service]) {
      expect(await platformHrefs(detailContacts)).toEqual(homeHrefs);
    }
  });

  test(`${locale}: HTTP catalog and detail preserve public vehicle contact context`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/cars/`);
    const cards = page.locator('main article');
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      await expect(card.locator('[data-vehicle-contacts] a[href^="https://t.me/HD_Auto_CN?"]')).toHaveCount(1);
      await expect(card.locator('[data-vehicle-contacts] a[href^="https://wa.me/8618215932610?"]')).toHaveCount(1);
      await expect(card.locator('a a')).toHaveCount(0);
    }
    for (const id of ['fixture_demo', 'fixture_car_1']) {
      await page.goto(`/${locale}/cars/`);
      const catalogCard = page.locator(`main [data-public-vehicle="${id}"]`);
      const catalogContacts = catalogCard.locator(`[data-vehicle-contacts="${id}"]`);
      await expectVehicleContacts(catalogContacts, id, locale, id === 'fixture_demo');
      const catalogHrefs = await platformHrefs(catalogContacts);
      await catalogCard.locator('h2 a').click();
      const { sidebar, service } = await expectDetailContactAreas(page, id, locale, id === 'fixture_demo');
      for (const detailContacts of [sidebar, service]) {
        expect(await platformHrefs(detailContacts)).toEqual(catalogHrefs);
      }
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
    const { sidebar: contacts } = await expectDetailContactAreas(page, 'fixture_demo', 'ru');
    const telegram = contacts.locator('a[href^="https://t.me/"]');
    const whatsapp = contacts.locator('a[href^="https://wa.me/"]');
    await telegram.focus();
    await expect(telegram).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(whatsapp).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
