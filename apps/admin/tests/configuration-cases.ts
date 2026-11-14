/** AD-UX-11 browser contract simulations. Only synthetic draft data is written. */
import { expect, test, type Page } from '@playwright/test';
import { parseVehicleConfigurationJson, vehicleConfigurationExample, VEHICLE_CONFIGURATION_LIMITS } from '@hd/contracts/admin';
import { installApi, vehicle } from './api-fixture';
import { notes, tab } from './ui-helpers';
import { fillEntryBasics, fillEntryCommercial } from './draft-entry-test-helpers';

const save = (page: Page) => page.getByRole('button', { name: /保存草稿$/ });
const configuration = (page: Page) => page.getByLabel('配置内容（JSON）', { exact: true });
const selected = (page: Page, name: string) => page.locator('.ant-form-item').filter({ has: page.getByRole('combobox', { name, exact: true }) }).locator('.ant-select-content-has-value');

test('configuration new entry blocks save and later steps until required facts are valid', async ({ page }) => {
  const api = await installApi(page); await page.goto('/admin/vehicles/new');
  await expect(page.getByText('真实自有车源', { exact: true })).toBeVisible();
  await expect(selected(page, '登记状态')).toHaveText('已登记');
  await expect(save(page)).toBeDisabled();
  for (const label of ['排量（cc）', '原始马力（hp）', '变速箱', '车身形式', '所在地国家']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: '进入发布预览' }).click();
  await expect(page.getByRole('tab', { name: /基础资料/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/请补全或修正：/)).toBeVisible();
  await page.locator('form').filter({ has: configuration(page) }).evaluate(form => (form as HTMLFormElement).requestSubmit());
  expect(api.creates).toEqual([]);
});

test('configuration an incomplete historical draft can save unrelated edits without inventing values', async ({ page }) => {
  const item = vehicle();
  Object.assign(item.draft.facts, { registrationStatus: 'unknown', powertrain: 'unknown', modelYear: null, mileageKm: null, location: null, powerHp: 147.5 });
  item.draft.configuration = null;
  item.draft.price = { kind: 'on_request', money: null, includes: [] };
  item.draft.internal.purchaseCost = { amount: '456.78', currency: 'EUR' };
  const before = structuredClone(item.draft); const api = await installApi(page, { items: [item] });
  await page.goto(`/admin/vehicles/${item.id}`);
  await (await notes(page)).fill('只补充内部跟进记录');
  await expect(page.getByLabel('采购成本币种', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('内部采购成本', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('内部采购成本', { exact: true })).toHaveValue('456.78');
  await save(page).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(item.draft).toEqual({ ...before, internal: { ...before.internal, notes: '只补充内部跟进记录' } });
});

test('configuration untouched new manual draft can leave without an unsaved warning', async ({ page }) => {
  await installApi(page); await page.goto('/admin/vehicles/new');
  await page.getByRole('button', { name: '返回车辆列表' }).click();
  await expect(page).toHaveURL(/\/admin\/vehicles$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

const invalidConfigurations = [
  ['duplicate JSON property', '{"version":1,"version":1,"items":[{"name":"参数","value":"1"}]}'],
  ['duplicate normalized name', JSON.stringify({ version: 1, items: [{ name: 'ＡＢＣ', value: '1' }, { name: 'abc', value: '2' }] })],
  ['empty entries', '{"version":1,"items":[]}'],
  ['too many items', JSON.stringify({ version: 1, items: Array.from({ length: VEHICLE_CONFIGURATION_LIMITS.items + 1 }, (_, i) => ({ name: `项目${i}`, value: '1' })) })],
  ['too long value', JSON.stringify({ version: 1, items: [{ name: '参数', value: '字'.repeat(VEHICLE_CONFIGURATION_LIMITS.valueUtf16 + 1) }] })],
  ['aggregate limit', JSON.stringify({ version: 1, items: Array.from({ length: Math.ceil(VEHICLE_CONFIGURATION_LIMITS.totalUtf16 / VEHICLE_CONFIGURATION_LIMITS.valueUtf16) + 1 }, (_, i) => ({ name: `项目${i}`, value: '字'.repeat(VEHICLE_CONFIGURATION_LIMITS.valueUtf16) })) })],
] as const;

test('configuration invalid nonempty JSON cannot create or save via button or form submission and never truncates input', async ({ page }) => {
  const api = await installApi(page); await page.goto('/admin/vehicles/new'); await fillEntryBasics(page); await tab(page, '车辆配置');
  for (const [label, raw] of invalidConfigurations) {
    expect(() => parseVehicleConfigurationJson(raw), label).toThrow(); await configuration(page).fill(raw);
    await expect(configuration(page)).toHaveValue(raw); await expect(configuration(page)).toHaveAttribute('aria-invalid', 'true'); await expect(save(page)).toBeDisabled();
    await page.locator('.ant-collapse-header').filter({ hasText: '查看正确格式示例' }).getAttribute('aria-expanded').then(value => expect(value).toBe('true'));
    await page.locator('form').filter({ has: configuration(page) }).evaluate(form => (form as HTMLFormElement).requestSubmit());
    expect(api.creates, label).toEqual([]); expect(api.saves, label).toEqual([]);
  }
  const raw = JSON.stringify({ version: 1, items: [{ name: '编号', value: '001' }, { name: '挡位数', value: '0' }] }, null, 3);
  const expected = parseVehicleConfigurationJson(raw); await configuration(page).fill(raw); await expect(configuration(page)).toHaveAttribute('aria-invalid', 'false');
  await fillEntryCommercial(page); await save(page).click(); await expect.poll(() => api.creates.length).toBe(1); expect(JSON.parse(api.creates[0]!.body!).draft.configuration).toBe(raw);
  expect(api.items[0]!.draft.configuration).toEqual(expected); await page.reload(); await tab(page, '车辆配置');
  expect(parseVehicleConfigurationJson(await configuration(page).inputValue())).toEqual(expected);
  await configuration(page).fill(''); await save(page).click();
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0]!.draft.configuration).toBe('');
  expect(api.items[0]!.draft.configuration).toBeNull();
});

test('configuration malformed edits send no PATCH and valid raw JSON remains lossless after reload', async ({ page }) => {
  const item = vehicle(); item.draft.configuration = structuredClone(vehicleConfigurationExample);
  const api = await installApi(page, { items: [item] }); await page.goto(`/admin/vehicles/${item.id}`); await tab(page, '车辆配置');
  await configuration(page).fill('{"version":1,"items":[{"name":"排量","value":1989}]}'); await expect(save(page)).toBeDisabled();
  await page.locator('form').filter({ has: configuration(page) }).evaluate(form => (form as HTMLFormElement).requestSubmit()); expect(api.saves).toEqual([]);
  const raw = '{ "items": [{ "value": "001.0", "name": "原样参数" }], "version": 1 }'; await configuration(page).fill(raw); await save(page).click();
  await expect.poll(() => api.saves.length).toBe(1); expect(api.saves[0]!.draft.configuration).toBe(raw); expect(item.draft.configuration).toEqual(parseVehicleConfigurationJson(raw));
  await page.reload(); await tab(page, '车辆配置'); expect(parseVehicleConfigurationJson(await configuration(page).inputValue())).toEqual(parseVehicleConfigurationJson(raw));
  await page.setViewportSize({ width: 320, height: 844 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('configuration-json-320.png'), fullPage: true, animations: 'disabled' });
});

test('configuration prompt uses official limits and explicit unknown-data instructions without touching the system clipboard', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedConfigurationPrompt: string }).copiedConfigurationPrompt = text; } } }); });
  await installApi(page); await page.goto('/admin/vehicles/new'); await fillEntryBasics(page); await tab(page, '车辆配置');
  await page.getByRole('button', { name: /复制 AI 配置提示词$/ }).click();
  const prompt = await page.evaluate(() => (window as unknown as { copiedConfigurationPrompt: string }).copiedConfigurationPrompt);
  expect(prompt).toContain(String(VEHICLE_CONFIGURATION_LIMITS.items)); expect(prompt).toContain(String(VEHICLE_CONFIGURATION_LIMITS.totalUtf16));
  expect(prompt).toContain('不推测'); expect(prompt).toContain('不编造参数'); expect(prompt).toContain(JSON.stringify(vehicleConfigurationExample, null, 2));
});
