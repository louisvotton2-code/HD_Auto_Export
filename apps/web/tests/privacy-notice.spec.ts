import { expect, test } from '@playwright/test';

for (const [locale, width, height, policyTitle, windowText] of [
  ['zh', 320, 568, '隐私说明', '60 分钟'],
  ['en', 1440, 900, 'Privacy notice', '60 minutes'],
  ['ru', 320, 300, 'Конфиденциальность', '60 минут'],
] as const) {
  test(`${locale}: the footer opens the seven-section privacy page`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/${locale}/about/`);
    await page.locator(`footer a[href="/${locale}/privacy/"]`).click();
    const policy = page.getByTestId('privacy-page');
    await expect(policy.getByRole('heading', { level: 1, name: policyTitle })).toBeVisible();
    await expect(policy.getByRole('heading', { level: 2 })).toHaveCount(7);
    await expect(policy).toContainText(windowText);
    await expect(policy).toContainText(/\bIP\b/);
    await expect(policy).toContainText('Facebook Pixel');
    await expect(policy).toContainText('WhatsApp');
    await expect(policy).not.toContainText(/Google Analytics|Microsoft Clarity/i);
    await expect(policy.locator('a[href="https://wa.me/8618215932610"]')).toBeVisible();
    await expect(policy.locator('a[href="https://t.me/HD_Auto_CN"]')).toBeVisible();
    await expect(policy.locator('form, input, [role="switch"]')).toHaveCount(0);
    await expect(page.locator('footer button[aria-haspopup="dialog"]')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('mobile calculator action stays accessible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/zh/calculator/russia/');
  const action = page.locator('.mobile-result-bar').getByRole('button');
  await expect(action).toBeInViewport();
  await action.click();
});

test('manual contact opens Telegram', async ({ page, context }) => {
  await context.route('https://t.me/HD_Auto_CN', route =>
    route.fulfill({ contentType: 'text/plain', body: 'Contact link intercepted locally' }));
  await page.goto('/en/parts/');
  const contact = page.locator('header a[aria-haspopup="dialog"]:visible');
  const dialog = page.getByRole('dialog', { name: 'Contact us' });
  await contact.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close contact window' }).click();
  await expect(dialog).toBeHidden();
  await contact.click();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    dialog.getByRole('link', { name: 'Telegram', exact: true }).click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toBe('https://t.me/HD_Auto_CN');
  await popup.close();
});
