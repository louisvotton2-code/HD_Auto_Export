import { expect, type Locator, type Page } from '@playwright/test';
import { PublishReadinessResponseSchema } from '@hd/contracts/admin';
import { tab } from './ui-helpers';

/** Requires the real FE preview or installApi's explicitly synthetic iframe. Never fabricates a receipt. */
export async function acknowledgePublicationPreview(page: Page) {
  await tab(page, '发布预览');
  const checkbox = page.getByRole('checkbox', { name: '我已检查当前预览，确认图片、价格和文字正确', exact: true });
  await expect(checkbox).toBeEnabled();
  await checkbox.check();
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/publication-preview/confirm')),
    page.getByRole('button', { name: '确认当前预览', exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
  const ready = PublishReadinessResponseSchema.parse(await response.json()).data;
  expect(ready.previewConfirmed).toBe(true);
  expect(ready.canPublish).toBe(true);
  await expect(page.getByTestId('vehicle-publish')).toBeEnabled();
  return ready;
}

async function openPicker(page: Page, label: string) {
  // Drain closing animation before identifying the next picker, rather than choosing the first visible popup.
  await expect(page.locator('.ant-picker-dropdown:visible')).toHaveCount(0);
  const input = page.getByRole('textbox', { name: label, exact: true });
  await expect(input).toHaveAttribute('readonly', '');
  await input.click();
  const popup = page.locator('.ant-picker-dropdown:visible');
  await expect(popup).toHaveCount(1);
  return { input, popup };
}

async function pickYearInPanel(popup: Locator, year: number) {
  await expect(popup.locator('.ant-picker-year-panel')).toBeVisible();
  for (let attempt = 0; attempt < 25; attempt++) {
    const cell = popup.locator('.ant-picker-year-panel .ant-picker-cell-in-view').getByText(String(year), { exact: true });
    if (await cell.count()) { await cell.click(); return; }
    const range = await popup.locator('.ant-picker-decade-btn').innerText();
    const start = Number(range.match(/\d{4}/)?.[0]);
    if (!Number.isFinite(start)) throw new Error(`Cannot read picker decade: ${range}`);
    await popup.locator(year < start ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn').click();
  }
  throw new Error(`Year ${year} is outside the test helper's 250-year navigation budget`);
}

export async function chooseYear(page: Page, label: string, year: string | number) {
  const { input, popup } = await openPicker(page, label);
  await pickYearInPanel(popup, Number(year));
  await expect(input).toHaveValue(String(year));
  await expect(popup).toBeHidden();
}

export async function chooseUtcDateTime(page: Page, label: string, value: { date: string; hour: number; minute: number }) {
  const { input, popup } = await openPicker(page, label);
  const [year, month] = value.date.split('-').map(Number);
  await popup.locator('.ant-picker-date-panel .ant-picker-year-btn').click();
  await pickYearInPanel(popup, year);
  await popup.locator('.ant-picker-month-panel .ant-picker-cell-inner').nth(month - 1).click();
  await popup.locator(`.ant-picker-date-panel td[title="${value.date}"]`).click();
  const columns = popup.locator('.ant-picker-time-panel-column');
  const hour = String(value.hour).padStart(2, '0'); const minute = String(value.minute).padStart(2, '0');
  await columns.nth(0).getByText(hour, { exact: true }).click();
  await columns.nth(1).getByText(minute, { exact: true }).click();
  await popup.getByRole('button', { name: /确\s*定/ }).click();
  await expect(popup).toBeHidden();
  await expect(input).toHaveValue(`${value.date} ${hour}:${minute}`);
}
