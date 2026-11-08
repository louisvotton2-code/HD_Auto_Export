import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

const fixtureOrigin = process.env.PUBLIC_FIXTURE_API_URL;
const suite = 'hd-web-public-catalog-v1';
if (fixtureOrigin) {
  const url = new URL(fixtureOrigin);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port === '3320' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Freshness controls require an isolated loopback fixture, never API 3320.');
}

type FixturePatch = {
  mode?: 'normal' | 'empty' | 'unavailable' | 'malformed';
  futurePublished?: boolean;
  futureAvailability?: 'available' | 'reserved' | 'sold' | 'unknown';
  futureArchived?: boolean;
  externalPublished?: boolean;
};
async function patchFixture(request: APIRequestContext, data: FixturePatch) {
  expect(
    fixtureOrigin,
    'state controls must never fall back to the website or real API',
  ).toBeTruthy();
  const health = await request.get(`${fixtureOrigin}/__fixtures/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ suite });
  const response = await request.put(`${fixtureOrigin}/__fixtures/state`, { data });
  expect(response.status()).toBe(200);
  expect((await response.json()).suite).toBe(suite);
}

const contactLinks = (scope: Locator) =>
  scope.locator(
    '[data-vehicle-contacts] a[href^="https://t.me/"], [data-vehicle-contacts] a[href^="https://wa.me/"]',
  );
const cleanPath = (url: string) => new URL(url).pathname.replace(/\/$/, '');
const isDataRequest = (request: Request) =>
  /\/api\/v1\/(?:home\/vehicles|vehicles(?:\/[^/]+)?|vehicle-filters)\/?$/.test(
    new URL(request.url()).pathname,
  );
function networkAudit(page: Page) {
  const requests: Request[] = [];
  const collect = (request: Request) => requests.push(request);
  page.on('request', collect);
  return {
    requests,
    data: () => requests.filter(isDataRequest),
    documents: () =>
      requests.filter(
        (request) => request.isNavigationRequest() && request.resourceType() === 'document',
      ),
    rsc: () =>
      requests.filter(
        (request) =>
          request.headers().rsc === '1' || new URL(request.url()).searchParams.has('_rsc'),
      ),
    stop: () => page.off('request', collect),
  };
}
async function resource(page: Page, path: string) {
  const wrappers = page.locator('[data-resource-url]');
  await expect.poll(() => wrappers.count()).toBeGreaterThan(0);
  for (const node of await wrappers.all()) {
    const value = await node.getAttribute('data-resource-url');
    if (value && new URL(value, page.url()).pathname.replace(/\/$/, '') === path) return node;
  }
  throw new Error(`No public resource wrapper for ${path}`);
}
async function beginShellAudit(page: Page) {
  await page.evaluate(() => {
    type AuditWindow = Window & {
      __freshnessAudit?: { hidden: boolean; header: Element | null; canvas: Element | null };
    };
    const state = {
      hidden: false,
      header: document.querySelector('header'),
      canvas: document.querySelector('canvas'),
    };
    (window as AuditWindow).__freshnessAudit = state;
    const check = () => {
      const main = document.querySelector('main');
      if (
        main &&
        (getComputedStyle(main).visibility === 'hidden' ||
          getComputedStyle(main).display === 'none' ||
          main.getAttribute('aria-hidden') === 'true')
      )
        state.hidden = true;
    };
    new MutationObserver(check).observe(document.documentElement, {
      attributes: true,
      subtree: true,
      childList: true,
    });
    check();
  });
}
async function expectShellPreserved(page: Page) {
  const result = await page.evaluate(() => {
    const state = (
      window as Window & {
        __freshnessAudit?: { hidden: boolean; header: Element | null; canvas: Element | null };
      }
    ).__freshnessAudit;
    return {
      hidden: state?.hidden,
      sameHeader: state?.header === document.querySelector('header'),
      sameCanvas: state?.canvas === document.querySelector('canvas'),
    };
  });
  expect(result).toEqual({ hidden: false, sameHeader: true, sameCanvas: true });
  await expect(page.locator('main')).toBeVisible();
}

test.describe('explicit public queries, stable activation and media regression', () => {
  test.skip(!fixtureOrigin, 'Requires the isolated fixture API; never mutates live inventory.');
  test.beforeEach(async ({ request }) => {
    await resetPublicFixture(request);
  });
  test.afterEach(async ({ request }) => {
    await resetPublicFixture(request);
  });

  test('search, selectors and pagination fetch scoped JSON and restore the URL without RSC or documents', async ({
    page,
  }) => {
    await page.goto('/en/cars/?page=2&pageSize=2');
    const current = await resource(page, '/api/v1/vehicles');
    await expect(current).toHaveAttribute('data-freshness', 'fresh');
    await beginShellAudit(page);
    const audit = networkAudit(page);
    const form = page.locator('main form').first();
    await form.locator('[name="q"]').fill('Alpha Model');
    await form.locator('select[name="make"]').selectOption('alpha');
    await form.locator('select[name="model"]').selectOption('alpha_model');
    await form.locator('select[name="powertrain"]').selectOption('bev');
    await form.locator('[type="submit"]').last().click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('1');
    await expect(current).toHaveAttribute('data-freshness', 'fresh');
    await expect(current.locator('[data-public-vehicle]')).toHaveCount(2);
    await expect(form.locator('select[name="make"] option[value="beta"]')).toHaveCount(0);
    const requested = audit.data().map((request) => new URL(request.url()));
    expect(
      requested.some(
        (url) =>
          cleanPath(url.href) === '/api/v1/vehicles' &&
          url.searchParams.get('q') === 'Alpha Model' &&
          url.searchParams.get('make') === 'alpha' &&
          url.searchParams.get('model') === 'alpha_model' &&
          url.searchParams.get('powertrain') === 'bev' &&
          url.searchParams.get('page') === '1' &&
          url.searchParams.get('pageSize') === '2',
      ),
    ).toBe(true);
    expect(
      requested.some(
        (url) =>
          cleanPath(url.href) === '/api/v1/vehicle-filters' &&
          url.searchParams.get('q') === 'Alpha Model',
      ),
    ).toBe(true);
    await page.locator('main a[rel="next"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    await expect(current).toHaveAttribute('data-freshness', 'fresh');
    expect(
      audit
        .data()
        .some(
          (request) =>
            cleanPath(request.url()) === '/api/v1/vehicles' &&
            new URL(request.url()).searchParams.get('page') === '2' &&
            new URL(request.url()).searchParams.get('q') === 'Alpha Model',
        ),
    ).toBe(true);
    const requestsBeforeBack = audit.data().length;
    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('1');
    await expect(form.locator('[name="q"]')).toHaveValue('Alpha Model');
    await expect(form.locator('select[name="make"]')).toHaveValue('alpha');
    await expect(current).toHaveAttribute('data-freshness', 'fresh');
    await page.waitForTimeout(150);
    const backRequests = audit.data().slice(requestsBeforeBack);
    expect(backRequests).toHaveLength(1);
    expect(cleanPath(backRequests[0]!.url())).toBe('/api/v1/vehicles');
    expect(audit.documents()).toHaveLength(0);
    expect(audit.rsc()).toHaveLength(0);
    await expectShellPreserved(page);
    audit.stop();
  });

  test('literal search applies AND selectors, searches published fields only and gives the same-q facets', async ({
    request,
  }) => {
    const list = await request.get('/api/v1/vehicles?locale=en&q=Alpha%20Model&page=1&pageSize=2');
    expect(list.status()).toBe(200);
    const data = await list.json();
    expect(data.meta.total).toBe(14);
    expect(data.data.items).toHaveLength(2);
    const filters = await request.get('/api/v1/vehicle-filters?locale=en&q=Alpha%20Model');
    expect(filters.status()).toBe(200);
    expect((await filters.json()).data.makes).toEqual([
      { id: 'alpha', name: 'Alpha Motors', count: 14 },
    ]);
    for (const q of ['%', 'fixture_car_2.*', 'HTTP fixture only']) {
      const response = await request.get(`/api/v1/vehicles?locale=en&q=${encodeURIComponent(q)}`);
      expect(response.status()).toBe(200);
      expect((await response.json()).meta.total).toBe(0);
    }
    const and = await request.get('/api/v1/vehicles?locale=en&q=Beta&make=alpha');
    expect(and.status()).toBe(200);
    expect((await and.json()).data.items).toEqual([]);
  });

  test('external DTO identity stays safe while public presentation and drafts omit source governance notices', async ({ page, request }) => {
    await patchFixture(request, { externalPublished: true });
    const response = await request.get('/api/v1/vehicles/fixture_external/?locale=en');
    expect(response.status()).toBe(200);
    const vehicle = (await response.json()).data;
    expect(vehicle.id).toBe('fixture_external');
    expect(vehicle.source).toEqual({ kind: 'external', platform: { id: 'fixture_market', name: 'Fixture Marketplace' }, listingUrl: 'https://example.invalid/listings/fixture-external' });
    expect(vehicle.price.kind).toBe('reference');
    expect(vehicle.availability).toBe('unknown');
    expect(vehicle.availabilityCheckedAt).toBeNull();
    expect(vehicle.content.title.reviewed).toBe(false);
    await page.goto('/en/cars/fixture_external/');
    await expect(page.locator('main h1')).toHaveText(vehicle.content.title.text);
    await expect(page.getByTestId('vehicle-external-notice')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const links = contactLinks(page.locator('main'));
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      const url = new URL((await link.getAttribute('href'))!);
      expect(['https://t.me/HD_Auto_CN', 'https://wa.me/8618215932610']).toContain(url.origin + url.pathname);
      const draft = url.searchParams.get('text');
      expect(draft).toContain(vehicle.stockCode);
      expect(draft).toContain('/en/cars/fixture_external/');
      expect(draft).not.toMatch(/third.party listing|external listing|stock not verified|display example|not actual inventory/i);
    }
  });

  test('focus, visibility and ordinary pageshow do not update public resources in any language', async ({ page }) => {
    for (const locale of ['zh', 'en', 'ru']) {
      for (const entry of [
        { route: `/${locale}/`, endpoint: '/api/v1/home/vehicles' },
        { route: `/${locale}/cars/?page=1&pageSize=2`, endpoint: '/api/v1/vehicles' },
        { route: `/${locale}/cars/fixture_car_2/`, endpoint: '/api/v1/vehicles/fixture_car_2' },
      ]) {
        await page.goto(entry.route);
        const current = await resource(page, entry.endpoint);
        await expect(current).toHaveAttribute('data-freshness', 'fresh');
        await page.waitForTimeout(350); // Let initial route prefetch finish before the activation audit.
        const input = page.locator('main input[name="q"]');
        if (await input.count()) await input.fill('keep this unsent draft');
        await page.evaluate(() => scrollTo(0, 200));
        const scroll = await page.evaluate(() => scrollY);
        const linkCount = await contactLinks(current).count();
        await beginShellAudit(page);
        const audit = networkAudit(page);
        try {
          // Controlled lifecycle signals exercise absence of handlers; no real OS switch is claimed.
          await page.evaluate(() => {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
          });
          await page.waitForTimeout(250);
          expect(audit.data()).toHaveLength(0);
          expect(audit.rsc()).toHaveLength(0);
          expect(audit.documents()).toHaveLength(0);
          await expect(current).toHaveAttribute('data-freshness', 'fresh');
          await expect(contactLinks(current)).toHaveCount(linkCount);
          expect(await page.evaluate(() => scrollY)).toBe(scroll);
          if (await input.count()) await expect(input).toHaveValue('keep this unsent draft');
          await expectShellPreserved(page);
        } finally { audit.stop(); }
      }
    }
  });

  test('real Back and Forward check current sold and removed records with one local JSON request', async ({ page, request }) => {
    await patchFixture(request, { futurePublished: true });
    await page.goto('/en/cars/fixture_future/');
    await expect(contactLinks(page.locator('main'))).toHaveCount(2);
    await page.getByRole('link', { name: /Back to selected vehicles/ }).click();
    await expect(page).toHaveURL(/\/en\/cars\/$/);
    await patchFixture(request, { futureAvailability: 'sold' });
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const matcher = (url: URL) => cleanPath(url.href) === '/api/v1/vehicles/fixture_future';
    await page.route(matcher, async (route) => { await held; await route.continue(); });
    const audit = networkAudit(page);
    try {
      await page.goBack();
      const current = await resource(page, '/api/v1/vehicles/fixture_future');
      await expect(current).toHaveAttribute('data-freshness', 'checking');
      await expect(contactLinks(current)).toHaveCount(0);
      await expect(page.locator('main h1')).toHaveText('Newly published vehicle');
      release();
      await expect(current).toHaveAttribute('data-freshness', 'fresh');
      await expect(current.locator('[data-availability="sold"]')).toBeVisible();
      const draft = new URL((await contactLinks(current).first().getAttribute('href'))!).searchParams.get('text');
      expect(draft).toMatch(/sold|similar/i);
      await page.waitForTimeout(150);
      expect(audit.data()).toHaveLength(1);
      expect(cleanPath(audit.data()[0]!.url())).toBe('/api/v1/vehicles/fixture_future');
      const beforeForward = audit.data().length;
      await page.goForward();
      await expect(page).toHaveURL(/\/en\/cars\/$/);
      const catalog = await resource(page, '/api/v1/vehicles');
      await expect(catalog).toHaveAttribute('data-freshness', 'fresh');
      await expect(page.locator('[data-public-vehicle="fixture_future"]')).toHaveCount(0);
      await page.waitForTimeout(150);
      expect(audit.data().slice(beforeForward)).toHaveLength(1);
      await patchFixture(request, { futureArchived: true });
      const beforeRemovedBack = audit.data().length;
      await page.goBack();
      await expect(page.getByTestId('public-vehicle-missing')).toBeVisible();
      await expect(page.locator('[data-public-vehicle-detail="fixture_future"]')).toHaveCount(0);
      await expect(contactLinks(page.locator('main'))).toHaveCount(0);
      await page.waitForTimeout(150);
      expect(audit.data().slice(beforeRemovedBack)).toHaveLength(1);
      expect((await request.get('/en/cars/fixture_future/')).status()).toBe(404);
      expect(audit.rsc()).toHaveLength(0);
      expect(audit.documents()).toHaveLength(0);
    } finally { release(); await page.unroute(matcher); audit.stop(); }
  });

  test('gallery requests previews instead of unvisited originals and supports thumbnail, keyboard, modal and focus return', async ({
    page,
  }) => {
    const media: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.includes('/api/v1/media/')) media.push(request.url());
    });
    await page.goto('/en/cars/fixture_car_2/');
    const gallery = page.locator('[data-vehicle-gallery]');
    const originalId = 'media_fixture_car_2';
    await expect(gallery).toHaveAttribute('data-selected-image', originalId);
    await expect(gallery.locator('nav a')).toHaveCount(4);
    await expect(gallery.locator('nav img')).toHaveCount(4);
    for (const image of await gallery.locator('nav img').all())
      expect(
        new URL((await image.getAttribute('src'))!, page.url()).searchParams.get('variant'),
      ).toBe('thumb');
    const full = media.filter((url) => new URL(url).searchParams.get('variant') !== 'thumb');
    expect(new Set(full.map((url) => cleanPath(url)))).toEqual(
      new Set([`/api/v1/media/${originalId}`]),
    );
    await gallery.getByRole('link', { name: 'View photo 2', exact: true }).click();
    await expect(gallery).toHaveAttribute('data-selected-image', `${originalId}_2`);
    const open = gallery.getByRole('button', { name: /Open gallery/ });
    await open.click();
    const dialog = gallery.getByRole('dialog', { name: 'Vehicle photos' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('ArrowRight');
    await expect(gallery).toHaveAttribute('data-selected-image', `${originalId}_3`);
    await page.keyboard.press('ArrowLeft');
    await expect(gallery).toHaveAttribute('data-selected-image', `${originalId}_2`);
    await expect(gallery.locator('[data-loading]')).toHaveAttribute('data-loading', 'false');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('a loaded photo stays ready when immediately selecting another and returning', async ({
    page,
  }) => {
    await page.goto('/en/cars/fixture_car_2/');
    const gallery = page.locator('[data-vehicle-gallery]');
    await expect
      .poll(() =>
        gallery
          .locator('img[data-outgoing="false"]')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    // Controlled DOM clicks exercise the 450ms transition race without waiting for it to finish.
    await gallery.getByRole('link', { name: 'View photo 2', exact: true }).dispatchEvent('click');
    await gallery.getByRole('link', { name: 'View photo 1', exact: true }).dispatchEvent('click');
    await expect(gallery).toHaveAttribute('data-selected-image', 'media_fixture_car_2');
    await expect(gallery.locator('[data-loading]')).toHaveAttribute('data-loading', 'false');
  });

  test('a failed selected gallery image retries independently of the readable vehicle', async ({
    page,
  }) => {
    await page.goto('/en/cars/fixture_car_2/');
    const gallery = page.locator('[data-vehicle-gallery]');
    const matcher = (url: URL) =>
      url.pathname.replace(/\/$/, '') === '/api/v1/media/media_fixture_car_2_2' &&
      !url.searchParams.has('variant');
    await page.route(matcher, (route) =>
      route.fulfill({ status: 503, body: 'Fixture image outage' }),
    );
    await gallery.getByRole('link', { name: 'View photo 2', exact: true }).click();
    await expect(gallery.getByRole('button', { name: 'Retry photo', exact: true })).toBeVisible();
    await expect(page.locator('main h1')).toHaveText(/fixture_car_2/);
    await expect(page.locator('[data-vehicle-contacts="fixture_car_2"] a')).toHaveCount(2);
    await page.unroute(matcher);
    await gallery.getByRole('button', { name: 'Retry photo', exact: true }).click();
    await expect(gallery.getByRole('button', { name: 'Retry photo', exact: true })).toHaveCount(0);
    await expect
      .poll(() =>
        gallery
          .locator('[data-loading] > a > img[data-outgoing="false"]')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  });

  test('320px gallery supports a touch swipe, modal controls and no horizontal overflow', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 320, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.goto('/en/cars/fixture_car_2/');
      const gallery = page.locator('[data-vehicle-gallery]');
      const viewport = gallery.locator('[data-loading]');
      await viewport.scrollIntoViewIfNeeded();
      const box = (await viewport.boundingBox())!;
      const cdp = await context.newCDPSession(page);
      const y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: box.x + box.width * 0.85, y }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: box.x + box.width * 0.2, y }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(gallery).toHaveAttribute('data-selected-image', 'media_fixture_car_2_2');
      await expect(gallery.getByRole('dialog')).not.toBeVisible();
      await gallery.getByRole('button', { name: /Open gallery/ }).tap();
      const dialog = gallery.getByRole('dialog', { name: 'Vehicle photos' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Next photo', exact: true }).tap();
      await expect(gallery).toHaveAttribute('data-selected-image', 'media_fixture_car_2_3');
      await dialog.getByRole('button', { name: 'Close photo viewer', exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      await context.close();
    }
  });

  test('gallery and contacts retain no-JS reading, native image links and strict public media queries', async ({
    browser,
    baseURL,
    request,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width: 320, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto('/en/cars/fixture_car_2/');
      await expect(page.locator('main h1')).toHaveText(/fixture_car_2/);
      const gallery = page.locator('[data-vehicle-gallery]');
      await expect(gallery.locator('nav a')).toHaveCount(4);
      await expect(gallery.locator('nav a').nth(1)).toHaveAttribute(
        'href',
        /media_fixture_car_2_2\/?$/,
      );
      await expect(gallery.locator('nav a').nth(1)).toHaveAttribute('target', '_blank');
      await expect(gallery.locator('nav a').nth(1)).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(contactLinks(page.locator('main'))).toHaveCount(2);
      for (const path of [
        '/api/v1/media/media_fixture_demo?variant=original',
        '/api/v1/media/media_fixture_demo?variant=thumb&url=https://example.invalid',
      ])
        expect((await request.get(path)).status()).toBe(400);
      // Paths outside the BFF allowlist are unavailable; allowed paths validate their query as 400.
      for (const path of ['/api/v1/vehicles/_bad', '/api/v1/media/-bad'])
        expect((await request.get(path)).status()).toBe(404);
      const thumb = await request.get('/api/v1/media/media_fixture_demo?variant=thumb');
      expect(thumb.status()).toBe(200);
      expect(thumb.headers()['content-type']).toMatch(/^image\//);
      expect(thumb.headers()['set-cookie']).toBeUndefined();
    } finally {
      await context.close();
    }
  });
});
