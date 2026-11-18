import { expect, test } from '@playwright/test';
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
  zh: '目录中的汽车',
  en: 'Cars in catalog',
  ru: 'Автомобили в каталоге',
};

for (const [label, fixture, locale, total, catalogLabel] of [
  ['uses the exact list total when only filters fail', { filtersUnavailable: true }, 'en', '26', catalogLabels.en],
  ['labels the preset (zh) when both sources fail', { mode: 'unavailable' }, 'zh', '470,000+', '目录总数暂不可用 · 预设值'],
  ['labels the preset (en) when both sources fail', { mode: 'unavailable' }, 'en', '470,000+', 'Catalog count unavailable · Preset'],
  ['labels the preset (ru) when both sources fail', { mode: 'unavailable' }, 'ru', new Intl.NumberFormat('ru').format(470_000) + '+', 'Количество недоступно · Заданное значение'],
] as const) {
  test(`catalog count ${label} in the server-rendered HTML`, async ({ page, request }) => {
    await setPublicFixtureState(request, fixture);
    await page.setViewportSize({ width: 320, height: 800 });
    const browserReads: string[] = [];
    page.on('request', (read) => {
      const path = new URL(read.url()).pathname;
      if (/^\/api\/v1\/(home\/vehicles|vehicle-filters|vehicles)\/?$/.test(path)) browserReads.push(path);
    });
    const response = await page.goto(`/${locale}/`);
    expect(response?.status()).toBe(200);
    expect(await response?.text()).toContain(catalogLabel);
    const catalog = page.getByTestId('hero-stat-catalog');
    await expect(catalog.locator('strong')).toHaveText(total);
    await expect(catalog.locator('dt')).toHaveText(catalogLabel);
    await expect(page.getByTestId('public-resource-status')).toBeVisible();
    expect(await catalog.evaluate((item) => item.scrollWidth <= item.clientWidth + 1)).toBe(true);
    expect(browserReads).toEqual([]);
    const events = await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`);
    expect(events.ok()).toBe(true);
    const reads = (await events.json()).requests.filter(
      (read: { path: string }) => read.path === '/internal/public-catalog/vehicles',
    );
    expect(reads).toEqual([
      expect.objectContaining({ query: expect.objectContaining({ locale, pageSize: '1' }) }),
    ]);
  });
}

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: hero shows the exact catalog total without a browser API request at 320px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const browserReads: string[] = [];
    page.on('request', (read) => {
      const path = new URL(read.url()).pathname;
      if (/^\/api\/v1\/(home\/vehicles|vehicle-filters|vehicles)\/?$/.test(path)) browserReads.push(path);
    });
    await page.goto(`/${locale}/`);
    const response = await request.get(
      `/api/v1/vehicles/?catalog=curated&locale=${locale}&page=1&pageSize=1`,
    );
    expect(response.status()).toBe(200);
    const list = await response.json();
    const catalog = page.getByTestId('hero-stat-catalog');
    const catalogTotal = catalog.locator('strong');
    await expect(catalogTotal).toBeVisible();
    await expect(catalogTotal).toHaveText(new Intl.NumberFormat(locale).format(list.meta.total));
    await expect(catalogTotal).not.toHaveAttribute('data-counter-target');
    await expect(catalog.locator('dt')).toHaveText(catalogLabels[locale]);
    expect(await catalog.evaluate((item) => item.scrollWidth <= item.clientWidth + 1)).toBe(true);
    const cards = await page.locator('[data-home-section^="vehicles-"] article').count();
    expect(list.meta.total).toBeGreaterThan(cards);
    const clients = page.getByTestId('hero-stat-clients').locator('strong');
    await expect(clients).toBeVisible();
    await expect(clients).toHaveText('660+', { useInnerText: true });
    await expect(page.getByTestId('hero-stat-years').locator('strong'))
      .toHaveText(/23/, { useInnerText: true });
    expect(browserReads).toEqual([]);
  });
}

test('company counters grow from zero while the exact catalog total stays static', async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Keep scripting enabled, but simulate delayed styles and JavaScript at first paint.
  const assets = /\/_next\/static\/.*\.(?:css|js)(?:\?|$)/;
  await page.route(assets, (route) => route.abort());
  await page.goto('/en/');
  const catalog = page.getByTestId('hero-stat-catalog').locator('strong');
  await expect(catalog).toHaveText('26');
  const metrics = ['clients', 'years'] as const;
  for (const id of metrics) {
    await expect(page.getByTestId(`hero-stat-${id}`).locator('[data-counter-value]')).toHaveText('0');
  }
  await page.unroute(assets);

  await page.addInitScript((ids) => {
    const observed = Object.fromEntries(ids.map((id) => [id, [] as number[]]));
    Reflect.set(window, '__counterObservations', observed);
    const collect = () => {
      for (const id of ids) {
        const value = document
          .querySelector(`[data-hero-stat="${id}"] [data-counter-value]`)
          ?.getAttribute('data-counter-value');
        if (value != null) observed[id].push(Number(value));
      }
    };
    new MutationObserver(collect).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  }, [...metrics]);
  for (let i = 0; i < 2; i++) {
    if (i === 0) await page.goto('/en/');
    else await page.reload();
    const expected = { clients: 660, years: 23 };
    for (const id of metrics) {
      await expect(page.getByTestId(`hero-stat-${id}`).locator('[data-counter-value]'))
        .toHaveAttribute('data-counter-value', String(expected[id]));
    }
    await expect(catalog).toHaveText('26');
    await expect(catalog).not.toHaveAttribute('data-counter-target');
    const observations = await page.evaluate(() =>
      Reflect.get(window, '__counterObservations') as Record<string, number[]>);
    for (const id of metrics) {
      const values = observations[id];
      expect(values[0]).toBe(0);
      expect(values.some((value) => value > 0 && value < expected[id])).toBe(true);
      expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(catalog).toHaveText('26');
  const reducedValues = { clients: '660+', years: '23 years' };
  for (const id of metrics) {
    const metric = page.getByTestId(`hero-stat-${id}`);
    await expect(metric.locator('strong')).toHaveText(reducedValues[id], { useInnerText: true });
    await expect(metric.locator('[data-counter-value]')).toBeHidden();
  }
  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: new URL(page.url()).origin,
  });
  const plain = await noScript.newPage();
  await plain.goto('/zh/');
  const plainClients = plain.getByTestId('hero-stat-clients');
  await expect(plainClients.locator('strong')).toHaveText('660+', { useInnerText: true });
  await expect(plainClients.locator('[data-counter-value]')).toBeHidden();
  const plainCatalog = plain.getByTestId('hero-stat-catalog').locator('strong');
  await expect(plainCatalog).toHaveText('26');
  await expect(plain.getByTestId('hero-stat-years').locator('strong')).toHaveText('23年', { useInnerText: true });
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
