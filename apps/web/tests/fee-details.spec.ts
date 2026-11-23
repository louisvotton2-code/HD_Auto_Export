import { fillNumericDate } from './helpers/numeric-date';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T04:00:00Z'));
});

async function openCalculator(page: Page, country = 'uzbekistan', locale = 'zh') {
  await page.goto(`/${locale}/calculator/${country}/`);
  await expect(page.locator('.reset-button')).toBeEnabled();
  if (await page.locator('#manufactureDate').count()) await fillNumericDate(page, 'manufactureDate', '2021-01');
  await expect(page.getByTestId('total')).toBeVisible();
}

async function expectAllClosed(page: Page) {
  const toggles = page.getByTestId('fee-detail-toggle');
  expect(await toggles.count()).toBeGreaterThan(0);
  for (const toggle of await toggles.all()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panelId = await toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"]`)).toBeHidden();
  }
  await expect(page.locator('.fee-method-panel:not([hidden])')).toHaveCount(0);
}

for (const labels of [
  { locale: 'zh', expand: '全部展开', collapse: '全部收起', detail: '计算详情', hide: '收起详情' },
  {
    locale: 'en',
    expand: 'Expand all',
    collapse: 'Collapse all',
    detail: 'Calculation details',
    hide: 'Hide details',
  },
  {
    locale: 'ru',
    expand: 'Развернуть всё',
    collapse: 'Свернуть всё',
    detail: 'Как рассчитано',
    hide: 'Скрыть расчёт',
  },
]) {
  test(`${labels.locale}: quote details start collapsed with translated global and individual controls`, async ({
    page,
  }) => {
    await openCalculator(page, 'uzbekistan', labels.locale);
    await expectAllClosed(page);
    const all = page.getByTestId('toggle-all-fee-details');
    await expect(all).toHaveText(labels.expand);
    await expect(all).toHaveAttribute('aria-expanded', 'false');
    const first = page.getByTestId('fee-detail-toggle').first();
    await expect(first).toHaveAccessibleName(new RegExp(labels.detail));
    await first.click();
    await expect(first).toHaveAccessibleName(new RegExp(labels.hide));
    await expect(all).toHaveText(labels.expand);
    await all.click();
    await expect(all).toHaveText(labels.collapse);
    await expect(all).toHaveAttribute('aria-expanded', 'true');
    for (const panel of await page.locator('.fee-method-panel').all()) {
      await expect(panel).toBeVisible();
    }
    await all.click();
    await expectAllClosed(page);
    await expect(all).toHaveText(labels.expand);
    await expect(page.locator('.result-card')).not.toContainText(/FeeDisplay\.|\{\w+\}/);
  });
}

test('a single fee toggles with Enter and Space without changing other fees or either currency amount', async ({
  page,
}) => {
  await openCalculator(page);
  const rows = page.locator('.fee-line');
  const first = rows.first();
  const toggle = first.getByTestId('fee-detail-toggle');
  const amountBefore = await first.locator('.fee-values').innerText();
  expect(amountBefore).toMatch(/UZS[\s\S]*USD/);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(first.getByTestId('fee-method')).toBeVisible();
  await expect(first.getByTestId('fee-formula')).toBeVisible();
  await expect(rows.nth(1).getByTestId('fee-detail-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(first.getByTestId('fee-method')).toBeHidden();
  await expect(first.locator('.fee-values')).toHaveText(amountBefore, { useInnerText: true });
  for (const row of await rows.all()) {
    await expect(row.locator('.fee-values')).toBeVisible();
    await expect(row.getByTestId('fee-usd')).toContainText('USD');
  }
});

test('expand all includes excluded additional fees and returns to expand all after an individual fee is closed', async ({
  page,
}) => {
  await openCalculator(page, 'kyrgyzstan', 'en');
  const extra = page.getByTestId('additional-costs').locator('.fee-line');
  await expect(extra).toHaveCount(1);
  await expectAllClosed(page);
  const all = page.getByTestId('toggle-all-fee-details');
  await all.click();
  await expect(extra.getByTestId('fee-method')).toBeVisible();
  await expect(extra.getByTestId('fee-formula')).toBeVisible();
  await expect(extra.getByTestId('fee-method')).toContainText('excluded');
  await expect(all).toHaveText('Collapse all');
  await extra.getByTestId('fee-detail-toggle').click();
  await expect(extra.getByTestId('fee-method')).toBeHidden();
  await expect(all).toHaveText('Expand all');
  await expect(page.locator('.fee-lines').getByTestId('fee-method').first()).toBeVisible();
  await all.click();
  await expect(extra.getByTestId('fee-method')).toBeVisible();
  await all.click();
  await expectAllClosed(page);
});

test('expanded details recalculate branch explanations and formulas while a collapsed row never exposes stale text', async ({
  page,
}) => {
  await openCalculator(page, 'armenia');
  await page.locator('.currency-select').selectOption('USD');
  await page.locator('#price').fill('100');
  await page.locator('#transactionRate').fill('1');
  await page.locator('#euroRate').fill('1');
  await fillNumericDate(page, 'manufactureDate', '2025-01');
  await page.locator('#displacementCc').fill('100');
  const duty = page
    .locator('.fee-line')
    .filter({ has: page.locator('[data-method-key="AM.unifiedYoung"]') });
  const toggle = duty.getByTestId('fee-detail-toggle');
  const explanation = duty.locator('.fee-method-description');
  const formula = duty.getByTestId('fee-formula').locator('code');
  const amount = duty.locator('.fee-values strong');
  await toggle.click();
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText('按 54% 得 54 EUR');
  await expect(formula).toContainText('250 AMD');
  await expect(amount).toHaveText(/^250(?:\.00)? AMD$/);
  await page.locator('#price').fill('8000');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(explanation).toContainText('按 54% 得 4,320 EUR');
  await expect(formula).toContainText('4,320 AMD');
  await expect(amount).toHaveText(/^4,320(?:\.00)? AMD$/);
  await toggle.click();
  await page.locator('#price').fill('100');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(explanation).toBeHidden();
  await expect(amount).toHaveText(/^250(?:\.00)? AMD$/);
  await toggle.click();
  await expect(explanation).toContainText('按 54% 得 54 EUR');
  await expect(explanation).not.toContainText('4,320 EUR');
  await expect(formula).toContainText('250 AMD');
  await expect(formula).not.toContainText('4,320 AMD');
  await fillNumericDate(page, 'manufactureDate', '2022-01');
  const used = page.locator('[data-method-key="AM.unifiedUsed"]');
  await expect(used).toBeVisible();
  await expect(used.getByTestId('fee-formula').locator('code')).toContainText('100 × 1.5 × 1 = 150 AMD');
  await expect(page.locator('[data-method-key="AM.unifiedYoung"]')).toHaveCount(0);
});

test('reset and destination changes close all details, and invalid input removes the old controls and explanations', async ({
  page,
}) => {
  await openCalculator(page);
  await page.getByTestId('toggle-all-fee-details').click();
  await page.locator('.reset-button').click();
  await fillNumericDate(page, 'manufactureDate', '2021-01');
  await expectAllClosed(page);
  await page.getByTestId('toggle-all-fee-details').click();
  await openCalculator(page, 'armenia');
  await expectAllClosed(page);
  await page.getByTestId('toggle-all-fee-details').click();
  await page.locator('#price').fill('');
  await expect(page.getByTestId('total')).toHaveCount(0);
  await expect(page.getByTestId('toggle-all-fee-details')).toHaveCount(0);
  await expect(page.getByTestId('fee-detail-toggle')).toHaveCount(0);
  await expect(page.getByTestId('fee-method')).toHaveCount(0);
});

test('360px Russian quote stays within the viewport with all details closed, individual and all details open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await openCalculator(page, 'armenia', 'ru');
  async function expectNoOverflow() {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1);
    for (const control of await page.getByTestId('fee-detail-toggle').all()) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(361);
      await expect(control.getByTestId('fee-usd')).toBeVisible();
    }
  }
  await expectAllClosed(page);
  await expectNoOverflow();
  await page.getByTestId('fee-detail-toggle').first().click();
  await expectNoOverflow();
  await page.getByTestId('toggle-all-fee-details').click();
  for (const block of await page.getByTestId('fee-method').all()) await expect(block).toBeVisible();
  await expectNoOverflow();
});
