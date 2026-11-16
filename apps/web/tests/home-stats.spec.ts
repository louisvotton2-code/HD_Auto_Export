import { expect, test } from '@playwright/test';
import { approximateCatalogVehicleCount } from '../src/modules/home/content/company-metrics';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';
test.skip(
  !process.env.PUBLIC_FIXTURE_API_URL,
  'Requires the isolated public fixture, never operating inventory.',
);

test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

const catalogLabels = {
  zh: '目录中的汽车（约）',
  en: 'Cars in catalog (approx.)',
  ru: 'Автомобили в каталоге (прибл.)',
};

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: hero shows an approximate catalog count and confirmed company metrics`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/${locale}/`);
    const response = await request.get(
      `/api/v1/vehicles/?catalog=curated&locale=${locale}&page=1&pageSize=1`,
    );
    expect(response.status()).toBe(200);
    const list = await response.json();
    const catalog = page.getByTestId('hero-stat-catalog');
    const catalogTotal = catalog.locator('strong');
    await expect(catalogTotal).toBeVisible();
    await expect(catalogTotal).toHaveText(new Intl.NumberFormat(locale).format(approximateCatalogVehicleCount));
    await expect(catalog.locator('dt')).toHaveText(catalogLabels[locale]);
    expect(await catalog.evaluate((item) => item.scrollWidth <= item.clientWidth + 1)).toBe(true);
    const cards = await page.locator('[data-home-section^="vehicles-"] article').count();
    expect(list.meta.total).toBeGreaterThan(cards);
    expect(list.meta.total).toBeLessThan(approximateCatalogVehicleCount);
    const clients = page.getByTestId('hero-stat-clients').locator('strong');
    await expect(clients).toBeVisible();
    await expect(clients).toHaveText('660+', { useInnerText: true });
    await expect(page.getByTestId('hero-stat-years').locator('[data-counter-value]')).toHaveText(
      '23',
    );
  });
}

test('the customer counter grows from zero while the catalog estimate is always visible', async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Keep scripting enabled, but simulate delayed styles and JavaScript at first paint.
  const assets = /\/_next\/static\/.*\.(?:css|js)(?:\?|$)/;
  await page.route(assets, (route) => route.abort());
  await page.goto('/en/');
  await expect(page.getByTestId('hero-stat-clients').locator('strong')).toHaveText('0+', {
    useInnerText: true,
  });
  const estimate = new Intl.NumberFormat('en').format(approximateCatalogVehicleCount);
  await expect(page.getByTestId('hero-stat-catalog').locator('strong')).toHaveText(estimate, {
    useInnerText: true,
  });
  await page.unroute(assets);

  await page.addInitScript(() => {
    const observed: number[] = [];
    const catalogObserved: string[] = [];
    Reflect.set(window, '__counterObservations', observed);
    Reflect.set(window, '__catalogCounterObservations', catalogObserved);
    const collect = () => {
      const value = document
        .querySelector('[data-testid="hero-stat-clients"] [data-counter-value]')
        ?.getAttribute('data-counter-value');
      if (value !== null && value !== undefined) observed.push(Number(value));
      const catalog = document
        .querySelector('[data-testid="hero-stat-catalog"] strong')?.textContent;
      if (catalog) catalogObserved.push(catalog);
    };
    new MutationObserver(collect).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  });
  for (let i = 0; i < 2; i++) {
    if (i === 0) await page.goto('/en/');
    else await page.reload();
    const clients = page.getByTestId('hero-stat-clients');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (Reflect.get(window, '__counterObservations') as number[]).some((n) => n > 0 && n < 660),
        ),
      )
      .toBe(true);
    await expect(clients.locator('[data-counter-value]')).toHaveAttribute(
      'data-counter-value',
      '660',
    );
    const [clientObservations, catalogObservations] = await page.evaluate(() => [
      Reflect.get(window, '__counterObservations') as number[],
      Reflect.get(window, '__catalogCounterObservations') as string[],
    ] as const);
    expect(clientObservations[0]).toBe(0);
    expect(clientObservations.every((value, index) =>
      index === 0 || value >= clientObservations[index - 1])).toBe(true);
    expect(new Set(catalogObservations)).toEqual(new Set([estimate]));
    await expect(
      page.getByTestId('hero-stat-years').locator('[data-counter-value]'),
    ).toHaveAttribute('data-counter-value', '23');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  const reducedClients = page.getByTestId('hero-stat-clients');
  await expect(reducedClients.locator('strong')).toHaveText('660+', { useInnerText: true });
  await expect(reducedClients.locator('[data-counter-value]')).toBeHidden();
  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: new URL(page.url()).origin,
  });
  const plain = await noScript.newPage();
  await plain.goto('/zh/');
  const plainClients = plain.getByTestId('hero-stat-clients');
  await expect(plainClients.locator('strong')).toHaveText('660+', { useInnerText: true });
  await expect(plainClients.locator('[data-counter-value]')).toBeHidden();
  await expect(plain.getByTestId('hero-stat-catalog').locator('strong')).toHaveText(
    new Intl.NumberFormat('zh').format(approximateCatalogVehicleCount), { useInnerText: true },
  );
  await expect(plain.getByTestId('hero-stat-years').locator('[data-counter-value]')).toHaveText('23');
  await noScript.close();
});

for (const locale of ['zh', 'en', 'ru']) {
  for (const width of [1440, 390, 320]) {
    test(`${locale}: long vehicle titles keep rail actions aligned at ${width}px`, async ({
      page,
      request,
    }) => {
      await setPublicFixtureState(request, { longTitles: true });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/${locale}/`);
      const cards = page.locator('[data-home-section^="vehicles-"] article');
      await expect(cards).toHaveCount(3);
      const geometry = await cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const card = node.getBoundingClientRect();
          const action = node.querySelector('a[href*="/cars/"]:last-child')!;
          const r = action.getBoundingClientRect();
          return {
            bottom: r.bottom,
            height: r.height,
            cardBottom: card.bottom,
            right: r.right,
            cardRight: card.right,
          };
        }),
      );
      expect(
        Math.max(...geometry.map((r) => r.bottom)) - Math.min(...geometry.map((r) => r.bottom)),
      ).toBeLessThan(2);
      for (const item of geometry) {
        expect(item.height).toBeGreaterThanOrEqual(38);
        expect(item.bottom).toBeLessThan(item.cardBottom);
        expect(item.right).toBeLessThan(item.cardRight);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }
}
