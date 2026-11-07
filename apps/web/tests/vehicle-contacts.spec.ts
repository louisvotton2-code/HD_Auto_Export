import { expect, test, type Locator } from '@playwright/test';

async function expectVehicleContacts(contacts: Locator, slug: string, locale: string) {
  const telegram = contacts.locator('a[href^="https://t.me/"]');
  const whatsapp = contacts.locator('a[href^="https://wa.me/"]');

  for (const link of [telegram, whatsapp]) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAccessibleName(/Telegram|WhatsApp/);
    const href = new URL((await link.getAttribute('href'))!);
    const text = href.searchParams.get('text');
    expect(text).toContain(slug);
    expect(text).toContain('BYD');
    expect(text).toContain('Seagull');
    expect(text).toContain('2023');
    expect(text).toContain('USD');
    expect(text).toContain(`/${locale}/cars/${slug}/`);
  }

  expect(new URL((await telegram.getAttribute('href'))!).pathname).toBe('/HD_Auto_CN');
  expect(new URL((await whatsapp.getAttribute('href'))!).pathname).toBe('/8618215932610');
}

for (const locale of ['zh', 'en', 'ru']) {
  test(`${locale}: home vehicle cards use the same contextual contact links as their detail page`, async ({
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
    const slug = await contacts.getAttribute('data-vehicle-contacts');
    const homeHrefs = await contacts
      .locator('a[target="_blank"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(homeHrefs).toHaveLength(2);
    for (const href of homeHrefs) {
      const text = new URL(href!).searchParams.get('text');
      expect(text).toContain(slug);
      expect(text).toContain(`/${locale}/cars/${slug}/`);
    }
    await page.goto(`/${locale}/cars/${slug}/`);
    expect(
      await page
        .locator(`[data-vehicle-contacts="${slug}"] a`)
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(homeHrefs);
  });

  test(`${locale}: catalog and detail show direct Telegram and WhatsApp with the same demo context`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/cars/`);
    const cards = page.locator('main article');
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      await expect(card.locator('[data-vehicle-contacts] a')).toHaveCount(2);
      // No nested contact links inside the existing card detail link.
      await expect(card.locator('a a')).toHaveCount(0);
    }

    const catalogContacts = page.locator('[data-vehicle-contacts="byd-seagull"]');
    await expectVehicleContacts(catalogContacts, 'byd-seagull', locale);
    const catalogHrefs = await catalogContacts
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));

    await page.locator(`main a[href="/${locale}/cars/byd-seagull/"]`).click();
    const detailContacts = page.locator('[data-vehicle-contacts="byd-seagull"]');
    await expectVehicleContacts(detailContacts, 'byd-seagull', locale);
    expect(
      await detailContacts
        .locator('a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(catalogHrefs);
  });
}

test('mobile demo contacts remain keyboard accessible without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/ru/cars/byd-seagull/');
  const contacts = page.locator('[data-vehicle-contacts="byd-seagull"]');
  await expectVehicleContacts(contacts, 'byd-seagull', 'ru');
  await contacts.locator('a').first().focus();
  await expect(contacts.locator('a').first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(contacts.locator('a').nth(1)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
