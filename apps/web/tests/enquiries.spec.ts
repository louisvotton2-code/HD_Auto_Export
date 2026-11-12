import { expect, test } from '@playwright/test';

const labels = { zh: '留下咨询信息', en: 'Leave a Request', ru: 'Оставить заявку' };

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
  await expect(dialog.getByLabel('Your name', { exact: true })).toBeFocused();
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
  await dialog.getByRole('button', { name: 'Close enquiry', exact: true }).click();
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

test('enquiry submission opens the selected HD chat with the visitors details and local page', async ({ page, context }) => {
  await context.route(/https:\/\/(wa\.me|t\.me)\//, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Contact draft</title>' });
  });
  await page.goto('/en/parts/');
  await page.locator('header a[aria-haspopup="dialog"]').click();
  const dialog = page.getByRole('dialog', { name: labels.en });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Your name', { exact: true }).fill('Иван & HD');
  await dialog.getByLabel('Phone number', { exact: true }).fill('+7 999 123 4567');
  await dialog.getByLabel('Comment or car model', { exact: true }).fill('Volkswagen · OEM 52910K2200');
  for (const platform of ['whatsapp', 'telegram'] as const) {
    await dialog.getByRole('radio', { name: platform === 'whatsapp' ? 'WhatsApp' : 'Telegram', exact: true }).check();
    if (platform === 'telegram') await dialog.getByLabel('Telegram username', { exact: true }).fill('@ivan');
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      dialog.getByRole('button', { name: 'Open enquiry draft', exact: true }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    const href = new URL(popup.url());
    expect(href.origin + href.pathname).toBe(platform === 'whatsapp' ? 'https://wa.me/8618215932610' : 'https://t.me/HD_Auto_CN');
    expect(href.searchParams.get('text')).toContain('Иван & HD');
    expect(href.searchParams.get('text')).toContain('+7 999 123 4567');
    expect(href.searchParams.get('text')).toContain('Volkswagen · OEM 52910K2200');
    expect(href.searchParams.get('text')).toContain('/en/parts/');
    if (platform === 'telegram') expect(href.searchParams.get('text')).toContain('@ivan');
    await popup.close();
  }
  const stored = await page.evaluate(() => Object.entries(localStorage).join(' '));
  expect(stored).not.toContain('Иван');
  expect(stored).not.toContain('+7 999');
  await expect(dialog).not.toContainText(/sent successfully|request received/i);
});

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: 320px enquiry keeps its fields, contact choices and close action within the screen`, async ({ page }) => {
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
    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await dialog.getByRole('button').first().click();
    await expect(dialog).not.toBeVisible();
  });
}
