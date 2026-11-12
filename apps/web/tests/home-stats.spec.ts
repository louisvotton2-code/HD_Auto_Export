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

for (const locale of ['zh', 'en', 'ru']) {
  test(`${locale}: hero uses the whole API catalog total and confirmed company metrics`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/${locale}/`);
    const response = await request.get(
      `/api/v1/vehicles/?catalog=curated&locale=${locale}&page=1&pageSize=1`,
    );
    expect(response.status()).toBe(200);
    const list = await response.json();
    const catalog = page.getByTestId('hero-stat-catalog');
    await expect(catalog.locator('[data-counter-value]')).toHaveAttribute(
      'data-counter-value',
      String(list.meta.total),
    );
    const cards = await page.locator('[data-home-section^="vehicles-"] article').count();
    expect(list.meta.total).toBeGreaterThan(cards);
    await expect(page.getByTestId('hero-stat-clients')).toContainText('660+');
    await expect(page.getByTestId('hero-stat-years').locator('[data-counter-value]')).toHaveText(
      '23',
    );
    if (locale === 'zh') await expect(catalog).toContainText('目录中的汽车');
  });
}

test('refresh animates the first two counters while reduced motion and SSR retain readable values', async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const observed: number[] = [];
    const catalogObserved: number[] = [];
    Reflect.set(window, '__counterObservations', observed);
    Reflect.set(window, '__catalogCounterObservations', catalogObserved);
    const collect = () => {
      const value = document
        .querySelector('[data-testid="hero-stat-clients"] [data-counter-value]')
        ?.getAttribute('data-counter-value');
      if (value !== null && value !== undefined) observed.push(Number(value));
      const catalog = document
        .querySelector('[data-testid="hero-stat-catalog"] [data-counter-value]')
        ?.getAttribute('data-counter-value');
      if (catalog !== null && catalog !== undefined) catalogObserved.push(Number(catalog));
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
    await expect
      .poll(() =>
        page.evaluate(() => {
          const target = Number(
            document
              .querySelector('[data-testid="hero-stat-catalog"] [data-counter-target]')
              ?.getAttribute('data-counter-target'),
          );
          return (Reflect.get(window, '__catalogCounterObservations') as number[]).some(
            (n) => n > 0 && n < target,
          );
        }),
      )
      .toBe(true);
    await expect(clients.locator('[data-counter-value]')).toHaveAttribute(
      'data-counter-value',
      '660',
    );
    await expect(
      page.getByTestId('hero-stat-years').locator('[data-counter-value]'),
    ).toHaveAttribute('data-counter-value', '23');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByTestId('hero-stat-clients').locator('[data-counter-value]')).toHaveText(
    '660',
  );
  await page.waitForFunction(() => {
    const canvas = document.querySelector(
      '[data-testid="hero-ripple-canvas"]',
    ) as HTMLCanvasElement | null;
    return !!canvas && canvas.width !== 300;
  });
  expect(
    await page.evaluate(
      () =>
        (Reflect.get(window, '__counterObservations') as number[]).length > 0 &&
        (Reflect.get(window, '__counterObservations') as number[]).every((value) => value === 660),
    ),
  ).toBe(true);
  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: new URL(page.url()).origin,
  });
  const plain = await noScript.newPage();
  await plain.goto('/zh/');
  await expect(plain.getByTestId('hero-stat-clients')).toContainText('660+');
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
