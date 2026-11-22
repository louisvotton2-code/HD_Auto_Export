import { expect, test, type Page } from '@playwright/test';
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
const partsCatalogTotal = 48_689;

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
  const vehicleSection = page.locator('#home-vehicles');
  await expect(vehicleSection.getByTestId('home-catalog-error')).toBeVisible();
  await page.getByRole('link', { name: 'Scroll down', exact: true }).click();
  await expect(page).toHaveURL(/#home-vehicles$/);
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
    const partStat = page.getByTestId('hero-stat-parts');
    const parts = partStat.locator('strong');
    await expect(parts).toBeVisible();
    const displayedPartsTotal = formatCount.format(partsCatalogTotal);
    await expect(parts).toHaveText(displayedPartsTotal, { useInnerText: true });
    expect(await partStat.evaluate((item) => item.scrollWidth <= item.clientWidth + 1)).toBe(true);
    await expect(page.getByTestId('hero-stat-years').locator('strong'))
      .toHaveText(/23/, { useInnerText: true });
    const stats = page.getByTestId('hero-stats');
    const shortcuts = page.locator('#home-shortcuts');
    const cue = page.locator('a[href="#home-vehicles"]');
    await expect(cue).toBeVisible();
    const statsBox = (await stats.boundingBox())!;
    const shortcutsBox = (await shortcuts.boundingBox())!;
    const cueBox = (await cue.boundingBox())!;
    expect(shortcutsBox.y).toBeGreaterThanOrEqual(statsBox.y + statsBox.height - 1);
    expect(cueBox.y).toBeGreaterThanOrEqual(shortcutsBox.y + shortcutsBox.height - 1);
    expect(cueBox.x + cueBox.width / 2).toBeCloseTo(statsBox.x + statsBox.width / 2, 0);
    expect(browserReads).toEqual([]);

    await shortcuts.locator(`a[href="/${locale}/parts/"]`).click();
    const partsPageTotal = page
      .getByTestId('parts-catalog')
      .locator(`[data-counter-target="${partsCatalogTotal}"] [data-counter-value]`);
    await expect(partsPageTotal).toHaveText(displayedPartsTotal);
  });
}

test('all hero counters grow from their server-rendered zero to the exact values', async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Keep scripting enabled, but simulate delayed styles and JavaScript at first paint.
  const assets = /\/(?:_next\/static\/.*\.(?:css|js)|media\/home\/hero-counts\.js)(?:\?|$)/;
  await page.route(assets, (route) => route.abort());
  await page.goto('/en/');
  const metrics = ['catalog', 'parts', 'years'] as const;
  const initialValues = { catalog: '0', parts: '0', years: '0 years' };
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
    const expected = { catalog: 26, parts: partsCatalogTotal, years: 23 };
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
  // Start with a clean asset cache after intentionally aborting styles above.
  const reducedContext = await browser.newContext({
    reducedMotion: 'reduce',
    baseURL: new URL(page.url()).origin,
  });
  try {
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto('/en/');
    const reducedValues = { catalog: '26', parts: '48,689', years: '23 years' };
    for (const id of metrics) {
      const metric = reducedPage.getByTestId(`hero-stat-${id}`);
      await expect(metric.locator('strong')).toHaveText(reducedValues[id], { useInnerText: true });
      await expect(metric.locator('[data-counter-value]')).toBeHidden();
    }
  } finally {
    await reducedContext.close();
  }
  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: new URL(page.url()).origin,
  });
  const plain = await noScript.newPage();
  await plain.goto('/zh/');
  const plainParts = plain.getByTestId('hero-stat-parts');
  await expect(plainParts.locator('strong')).toHaveText('48,689', { useInnerText: true });
  await expect(plainParts.locator('[data-counter-value]')).toBeHidden();
  const plainCatalog = plain.getByTestId('hero-stat-catalog').locator('strong');
  await expect(plainCatalog).toHaveText('26', { useInnerText: true });
  await expect(plainCatalog.locator('[data-counter-value]')).toBeHidden();
  const plainYears = plain.getByTestId('hero-stat-years').locator('strong');
  await expect(plainYears).toHaveText(/^23\s*年$/, { useInnerText: true });
  // The inline grid can introduce a newline in innerText even when the unit stays beside the number.
  expect(await plainYears.evaluate((node) => {
    const count = node.querySelector('[data-counter-value] + span')!.getBoundingClientRect();
    const unit = node.lastElementChild!.getBoundingClientRect();
    return unit.left >= count.right - 1 && unit.top < count.bottom && unit.bottom > count.top;
  })).toBe(true);
  await noScript.close();
});

const homeCountScript = /\/media\/home\/hero-counts\.js(?:\?|$)/;
const nextScripts = /\/_next\/static\/.*\.js(?:\?|$)/;
const homeFonts = /\/fonts\/inter-(?:latin|cyrillic)\.woff2$/;

async function measureFirstPaint(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null) => {
      const { x, y, width, height } = element!.getBoundingClientRect();
      return [x, y, width, height];
    };
    return {
      stats: box(document.querySelector('[data-testid="hero-stats"]')),
      digits: box(document.querySelector('[data-hero-stat="parts"] strong')),
      unit: box(document.querySelector('[data-hero-stat="years"] strong > span:last-child')),
      cards: [...document.querySelectorAll('#home-shortcuts a')].map((card) => {
        const text = document.createRange();
        text.selectNodeContents(card.querySelector('strong')!);
        return { frame: box(card), titleWidth: text.getBoundingClientRect().width };
      }),
    };
  });
}

test('the homepage counts before hydration and keeps the first paint stable under slow fonts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat|react error #(?:418|423|425)/i.test(message.text())) errors.push(message.text());
  });
  let allowCount!: () => void;
  let allowFonts!: () => void;
  let allowNext!: () => void;
  const countGate = new Promise<void>((resolve) => { allowCount = resolve; });
  const fontsGate = new Promise<void>((resolve) => { allowFonts = resolve; });
  const nextGate = new Promise<void>((resolve) => { allowNext = resolve; });
  await page.route(homeCountScript, async (route) => { await countGate; await route.continue(); });
  await page.route(homeFonts, async (route) => { await fontsGate; await route.continue(); });
  await page.route(nextScripts, async (route) => { await nextGate; await route.continue(); });
  try {
    await page.goto('/ru/', { waitUntil: 'domcontentloaded' });
    const number = page.getByTestId('hero-stat-catalog').locator('[data-counter-value]');
    await expect(number).toHaveText('0');
    const firstPaint = await measureFirstPaint(page);
    allowCount();
    await expect(number).toHaveText('26', { timeout: 1500 });
    expect(await measureFirstPaint(page)).toEqual(firstPaint);

    allowFonts();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.evaluate(() => {
      const catalog = document.querySelector('[data-hero-stat="catalog"] [data-counter-value]')!;
      const cards = [...document.querySelectorAll('#home-shortcuts a')];
      const observations = { rewound: false, cardAnimated: false };
      Reflect.set(window, '__homeHydrationObservations', observations);
      const observer = new MutationObserver(() => {
        if (!catalog.isConnected || catalog.textContent !== '26') observations.rewound = true;
      });
      observer.observe(document.querySelector('[data-testid="hero-stats"]')!, { subtree: true, childList: true, characterData: true });
      cards.forEach((card) => card.addEventListener('animationstart', () => { observations.cardAnimated = true; }));
    });
    allowNext();
    await expect(page.locator('[data-home-section="hero"]')).toHaveAttribute('style', /--drive-progress/);
    expect(await measureFirstPaint(page)).toEqual(firstPaint);
    expect(await page.evaluate(() => Reflect.get(window, '__homeHydrationObservations'))).toEqual({
      rewound: false, cardAnimated: false,
    });
    expect(errors).toEqual([]);
  } finally {
    allowCount();
    allowFonts();
    allowNext();
  }
});

test('a delayed counter asset reveals the real numbers and does not rewind on arrival', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  let allowCount!: () => void;
  const countGate = new Promise<void>((resolve) => { allowCount = resolve; });
  await page.route(homeCountScript, async (route) => { await countGate; await route.continue(); });
  try {
    await page.goto('/zh/', { waitUntil: 'domcontentloaded' });
    const stat = page.getByTestId('hero-stat-parts');
    const counter = stat.locator('[data-counter-value]');
    await expect(stat.locator('strong')).toHaveText('48,689', { useInnerText: true });
    await expect(counter).toBeHidden();
    allowCount();
    await expect(counter).toHaveText('48,689');
    await expect(stat.locator('strong')).toHaveText('48,689', { useInnerText: true });
  } finally {
    allowCount();
  }
});

test('a slow foreground refresh still animates when the counter script arrives after the old deadline', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/zh/');
  await expect(page.getByTestId('hero-stat-parts').locator('[data-counter-value]')).toHaveText('48,689');
  await page.addInitScript(() => {
    const values: number[] = [];
    Reflect.set(window, '__refreshedHomeCount', values);
    new MutationObserver(() => {
      const value = document.querySelector('[data-hero-stat="parts"] [data-counter-value]')?.getAttribute('data-counter-value');
      if (value != null && values.at(-1) !== Number(value)) values.push(Number(value));
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  let allowCount!: () => void;
  const gate = new Promise<void>((resolve) => { allowCount = resolve; });
  await page.route(homeCountScript, async (route) => { await gate; await route.continue(); });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 1000)));
    const stat = page.getByTestId('hero-stat-parts');
    await expect(stat.locator('strong')).toHaveText('0', { useInnerText: true });
    allowCount();
    await expect(stat.locator('[data-counter-value]')).toHaveText('48,689');
    const values = await page.evaluate(() => Reflect.get(window, '__refreshedHomeCount') as number[]);
    expect(values[0]).toBe(0);
    expect(values.filter((value) => value > 0 && value < 48_689).length).toBeGreaterThan(2);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
  } finally {
    allowCount();
  }
});

test('the counters work when opening the homepage through a site link for the first time', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/parts/');
  expect(await page.evaluate(() => Boolean(customElements.get('hd-home-count')))).toBe(false);
  await page.evaluate(() => { Reflect.set(window, '__sameNavigationDocument', true); });
  await page.locator('a.hd-brand[href="/en/"]').click();
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.getByTestId('hero-stat-parts').locator('[data-counter-value]')).toHaveText('48,689');
  expect(await page.evaluate(() => Reflect.get(window, '__sameNavigationDocument'))).toBe(true);
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
