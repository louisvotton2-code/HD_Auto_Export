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

for (const failedProjection of ['overview', 'home-models'] as const) {
  test(`home keeps the other facet data and retries only ${failedProjection}`, async ({ page, request }) => {
    await setPublicFixtureState(request, { filtersUnavailable: failedProjection });
    const browserProjections: (string | null)[] = [];
    page.on('request', (read) => {
      const url = new URL(read.url());
      if (/^\/api\/v1\/(home\/vehicles|vehicle-filters|vehicles)\/?$/.test(url.pathname))
        browserProjections.push(url.searchParams.get('projection'));
    });

    expect((await page.goto('/en/'))?.status()).toBe(200);
    const modelLinks = page.locator('[data-home-section="popular-models"] a[href*="model="]');
    const count = page.getByTestId('hero-stat-catalog');
    await expect(count.locator('strong')).toHaveText('26', { useInnerText: true });
    await expect(count.locator('dt')).toHaveText(catalogLabels.en);
    await expect(modelLinks).toHaveCount(failedProjection === 'overview' ? 2 : 0);
    const status = page.getByTestId('public-resource-status');
    await expect(status.getByRole('button')).toBeEnabled();
    expect(browserProjections).toEqual([]);

    const events = await request.get(`${process.env.PUBLIC_FIXTURE_API_URL}/__fixtures/requests`);
    expect(events.ok()).toBe(true);
    const { requests } = (await events.json()) as {
      requests: Array<{ path: string; query: Record<string, string> }>;
    };
    const filterReads = requests.filter((read) => read.path === '/internal/public-catalog/vehicle-filters');
    expect(filterReads.map((read) => read.query.projection).sort()).toEqual(['home-models', 'overview']);
    const fallbackReads = requests.filter((read) => read.path === '/internal/public-catalog/vehicles');
    expect(fallbackReads).toHaveLength(failedProjection === 'overview' ? 1 : 0);

    await setPublicFixtureState(request, { filtersUnavailable: false });
    await status.getByRole('button').click();
    await expect(status).not.toBeVisible();
    await expect(modelLinks).toHaveCount(2);
    await expect(count.locator('strong')).toHaveText('26', { useInnerText: true });
    expect(browserProjections).toEqual([failedProjection]);
  });
}

test('recovering the featured rail refreshes models after the featured selection changes', async ({ page, request }) => {
  await setPublicFixtureState(request, { homeUnavailable: true, homeStampSamples: true });
  const reads: [string, string | null][] = [];
  page.on('request', (read) => {
    const { pathname, searchParams } = new URL(read.url());
    if (/^\/api\/v1\/(home\/vehicles|vehicle-filters|vehicles)\/?$/.test(pathname))
      reads.push([pathname, searchParams.get('projection')]);
  });

  await page.goto('/en/');
  await expect(page.getByTestId('home-catalog-error')).toBeVisible();
  await expect(page.getByTestId('hero-stat-catalog').locator('strong')).toHaveText('26', { useInnerText: true });
  expect(reads).toEqual([]);

  await setPublicFixtureState(request, { homeUnavailable: false, homeStampSamples: false });
  const status = page.getByTestId('public-resource-status');
  await status.getByRole('button').click();
  await expect(status).not.toBeVisible();
  await expect(page.getByTestId('home-catalog-error')).toHaveCount(0);
  await expect(page.locator('[data-home-section="popular-models"] a[href*="model=beta_model"]')).toHaveCount(1);
  expect(reads.sort()).toEqual([
    ['/api/v1/home/vehicles/', null],
    ['/api/v1/vehicle-filters/', 'home-models'],
  ]);
});

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
    await expect(catalog.locator('strong')).toHaveText(total, { useInnerText: true });
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
    const formatCount = new Intl.NumberFormat(locale);
    await expect(catalogTotal).toHaveText(formatCount.format(list.meta.total), { useInnerText: true });
    await expect(catalogTotal).toHaveAttribute('data-counter-target', String(list.meta.total));
    await expect(catalog.locator('dt')).toHaveText(catalogLabels[locale]);
    // The compact fixture has few cars. Check the same number lane at production scale.
    expect(await catalog.evaluate(async (item, largeCount) => {
      await document.fonts.ready;
      const counter = item.querySelector('[data-counter-value]')!;
      const original = counter.textContent;
      counter.textContent = largeCount;
      const frame = item.getBoundingClientRect();
      const text = counter.getBoundingClientRect();
      counter.textContent = original;
      return text.left >= frame.left - 1 && text.right <= frame.right + 1;
    }, formatCount.format(479_000))).toBe(true);
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

test('all hero counters grow from their server-rendered zero to the exact values', async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Keep scripting enabled, but simulate delayed styles and JavaScript at first paint.
  const assets = /\/_next\/static\/.*\.(?:css|js)(?:\?|$)/;
  await page.route(assets, (route) => route.abort());
  await page.goto('/en/');
  const metrics = ['catalog', 'clients', 'years'] as const;
  const initialValues = { catalog: '0', clients: '0+', years: '0 years' };
  for (const id of metrics) {
    await expect(page.getByTestId(`hero-stat-${id}`).locator('strong'))
      .toHaveText(initialValues[id], { useInnerText: true });
  }
  await expect(page.getByTestId('hero-stat-catalog').locator('strong')).toHaveAttribute('data-counter-target', '26');
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
    const expected = { catalog: 26, clients: 660, years: 23 };
    for (const id of metrics) {
      await expect(page.getByTestId(`hero-stat-${id}`).locator('[data-counter-value]'))
        .toHaveAttribute('data-counter-value', String(expected[id]));
    }
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
  const reducedValues = { catalog: '26', clients: '660+', years: '23 years' };
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
  await expect(plainCatalog).toHaveText('26', { useInnerText: true });
  await expect(plainCatalog.locator('[data-counter-value]')).toBeHidden();
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
