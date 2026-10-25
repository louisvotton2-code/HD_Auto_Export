import { expect, test, type Page } from '@playwright/test';

const locales = ['zh', 'en', 'ru'] as const;

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

for (const locale of locales) {
  test(`${locale}: buying guide is an independent static page with the deposit, both delivery terms and localized SEO`, async ({
    page,
    request,
  }) => {
    const route = `/${locale}/buy/`;
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const html = await response.text();
    const mainHtml = html.match(/<main\b[^>]*data-testid="buy-guide"[^>]*>[\s\S]*?<\/main>/)?.[0];
    expect(mainHtml).toBeTruthy();
    // Assert the exported document, before any browser hydration or client navigation.
    expect(mainHtml!.match(/<li\b[^>]*data-testid="buy-step"/g)).toHaveLength(8);
    expect(mainHtml).toMatch(/data-testid="buy-deposit"/);
    expect(mainHtml).toMatch(/500/);
    expect(mainHtml).toMatch(/USD/);
    expect(mainHtml).toMatch(/data-testid="shipping-cif"/);
    expect(mainHtml).toMatch(/data-testid="shipping-fob"/);
    expect(mainHtml).toMatch(/CIF/);
    expect(mainHtml).toMatch(/FOB/);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    expect((await page.goto(route))?.status()).toBe(200);
    const guide = page.getByTestId('buy-guide');
    await expect(guide).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute(
      'lang',
      locale === 'zh' ? 'zh-Hans' : locale,
    );
    await expect(page.getByTestId('buy-step')).toHaveCount(8);
    await expect(page.getByTestId('buy-deposit')).toContainText('500');
    await expect(page.getByTestId('buy-deposit')).toContainText('USD');
    for (const term of ['cif', 'fob']) {
      const section = page.getByTestId(`shipping-${term}`);
      await expect(section).toContainText(term.toUpperCase());
      // Each option needs its own explanation, rather than only a shipping acronym.
      expect((await section.innerText()).trim().length).toBeGreaterThan(30);
    }
    await expect(guide).not.toContainText(/BuyingGuide\.|\{\w+\}/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/buy/?$`),
    );
    for (const alternate of locales) {
      await expect(
        page.locator(
          `link[rel="alternate"][hreflang="${alternate === 'zh' ? 'zh-Hans' : alternate}"]`,
        ),
      ).toHaveAttribute('href', new RegExp(`/${alternate}/buy/?$`));
    }
    expect((await page.reload())?.status()).toBe(200);
    await expect(guide).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('buying navigation stays on this page when switching languages and leads to the existing calculator', async ({
  page,
}) => {
  await page.goto('/zh/buy/');
  const main = page.getByTestId('buy-guide');
  await expect(main.locator('a[href="https://wa.me/8618215932610"]').first()).toBeVisible();
  await expect(main.locator('a[href^="/zh/calculator"]').first()).toBeVisible();

  for (const locale of ['en', 'ru', 'zh'] as const) {
    await page.locator(`.language-switch a[href^="/${locale}/buy"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/buy/?$`));
    await expect(page.getByTestId('buy-guide')).toBeVisible();
    await expect(page.locator(`.main-nav a[href^="/${locale}/buy"]`)).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator(`.main-nav a[href^="/${locale}/calculator"]`)).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('.main-nav a[aria-current="page"]')).toHaveCount(1);
  }

  await main.locator('a[href^="/zh/calculator"]').first().click();
  await expect(page).toHaveURL(/\/zh\/calculator\/russia\/?$/);
  await expect(page.locator('.main-nav a[href^="/zh/calculator"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.main-nav a[href^="/zh/buy"]')).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('buying FAQ supports independent native keyboard disclosure', async ({ page }) => {
  await page.goto('/en/buy/');
  const faq = page.getByTestId('buy-faq');
  const details = faq.locator('details');
  await expect(details).toHaveCount(4);
  await expect(faq.locator('summary')).toHaveCount(4);
  for (const detail of await details.all()) await expect(detail).not.toHaveAttribute('open', '');

  const firstSummary = details.first().locator('summary');
  await firstSummary.focus();
  await page.keyboard.press('Enter');
  await expect(details.first()).toHaveAttribute('open', '');
  await expect(firstSummary).toBeFocused();
  await expect(details.nth(1)).not.toHaveAttribute('open', '');
  await details.nth(1).locator('summary').click();
  await expect(details.first()).toHaveAttribute('open', '');
  await expect(details.nth(1)).toHaveAttribute('open', '');
  await firstSummary.focus();
  await page.keyboard.press('Space');
  await expect(details.first()).not.toHaveAttribute('open', '');
  await expect(details.nth(1)).toHaveAttribute('open', '');
});

test('without JavaScript, buying content, FAQ, language links and calculator links remain usable', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/zh/buy/');
    for (const locale of locales) {
      if (locale !== 'zh') {
        await page.locator(`.language-switch a[href^="/${locale}/buy"]`).click();
      }
      await expect(page).toHaveURL(new RegExp(`/${locale}/buy/?$`));
      await expect(page.getByTestId('buy-step')).toHaveCount(8);
      await expect(page.getByTestId('buy-deposit')).toContainText('500');
      const details = page.getByTestId('buy-faq').locator('details').first();
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
      await details.locator('summary').click();
      await expect(details).not.toHaveAttribute('open', '');
      await expect(
        page.getByTestId('buy-guide').locator(`a[href^="/${locale}/calculator"]`).first(),
      ).toBeVisible();
    }
    const calculatorLink = page
      .getByTestId('buy-guide')
      .locator('a[href^="/ru/calculator"]')
      .first();
    // Public navigation points at the actual HTML, without a scripted entry hop.
    await expect(calculatorLink).toHaveAttribute('href', '/ru/calculator/russia/');
    await calculatorLink.click();
    await expect(page).toHaveURL(/\/ru\/calculator\/russia\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  } finally {
    await context.close();
  }
});

for (const width of [360, 390, 820]) {
  test(`${width}px Russian buying guide and navigation fit the viewport, including expanded FAQ`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/ru/buy/');
    await expect(page.getByTestId('buy-guide')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    for (const summary of await page.getByTestId('buy-faq').locator('summary').all()) {
      await summary.click();
    }
    await expect(page.getByTestId('buy-faq').locator('details[open]')).toHaveCount(4);
    await expectNoHorizontalOverflow(page);

    const calculatorLink = page.locator('.main-nav a[href^="/ru/calculator"]');
    await expect(calculatorLink).toBeVisible();
    await calculatorLink.click();
    await expect(page).toHaveURL(/\/ru\/calculator\/russia\/?$/);
    const buyLink = page.locator('.main-nav a[href^="/ru/buy"]');
    await expect(buyLink).toBeVisible();
    await buyLink.click();
    await expect(page).toHaveURL(/\/ru\/buy\/?$/);
    await expect(page.getByTestId('buy-guide')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
