import { expect, test } from '@playwright/test';

const labels = { zh: '联系我们', en: 'Contact us', ru: 'Свяжитесь с нами' };
const links = {
  WhatsApp: 'https://wa.me/8618215932610',
  Telegram: 'https://t.me/HD_Auto_CN',
  Instagram: 'https://www.instagram.com/hongding_auto/',
  Facebook: 'https://www.facebook.com/HDAuto',
  TikTok: 'https://www.tiktok.com/@votton.louis?is_from_webapp=1&sender_device=pc',
};

test('a thirty-second prompt closes, restores scrolling and observes the repeat interval', async ({ page }) => {
  await page.clock.install({ time: 1_800_000_000_000 });
  await page.clock.pauseAt(1_800_000_001_000);
  await page.goto('/en/parts/');
  await expect(page.getByTestId('saved-parts-filter')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: labels.en });
  await page.clock.fastForward(29_999);
  await expect(dialog).not.toBeVisible();
  await page.clock.fastForward(1);
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect(dialog.getByRole('button', { name: 'Close contact window' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  const lastSeen = await page.evaluate(() => localStorage.getItem('hd-auto:enquiry-seen:v1'));
  expect(lastSeen).toMatch(/^\d+$/);
  await page.reload();
  await expect(page.getByTestId('saved-parts-filter')).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(dialog).not.toBeVisible();
  await page.locator('header a[aria-haspopup="dialog"]').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close contact window', exact: true }).click();
  await expect(page.locator('header a[aria-haspopup="dialog"]')).toBeFocused();
});

test('an active form and a vehicle consultation defer the automatic prompt', async ({ page }) => {
  await page.clock.install({ time: 1_800_000_000_000 });
  await page.clock.pauseAt(1_800_000_001_000);
  await page.goto('/en/parts/');
  await expect(page.getByTestId('saved-parts-filter')).toBeVisible();
  await page.locator('main input[name=q]').first().focus();
  await page.clock.fastForward(30_000);
  const dialog = page.getByRole('dialog', { name: labels.en });
  await expect(dialog).not.toBeVisible();
  await page.locator('main h1').click();
  await page.clock.fastForward(5000);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('hd-auto:enquiry-seen:v1'));
  await page.goto('/en/cars/fixture_car_2/');
  await expect(page.locator('main[data-public-vehicle-detail]')).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(dialog).not.toBeVisible();
  await page.locator('header a[aria-haspopup="dialog"]').click();
  await expect(dialog).toBeVisible();
});

test('contact icons open the configured social destinations without collecting details', async ({ page, context }) => {
  const outbound: string[] = [];
  await context.route(
    /^https:\/\/(?:wa\.me|t\.me|www\.(?:instagram|facebook|tiktok)\.com)\//,
    async (route) => {
      expect(route.request().method()).toBe('GET');
      outbound.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Social profile</title>' });
    },
  );
  await page.goto('/en/parts/');
  await page.locator('header a[aria-haspopup="dialog"]').click();
  const dialog = page.getByRole('dialog', { name: labels.en });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('form, input, textarea, select')).toHaveCount(0);
  expect(outbound).toEqual([]);

  for (const [platform, href] of Object.entries(links)) {
    const icon = dialog.getByRole('link', { name: platform, exact: true });
    await expect(icon).toHaveAttribute('href', href);
    await expect(icon).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(icon).toHaveText('');
    await expect(icon.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      icon.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe(href);
    await popup.close();
  }

  expect(outbound).toEqual(Object.values(links));
});

test('the contact trigger reaches the footer when JavaScript is disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/en/parts/');
    await page.locator('header a[aria-haspopup="dialog"]').click();
    await expect(page).toHaveURL(/#contact$/);
    const contacts = page.locator('footer#contact');
    await expect(contacts.getByRole('link', { name: /WhatsApp/ })).toBeVisible();
  } finally {
    await context.close();
  }
});

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: 320px contact window keeps the icons and close action within the screen`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`/${locale}/parts/`);
    await page.locator('header a[aria-haspopup="dialog"]').click();
    const dialog = page.getByRole('dialog', { name: labels[locale] });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320 - 32);
    expect(box!.height).toBeLessThanOrEqual(740 - 32);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const icons = dialog.getByRole('link');
    await expect(icons).toHaveCount(5);
    for (const icon of await icons.all()) {
      const hitArea = (await icon.boundingBox())!;
      expect(hitArea.width).toBeGreaterThanOrEqual(44);
      expect(hitArea.height).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole('button').first().click();
    await expect(dialog).not.toBeVisible();
  });
}
