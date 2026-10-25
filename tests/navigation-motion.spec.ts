import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
});

async function openCalculator(page: Page, country = 'russia', locale = 'zh') {
  await page.goto(`/${locale}/calculator/${country}/`);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.getByTestId('total')).toBeVisible();
}

test('header, footer, guide and country links address final static pages directly', async ({
  page,
}) => {
  await page.goto('/zh/buy/');
  for (const link of await page.locator('a[href^="/zh/calculator"]').all()) {
    await expect(link).toHaveAttribute('href', '/zh/calculator/russia/');
  }
  for (const link of await page.locator('a[href^="/zh/buy"]').all()) {
    await expect(link).toHaveAttribute('href', '/zh/buy/');
  }

  await openCalculator(page);
  const countries = page.locator('.country-nav a');
  await expect(countries).toHaveCount(7);
  for (const link of await countries.all()) {
    await expect(link).toHaveAttribute('href', /^\/zh\/calculator\/[a-z]+\/$/);
  }
});

test('hydrated country and header navigation preserve the document and the editable draft', async ({
  page,
}) => {
  await openCalculator(page);
  await page.locator('#price').fill('215000');
  await page.locator('#displacementCc').fill('1700');
  await page.evaluate(() => Reflect.set(window, '__hdNavigationDocument', 'original'));
  const documents: string[] = [];
  const entryRequests: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documents.push(request.url());
    }
    if (/\/zh\/calculator\/(?:index\.txt)?$/.test(new URL(request.url()).pathname)) {
      entryRequests.push(request.url());
    }
  });

  await page.locator('.country-nav a[href="/zh/calculator/kazakhstan/"]').click();
  await expect(page).toHaveURL(/\/zh\/calculator\/kazakhstan\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#price')).toHaveValue('215000');
  await expect(page.locator('#displacementCc')).toHaveValue('1700');

  await page.locator('.main-nav a[href="/zh/buy/"]').click();
  await expect(page).toHaveURL(/\/zh\/buy\/$/);
  await expect(page.getByTestId('buy-guide')).toBeVisible();
  await page.locator('.main-nav a[href="/zh/calculator/russia/"]').click();
  await expect(page).toHaveURL(/\/zh\/calculator\/russia\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#price')).toHaveValue('215000');
  await expect(page.locator('#displacementCc')).toHaveValue('1700');
  expect(await page.evaluate(() => Reflect.get(window, '__hdNavigationDocument'))).toBe('original');
  expect(documents).toEqual([]);
  expect(entryRequests).toEqual([]);
});

test('language navigation retains the country, importer and manual draft while using final URLs', async ({
  page,
}) => {
  await openCalculator(page, 'kyrgyzstan');
  await page.locator('#importerType').selectOption('company');
  await page.locator('#price').fill('215000');
  await page.locator('#transactionRate').fill('12');
  const language = page.locator('.language-switch a[href="/ru/calculator/kyrgyzstan/"]');
  await expect(language).toHaveAttribute('href', '/ru/calculator/kyrgyzstan/');
  await language.click();
  await expect(page).toHaveURL(/\/ru\/calculator\/kyrgyzstan\/$/);
  await expect(page.locator('.reset-button')).toBeEnabled();
  await expect(page.locator('#importerType')).toHaveValue('company');
  await expect(page.locator('#price')).toHaveValue('215000');
  await expect(page.locator('#transactionRate')).toHaveValue('12');
  await expect(page.locator('.language-switch a[aria-current="page"]')).toHaveText('RU');
});

test('an unfinished route shows inline feedback without blocking the current calculator', async ({
  page,
}) => {
  let release = () => {};
  const heldResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldRequests = 0;
  await page.route(
    (url) => url.pathname.startsWith('/zh/buy/') && url.pathname.endsWith('.txt'),
    async (route) => {
      heldRequests++;
      await heldResponse;
      await route.continue();
    },
  );
  try {
    await openCalculator(page);
    const buyLink = page.locator('.main-nav a[href="/zh/buy/"]');
    const before = await buyLink.boundingBox();
    await buyLink.click();
    await expect.poll(() => heldRequests).toBeGreaterThan(0);
    await expect(buyLink.locator('.navigation-hint')).toHaveAttribute('data-pending', 'true');
    await expect(buyLink.getByRole('status')).not.toBeEmpty();
    await expect(page).toHaveURL(/\/zh\/calculator\/russia\/$/);
    // The pending indicator occupies no new space and never covers the form.
    const pending = await buyLink.boundingBox();
    expect(before).not.toBeNull();
    expect(pending).not.toBeNull();
    expect(Math.abs(pending!.width - before!.width)).toBeLessThanOrEqual(1);
    await page.locator('#price').fill('225000');
    await expect(page.locator('#price')).toHaveValue('225000');
    await expect(page.getByTestId('total')).toBeVisible();

    release();
    await expect(page).toHaveURL(/\/zh\/buy\/$/);
    await expect(page.getByTestId('buy-guide')).toBeVisible();
    await expect(page.locator('.navigation-hint[data-pending="true"]')).toHaveCount(0);
  } finally {
    release();
  }
});

test('rapidly reversing a fee disclosure keeps the latest state and both currency amounts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCalculator(page, 'uzbekistan');
  const row = page.locator('.fee-line').first();
  const toggle = row.getByTestId('fee-detail-toggle');
  const panelId = await toggle.getAttribute('aria-controls');
  const panel = page.locator(`[id="${panelId}"]`);
  const amounts = await row.locator('.fee-values').innerText();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Deliberately avoid waiting for the current transition to settle between clicks.
  await toggle.dispatchEvent('click');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect(panel).toHaveAttribute('inert', '');
  await toggle.dispatchEvent('click');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).not.toHaveAttribute('hidden');
  await expect(panel).not.toHaveAttribute('inert');
  await expect(panel).not.toHaveAttribute('aria-hidden', 'true');
  await expect(row.getByTestId('fee-method')).toBeVisible();
  await expect(toggle).toBeFocused();
  await expect(row.locator('.fee-values')).toHaveText(amounts, { useInnerText: true });
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveAttribute('hidden', '');
  await expect(panel).toBeHidden();
  await expect(row.locator('.fee-values')).toHaveText(amounts, { useInnerText: true });
});

test('reduced motion keeps route, result and disclosure interactions immediately usable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCalculator(page, 'uzbekistan');
  await page.locator('#price').fill('215000');
  const toggle = page.getByTestId('fee-detail-toggle').first();
  const panelId = await toggle.getAttribute('aria-controls');
  const panel = page.locator(`[id="${panelId}"]`);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveAttribute('hidden', '');
  await page.locator('.advanced-settings summary').click();
  await expect(page.locator('#transactionRate')).toBeHidden();
  await page.locator('.main-nav a[href="/zh/buy/"]').click();
  await expect(page.getByTestId('buy-guide')).toBeVisible();
  const faq = page.getByTestId('buy-faq').locator('details').first();
  await faq.locator('summary').click();
  await expect(faq).toHaveAttribute('open', '');
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === 'running').length,
    ),
  ).toBe(0);
});

for (const touch of [false, true]) {
  test(`${touch ? 'touch' : 'desktop'} header stays above scrolled content without selecting utility links`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      hasTouch: touch,
      isMobile: touch,
      viewport: { width: touch ? 390 : 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    try {
      await page.goto('/ru/buy/');
      const header = page.locator('.hd-header');
      const utilities = header.locator('.nav-utility');
      await expect(utilities).toHaveCount(2);
      for (const link of await utilities.all()) {
        await expect(link).not.toHaveAttribute('aria-current');
        const initialColor = await link.evaluate((node) => getComputedStyle(node).color);
        if (touch) await link.dispatchEvent('pointerover', { pointerType: 'touch' });
        else await link.hover();
        await expect(link).toHaveCSS('color', initialColor);
        expect(await link.evaluate((node) => getComputedStyle(node, '::after').content)).toBe(
          'none',
        );
      }
      await page.evaluate(() => window.scrollTo(0, 900));
      await expect.poll(() => header.evaluate((node) => node.getBoundingClientRect().top)).toBe(0);
      await expect(header).toBeInViewport();
      const contact = header.locator('a[href="#contact"]');
      if (touch) await contact.tap();
      else await contact.click();
      await expect(page).toHaveURL(/#contact$/);
      await expect
        .poll(() =>
          page.locator('#contact-title').evaluate((node) => node.getBoundingClientRect().top),
        )
        .toBeGreaterThan(await header.evaluate((node) => node.getBoundingClientRect().bottom));
      await contact.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(contact).toBeFocused();
      await expect(contact).toHaveCSS('outline-style', 'solid');
      await expect(header.locator('.main-nav [aria-current="page"]')).toHaveText(/Как купить/);
      await header.locator('.main-nav a[href="/ru/calculator/russia/"]').click();
      await expect(page.locator('.reset-button')).toBeEnabled();
      await page.evaluate(() => window.scrollTo(0, 900));
      await expect.poll(() => header.evaluate((node) => node.getBoundingClientRect().top)).toBe(0);
      // A tall result column naturally scrolls out with its grid container. Verify the
      // actual jump target instead: scrolling to the result must leave its title visible.
      await page.locator('.result-card').evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await expect
        .poll(() => page.locator('.result-card').evaluate((node) => node.getBoundingClientRect().top))
        .toBeGreaterThan(await header.evaluate((node) => node.getBoundingClientRect().bottom));
    } finally {
      await context.close();
    }
  });
}
