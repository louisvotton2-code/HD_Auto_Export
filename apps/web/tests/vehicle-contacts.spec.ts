import { expect, test, type Locator, type Page } from '@playwright/test';
import { externalFixtureId } from '@hd/contracts/fixtures';
import { resetPublicFixture, publicFixtureLabels, setPublicFixtureState } from './helpers/public-fixture';

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
    expect(text).not.toContain(stockCode);
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
      expect(text).toContain(`${new Intl.NumberFormat(locale).format(23500)} USD`);
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

async function expectDetailContacts(page: Page, id: string, locale: Locale, demo = true) {
  const sidebar = page.locator(`#vehicle-contact-${id} [data-vehicle-contacts="${id}"]`);
  const service = page.locator('#inspection[data-inspection-service]');
  await expect(service).toHaveCount(1);
  await expect(service.locator('a')).toHaveCount(0);
  await expectVehicleContacts(sidebar, id, locale, demo);
  return sidebar;
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
    const sidebar = await expectDetailContacts(page, id!, locale);
    expect(await platformHrefs(sidebar)).toEqual(homeHrefs);
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
      const sidebar = await expectDetailContacts(page, id, locale, id === 'fixture_demo');
      expect(await platformHrefs(sidebar)).toEqual(catalogHrefs);
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
    const contacts = await expectDetailContacts(page, 'fixture_demo', 'ru');
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

test.describe('vehicle price contact', () => {
  test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'An isolated public vehicle fixture is required.');
  test.use({ isMobile: true, hasTouch: true });

  const cases = [
    { locale: 'zh', width: 320, channel: 'whatsapp', destination: 'https://wa.me/8618215932610', accept: '接受' },
    { locale: 'ru', width: 900, channel: 'telegram', destination: 'https://t.me/HD_Auto_CN', accept: 'Принять' },
  ] as const;

  for (const { locale, width, channel, destination, accept } of cases) {
    test(`${locale}: the price contact scrolls to the channel choices at ${width}px without reloading`, async ({
      page, context, request, baseURL,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await setPublicFixtureState(request, { importedPublished: true });
      const origin = new URL(baseURL!).origin;
      const contactCounts: unknown[] = [];
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === 'https://wa.me' || url.origin === 'https://t.me')
          return route.fulfill({ contentType: 'text/plain', body: 'Contact navigation intercepted locally' });
        if (url.origin !== origin) return route.abort();
        if (request.method() === 'POST' && url.pathname === '/api/v1/analytics/contact-count') {
          contactCounts.push(request.postDataJSON());
          return route.fulfill({ status: 202 });
        }
        if (request.method() === 'GET') return route.continue();
        return route.abort();
      });

      const id = externalFixtureId(1);
      const detailPath = `/${locale}/cars/${id}/`;
      const contactId = `vehicle-contact-${id}`;
      const detail = page.locator(`main[data-public-vehicle-detail="${id}"]`);
      const contact = detail.getByTestId('vehicle-price-contact');
      const card = detail.locator(`#${contactId}`);
      const telegram = card.locator('a[href^="https://t.me/"]');
      const whatsapp = card.locator('a[href^="https://wa.me/"]');
      await page.goto(`${detailPath}?utm_source=price-contact-test`);
      await expect(page.locator('html')).toHaveAttribute('data-public-history-ready', '');
      await page.getByTestId('tracking-consent-banner').getByRole('button', { name: accept, exact: true }).tap();
      await expect(contact).toHaveAttribute('href', `#${contactId}`);
      await expect(contact).not.toHaveAttribute('data-analytics-contact');
      await expect(contact).not.toHaveAttribute('data-analytics-contact-vehicle');
      await contact.scrollIntoViewIfNeeded();
      await expect(contact).toBeInViewport();
      expect(await contact.evaluate(link => {
        const button = link.getBoundingClientRect();
        const arrow = link.querySelector('svg')?.getBoundingClientRect();
        return !!arrow && arrow.width > 0 && arrow.left >= button.left && arrow.right <= button.right &&
          arrow.top >= button.top && arrow.bottom <= button.bottom;
      })).toBe(true);

      const initialUrl = page.url();
      const unwantedRequests: string[] = [];
      page.on('request', next => {
        const pathname = new URL(next.url()).pathname.replace(/\/$/, '');
        if (next.isNavigationRequest() || pathname === `/api/v1/vehicles/${id}`) unwantedRequests.push(next.url());
      });
      const popups: Page[] = [];
      page.on('popup', popup => { popups.push(popup); });
      await detail.evaluate(element => {
        const boundary = element.closest('[data-freshness]')!;
        const observer = new MutationObserver(records => {
          if (records.some(record => record.oldValue !== 'fresh') || boundary.getAttribute('data-freshness') !== 'fresh')
            boundary.setAttribute('data-test-freshness-changed', '');
        });
        observer.observe(boundary, { attributes: true, attributeOldValue: true, attributeFilter: ['data-freshness'] });
      });

      await contact.tap();
      const anchoredUrl = `${initialUrl}#${contactId}`;
      await expect(page).toHaveURL(anchoredUrl);
      await expect(telegram).toBeInViewport({ ratio: 0.75 });
      await expect(whatsapp).toBeInViewport({ ratio: 0.75 });
      expect(popups).toHaveLength(0);
      expect(contactCounts).toEqual([]);

      const [popup] = await Promise.all([page.waitForEvent('popup'), (channel === 'whatsapp' ? whatsapp : telegram).tap()]);
      await popup.waitForLoadState('domcontentloaded');
      try {
        const opened = new URL(popup.url());
        expect(opened.origin + opened.pathname).toBe(destination);
        const draft = opened.searchParams.get('text');
        expect(draft).toContain('HX100001');
        expect(draft).toContain(detailPath);
        expect(draft).not.toContain('EXT-000001');
        expect(draft).not.toContain('price-contact-test');
      } finally {
        await popup.close();
      }
      await expect.poll(() => contactCounts).toEqual([{ vehicleId: id, channel }]);
      expect(popups).toHaveLength(1);
      await expect(page).toHaveURL(anchoredUrl);
      await page.goBack();
      await expect(page).toHaveURL(initialUrl);
      await page.goForward();
      await expect(page).toHaveURL(anchoredUrl);
      await expect(page.locator('[data-freshness="fresh"]').filter({ has: detail })).toHaveCount(1);
      await expect(page.locator('[data-test-freshness-changed]')).toHaveCount(0);
      expect(unwantedRequests).toEqual([]);
    });
  }
});
