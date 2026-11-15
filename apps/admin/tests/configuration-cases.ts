/** AD-UX-11 browser contract simulations. Only synthetic draft data is written. */
import { expect, test, type Page } from '@playwright/test';
import { parseVehicleConfigurationJson, vehicleConfigurationExample, VEHICLE_CONFIGURATION_LIMITS } from '@hd/contracts/admin';
import { installApi, vehicle } from './api-fixture';
import { notes, select, tab } from './ui-helpers';

const save = (page: Page) => page.getByRole('button', { name: /保存草稿$/ });
const configuration = (page: Page) => page.getByLabel('配置内容（JSON）', { exact: true });
const selected = (page: Page, name: string) => page.locator('.ant-form-item').filter({ has: page.getByRole('combobox', { name, exact: true }) }).locator('.ant-select-content-has-value');
const manual = (page: Page) => page.locator('.ant-radio-button-wrapper').filter({ hasText: '真实车源录入' });

test('configuration new entry leaves source unselected and facts blank while manual defaults are explicit and limited', async ({ page }) => {
  const api = await installApi(page); await page.goto('/admin/vehicles/new');
  await expect(page.locator('.ant-radio-button-checked')).toHaveCount(0);
  await expect(selected(page, '登记状态')).toHaveText('已登记');
  await expect(selected(page, '动力类型')).toHaveText('未知');
  await expect(selected(page, '变速箱')).toHaveText('未填写'); await expect(selected(page, '车身形式')).toHaveText('未填写');
  for (const label of ['标题原文', '配置名称', '年款', '里程（公里）']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(selected(page, '所在地国家')).toHaveCount(0);
  await manual(page).click(); await expect(selected(page, '所在地国家')).toContainText('中国');
  await tab(page, '价格与内部信息'); await expect(selected(page, '公开价格口径')).toHaveText('公开报价');
  await expect(selected(page, '公开价格币种')).toContainText('USD'); await expect(selected(page, '采购成本币种')).toContainText('USD');
  await expect(page.getByLabel('公开价格金额', { exact: true })).toHaveValue(''); await expect(page.getByLabel('内部采购成本', { exact: true })).toHaveValue('');
  await tab(page, '车辆配置'); await expect(configuration(page)).toHaveValue(''); await save(page).click();
  await expect.poll(() => api.creates.length).toBe(1);
  const draft = JSON.parse(api.creates[0]!.body!).draft;
  expect(draft).toMatchObject({ source: { kind: 'manual' }, configuration: null,
    facts: { registrationStatus: 'registered', powertrain: 'unknown', body: null, transmission: null, modelYear: null, mileageKm: null, trim: null, location: { country: 'CN', city: null } },
    price: { kind: 'asking', money: { amount: null, currency: 'USD' } }, internal: { purchaseCost: null } });
  expect(draft.content.title.sourceText).toBeNull(); expect(api.items[0]!.availability).toBe('unknown');
});

test('configuration a deliberate unknown registration selection survives later manual selection', async ({ page }) => {
  const api = await installApi(page); await page.goto('/admin/vehicles/new');
  await select(page, '登记状态', '未知'); await manual(page).click(); await expect(selected(page, '登记状态')).toHaveText('未知');
  await save(page).click(); await expect.poll(() => api.creates.length).toBe(1);
  expect(JSON.parse(api.creates[0]!.body!).draft.facts.registrationStatus).toBe('unknown');
});

test('configuration existing unknowns nulls and nondefault currencies are preserved by unrelated edits', async ({ page }) => {
  const item = vehicle(); Object.assign(item.draft.facts, { registrationStatus: 'unknown', powertrain: 'unknown', body: null, transmission: null, modelYear: null, mileageKm: null, location: null });
  item.draft.price = { kind: 'on_request', money: null, includes: [] }; item.draft.internal.purchaseCost = { amount: '456.78', currency: 'EUR' };
  item.draft.configuration = { version: 1, items: [{ name: '原始编号', value: '001' }] };
  const before = structuredClone(item.draft); const api = await installApi(page, { items: [item] }); await page.goto(`/admin/vehicles/${item.id}`);
  await expect(selected(page, '登记状态')).toHaveText('未知'); await expect(selected(page, '所在地国家')).toHaveCount(0);
  await (await notes(page)).fill('只补充内部跟进记录'); await expect(selected(page, '采购成本币种')).toContainText('EUR');
  await save(page).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(item.draft).toEqual({ ...before, internal: { ...before.internal, notes: '只补充内部跟进记录' } });
});

test('configuration demo conversion requires consent and clears real-car facts without discarding known model configuration', async ({ page }) => {
  const api = await installApi(page); await page.goto('/admin/vehicles/new'); await manual(page).click();
  await page.getByLabel('里程（公里）', { exact: true }).fill('123'); await page.getByLabel('配置名称', { exact: true }).fill('有资料依据的型号');
  await tab(page, '车辆配置'); await configuration(page).fill(JSON.stringify(vehicleConfigurationExample));
  await tab(page, '价格与内部信息'); await page.getByLabel('公开价格金额', { exact: true }).fill('12345'); await page.getByLabel('VIN', { exact: true }).fill('SYNTHETICVIN123456');
  await tab(page, '基础资料'); const demo = page.locator('.ant-radio-button-wrapper').filter({ hasText: '展示样例，非实际库存' });
  await demo.click(); await page.getByRole('dialog').getByRole('button', { name: /取\s*消$/ }).click();
  await expect(selected(page, '登记状态')).toHaveText('已登记'); await expect(page.getByLabel('里程（公里）', { exact: true })).toHaveValue('123');
  await demo.click(); await page.getByRole('dialog').getByRole('button', { name: '切换并清空实车信息', exact: true }).click();
  await expect(selected(page, '登记状态')).toHaveText('未知'); await expect(page.getByRole('combobox', { name: '登记状态', exact: true })).toBeDisabled();
  await expect(page.getByLabel('里程（公里）', { exact: true })).toHaveValue(''); await expect(selected(page, '所在地国家')).toHaveCount(0);
  await save(page).click(); await expect.poll(() => api.creates.length).toBe(1); const draft = JSON.parse(api.creates[0]!.body!).draft;
  expect(draft.configuration).toBe(JSON.stringify(vehicleConfigurationExample)); expect(api.items[0]!.draft.configuration).toEqual(vehicleConfigurationExample);
  expect(draft).toMatchObject({ source: { kind: 'demo' },
    facts: { registrationStatus: 'unknown', mileageKm: null, manufacturedAt: null, firstRegistration: null, location: null, trim: { name: '有资料依据的型号' } },
    price: { kind: 'on_request', money: null }, internal: { vin: null } });
  expect(api.items[0]).toMatchObject({ availability: 'unknown', availabilityCheckedAt: null });
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
  const api = await installApi(page); await page.goto('/admin/vehicles/new'); await manual(page).click(); await tab(page, '车辆配置');
  for (const [label, raw] of invalidConfigurations) {
    expect(() => parseVehicleConfigurationJson(raw), label).toThrow(); await configuration(page).fill(raw);
    await expect(configuration(page)).toHaveValue(raw); await expect(configuration(page)).toHaveAttribute('aria-invalid', 'true'); await expect(save(page)).toBeDisabled();
    await page.locator('.ant-collapse-header').filter({ hasText: '查看正确格式示例' }).getAttribute('aria-expanded').then(value => expect(value).toBe('true'));
    await page.locator('form').filter({ has: configuration(page) }).evaluate(form => (form as HTMLFormElement).requestSubmit());
    expect(api.creates, label).toEqual([]); expect(api.saves, label).toEqual([]);
  }
  const raw = JSON.stringify({ version: 1, items: [{ name: '编号', value: '001' }, { name: '挡位数', value: '0' }] }, null, 3);
  const expected = parseVehicleConfigurationJson(raw); await configuration(page).fill(raw); await expect(configuration(page)).toHaveAttribute('aria-invalid', 'false');
  await save(page).click(); await expect.poll(() => api.creates.length).toBe(1); expect(JSON.parse(api.creates[0]!.body!).draft.configuration).toBe(raw);
  expect(api.items[0]!.draft.configuration).toEqual(expected); await page.reload(); await tab(page, '车辆配置');
  expect(parseVehicleConfigurationJson(await configuration(page).inputValue())).toEqual(expected);
  await configuration(page).fill(''); await save(page).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0]!.draft.configuration).toBe(''); expect(api.items[0]!.draft.configuration).toBeNull();
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
  await installApi(page); await page.goto('/admin/vehicles/new'); await tab(page, '车辆配置');
  await page.getByRole('button', { name: /复制 AI 配置提示词$/ }).click();
  const prompt = await page.evaluate(() => (window as unknown as { copiedConfigurationPrompt: string }).copiedConfigurationPrompt);
  expect(prompt).toContain(String(VEHICLE_CONFIGURATION_LIMITS.items)); expect(prompt).toContain(String(VEHICLE_CONFIGURATION_LIMITS.totalUtf16));
  expect(prompt).toContain('不推测'); expect(prompt).toContain('不编造参数'); expect(prompt).toContain(JSON.stringify(vehicleConfigurationExample, null, 2));
});
