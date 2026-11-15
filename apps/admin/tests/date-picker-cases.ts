import { expect, test, type Page } from '@playwright/test';
import { makeExternalVehicleDraftFixture } from '@hd/contracts/fixtures';
import { installApi, vehicle } from './api-fixture';
import { tab } from './ui-helpers';

async function selectPrecision(page: Page, name: string, option: string) {
  const control = page.getByRole('combobox', { name, exact: true });
  await control.click();
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  const listId = await control.getAttribute('aria-controls');
  expect(listId).toBeTruthy();
  const popup = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listId)}]`) });
  await popup.getByText(option, { exact: true }).click();
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(popup).toBeHidden();
}

async function chooseYear(page: Page, label: string, year: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await expect(input).toHaveAttribute('readonly', '');
  await input.click();
  const popup = page.locator('.ant-picker-dropdown:visible');
  await expect(popup.locator('.ant-picker-year-panel')).toBeVisible();
  await popup.locator('.ant-picker-year-panel').getByText(year, { exact: true }).click();
  await expect(input).toHaveValue(year);
  await expect(popup).toBeHidden();
}

async function chooseMonth(page: Page, label: string, year: string, month: number) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.click();
  const popup = page.locator('.ant-picker-dropdown:visible');
  await popup.locator('.ant-picker-year-btn').click();
  await popup.locator('.ant-picker-year-panel').getByText(year, { exact: true }).click();
  // The month panel has exactly twelve chronologically ordered cells, independent of UI language.
  await popup.locator('.ant-picker-month-panel .ant-picker-cell-inner').nth(month - 1).click();
  await expect(input).toHaveValue(`${year}-${String(month).padStart(2, '0')}`);
  await expect(popup).toBeHidden();
}

async function clearDate(page: Page, label: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  const picker = page.locator('.ant-picker').filter({ has: input });
  await picker.hover();
  await picker.locator('.ant-picker-clear').click();
  await expect(input).toHaveValue('');
}

async function save(page: Page) {
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page.getByRole('status')).toContainText('草稿已保存');
}

test('date pickers save year and month precision independently from model year', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-12T04:00:00Z'));
  const record = vehicle();
  record.draft.facts.manufacturedAt = null;
  record.draft.facts.firstRegistration = null;
  const api = await installApi(page, { items: [record] });
  await page.goto(`/admin/vehicles/${record.id}`);
  await tab(page, '基础资料');
  await selectPrecision(page, '制造日期精度', '年份');
  await chooseYear(page, '制造日期', '2021');
  await selectPrecision(page, '首次登记日期精度', '年月');
  await chooseMonth(page, '首次登记日期', '2024', 5);
  await chooseYear(page, '年款', '2025');
  await save(page);
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0].draft.facts).toMatchObject({
    modelYear: 2025,
    manufacturedAt: { precision: 'year', value: '2021' },
    firstRegistration: { precision: 'month', value: '2024-05' },
  });
  await page.reload();
  await tab(page, '基础资料');
  await expect(page.getByRole('textbox', { name: '制造日期', exact: true })).toHaveValue('2021');
  await expect(page.getByRole('textbox', { name: '首次登记日期', exact: true })).toHaveValue('2024-05');
  await expect(page.getByRole('textbox', { name: '年款', exact: true })).toHaveValue('2025');
});

test('increasing known date precision clears the value instead of inventing a month or day', async ({ page }) => {
  const record = vehicle();
  record.draft.facts.manufacturedAt = { precision: 'year', value: '2021' };
  record.draft.facts.firstRegistration = { precision: 'month', value: '2023-07' };
  const originalYear = record.draft.facts.modelYear;
  const api = await installApi(page, { items: [record] });
  await page.goto(`/admin/vehicles/${record.id}`);
  await tab(page, '基础资料');
  await selectPrecision(page, '制造日期精度', '年月');
  await expect(page.getByRole('textbox', { name: '制造日期', exact: true })).toHaveValue('');
  await selectPrecision(page, '首次登记日期精度', '完整日期');
  await expect(page.getByRole('textbox', { name: '首次登记日期', exact: true })).toHaveValue('');
  await save(page);
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0].draft.facts).toMatchObject({ manufacturedAt: null, firstRegistration: null, modelYear: originalYear });
});

test('reducing date precision retains only known parts and date clear controls persist null', async ({ page }) => {
  const record = vehicle();
  record.draft.facts.manufacturedAt = { precision: 'day', value: '2020-02-29' };
  record.draft.facts.firstRegistration = { precision: 'day', value: '2022-09-18' };
  const api = await installApi(page, { items: [record] });
  await page.goto(`/admin/vehicles/${record.id}`);
  await tab(page, '基础资料');
  await selectPrecision(page, '制造日期精度', '年月');
  await selectPrecision(page, '首次登记日期精度', '年份');
  await expect(page.getByRole('textbox', { name: '制造日期', exact: true })).toHaveValue('2020-02');
  await expect(page.getByRole('textbox', { name: '首次登记日期', exact: true })).toHaveValue('2022');
  await save(page);
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0].draft.facts).toMatchObject({
    manufacturedAt: { precision: 'month', value: '2020-02' },
    firstRegistration: { precision: 'year', value: '2022' },
  });
  await clearDate(page, '制造日期');
  await clearDate(page, '首次登记日期');
  await clearDate(page, '年款');
  await save(page);
  await expect.poll(() => api.saves.length).toBe(2);
  expect(api.saves[1].draft.facts).toMatchObject({ manufacturedAt: null, firstRegistration: null, modelYear: null });
  await page.reload();
  await tab(page, '基础资料');
  for (const name of ['制造日期', '首次登记日期', '年款']) await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue('');
});


async function chooseUtcNoon(page: Page, label: string, date: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await expect(input).toHaveAttribute('readonly', '');
  await input.click();
  const popup = page.locator('.ant-picker-dropdown:visible');
  await popup.locator(`.ant-picker-date-panel td[title="${date}"]`).click();
  const columns = popup.locator('.ant-picker-time-panel-column');
  await columns.nth(0).getByText('12', { exact: true }).click();
  await columns.nth(1).getByText('00', { exact: true }).click();
  await popup.getByRole('button', { name: /确\s*定/ }).click();
  await expect(popup).toBeHidden();
  await expect(input).toHaveValue(`${date} 12:00`);
}

test.describe('UTC date input from a non-UTC browser', () => {
  test.use({ timezoneId: 'Asia/Shanghai' });

  test('blank source timestamp preserves the selected UTC wall time after saving, clearing and selecting again', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T00:00:00Z'));
    expect(await page.evaluate(() => new Date('2026-11-12T00:00:00Z').getTimezoneOffset())).toBe(-480);
    const record = vehicle();
    record.draft = makeExternalVehicleDraftFixture();
    expect(record.draft.source).toMatchObject({ kind: 'external', sourceUpdatedAt: null });
    const originalSource = structuredClone(record.draft.source);
    const api = await installApi(page, { items: [record] });
    const label = '来源更新时间（UTC）';
    await page.goto(`/admin/vehicles/${record.id}`);
    await tab(page, '基础资料');
    await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue('');
    await chooseUtcNoon(page, label, '2026-11-07');
    await save(page);
    await expect.poll(() => api.saves.length).toBe(1);
    expect(api.saves[0].draft.source).toEqual({ ...originalSource, sourceUpdatedAt: '2026-11-07T12:00:00.000Z' });
    await page.reload();
    await tab(page, '基础资料');
    await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue('2026-11-07 12:00');

    await clearDate(page, label);
    await save(page);
    await expect.poll(() => api.saves.length).toBe(2);
    expect(api.saves[1].draft.source).toEqual(originalSource);
    await page.reload();
    await tab(page, '基础资料');
    await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue('');
    await chooseUtcNoon(page, label, '2026-11-06');
    await save(page);
    await expect.poll(() => api.saves.length).toBe(3);
    expect(api.saves[2].draft.source).toEqual({ ...originalSource, sourceUpdatedAt: '2026-11-06T12:00:00.000Z' });
    await page.reload();
    await tab(page, '基础资料');
    await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue('2026-11-06 12:00');
  });
});
