/** AD-UX-11 browser contract simulations. Only synthetic draft data is written. */
import { expect, test, type Page } from '@playwright/test';
import { parseVehicleConfigurationJson, vehicleConfigurationExample, VEHICLE_CONFIGURATION_LIMITS } from '@hd/contracts/admin';
import { installApi, vehicle } from './api-fixture';
import { fillRequiredVehicleBasics, notes, openLegacyConfiguration, tab } from './ui-helpers';

const parse = (page: Page) => page.getByRole('button', { name: '解析并核对配置' });
const confirmConfiguration = (page: Page) => page.getByRole('button', { name: '人工核对无误' });
const save = (page: Page) => page.getByRole('button', { name: /保存草稿$/ });
const configuration = (page: Page) => page.getByLabel('配置内容（JSON）', { exact: true });
const selected = (page: Page, name: string) => page.locator('.ant-form-item').filter({ has: page.getByRole('combobox', { name, exact: true }) }).locator('.ant-select-content-has-value');
test('configuration requires new draft basics before moving on and saves in CNY', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/admin/vehicles/new');
  await expect(page.getByLabel('车源类型', { exact: true })).toHaveCount(0);
  await expect(save(page)).toBeDisabled();
  await page.getByRole('tab', { name: /车辆配置/ }).click();
  await expect(page.getByRole('tab', { name: /基础资料/ })).toHaveAttribute('aria-selected', 'true');
  await fillRequiredVehicleBasics(page);
  await expect(page.getByLabel('所在地国家', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '动力类型', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '下一步：车辆配置' }).click();
  await expect(page).toHaveURL(/\/admin\/vehicles\/fixture_vehicle_1$/);
  await openLegacyConfiguration(page);
  await expect(configuration(page)).toHaveValue('');
  await expect.poll(() => api.creates.length).toBe(1);
  expect(JSON.parse(api.creates[0]!.body!).draft).toMatchObject({
    source: { kind: 'manual' }, configuration: null,
    facts: { registrationStatus: 'registered', powertrain: 'unknown', mileageKm: 0, location: { country: 'CN', city: null } },
    price: { kind: 'asking', money: { amount: null, currency: 'CNY' } },
    internal: { purchaseCost: { amount: null, currency: 'CNY' } },
  });
  expect(api.items[0]!.availability).toBe('unknown');
  const configurationNext = page.getByRole('button', { name: '下一步：价格与内部信息' });
  const warning = page.locator('.ant-message-warning');
  await configurationNext.click();
  await expect(warning.filter({ hasText: '请先填写配置 JSON 并完成人工核对。' })).toBeVisible();
  await configuration(page).fill(JSON.stringify({ version: 1, items: [{ name: '动力类型', value: '纯电' }] }));
  await configurationNext.click();
  await expect(warning.filter({ hasText: '请先点击「解析并核对配置」，再完成人工核对。' })).toBeVisible();
  await expect(page.getByText('核对已解析的 1 项配置', { exact: true })).toHaveCount(0);
  await parse(page).click();
  await expect(page.getByText('核对已解析的 1 项配置', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '纯电', exact: true })).toBeVisible();
  await expect(page.getByText('可用于筛选及费用参考的标准参数', { exact: true })).toBeVisible();
  await configurationNext.click();
  await expect(warning.filter({ hasText: '请点击「人工核对无误」后再继续。' })).toBeVisible();
  const commercialTab = page.getByRole('tab', { name: /价格与内部信息/ });
  await commercialTab.click();
  await expect(commercialTab).toHaveAttribute('aria-selected', 'false');
  expect(api.saves).toHaveLength(0);
  await confirmConfiguration(page).click();
  await configurationNext.click();
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.items[0]!.draft.facts.powertrain).toBe('bev');
  const publicPrice = page.getByRole('textbox', { name: '公开价格金额' });
  const cost = page.getByRole('textbox', { name: '内部采购成本' });
  const next = page.getByRole('button', { name: '下一步：图片管理' });
  await publicPrice.pressSequentially('80000.12');
  await cost.fill('68000.34');
  await expect(publicPrice).toHaveValue('80000.12');
  await expect(publicPrice).toHaveAttribute('aria-invalid', 'true');
  await expect(cost).toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toBeDisabled();
  await expect(next).toBeDisabled();
  await page.locator('form').filter({ has: publicPrice }).evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(page.getByRole('alert').filter({ hasText: '草稿尚未保存' })).toBeVisible();
  expect(api.saves).toHaveLength(1);
  await publicPrice.fill('80000');
  await expect(next).toBeDisabled();
  await cost.fill('68000');
  await next.click();
  await expect.poll(() => api.saves.length).toBe(2);
  expect(api.items[0]!.draft.price.money).toEqual({ amount: '80000', currency: 'CNY' });
  expect(api.items[0]!.draft.internal.purchaseCost).toEqual({ amount: '68000', currency: 'CNY' });
});

test('configuration preserves deliberate unknown registration on a manual draft', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/admin/vehicles/new');
  await fillRequiredVehicleBasics(page);
  const registration = page.getByRole('combobox', { name: '登记状态', exact: true });
  await registration.click();
  await registration.press('ArrowDown');
  await registration.press('Enter');
  await save(page).click();
  await expect.poll(() => api.creates.length).toBe(1);
  expect(JSON.parse(api.creates[0]!.body!).draft.facts.registrationStatus).toBe('unknown');
});

test('configuration existing unknowns nulls and nondefault currencies are preserved by unrelated edits', async ({ page }) => {
  const item = vehicle(); Object.assign(item.draft.facts, { registrationStatus: 'unknown', powertrain: 'unknown', body: null, transmission: null, modelYear: null, mileageKm: null, location: null });
  item.draft.price = { kind: 'on_request', money: null, includes: [] }; item.draft.internal.purchaseCost = { amount: '456.78', currency: 'EUR' };
  item.draft.configuration = { version: 1, items: [{ name: '原始编号', value: '001' }] };
  const before = structuredClone(item.draft); const api = await installApi(page, { items: [item] }); await page.goto(`/admin/vehicles/${item.id}`);
  await expect(selected(page, '登记状态')).toHaveText('未知'); await expect(selected(page, '所在地国家')).toHaveCount(0);
  await (await notes(page)).fill('只补充内部跟进记录');
  await expect(page.getByRole('textbox', { name: '内部采购成本' })).toHaveValue('456.78');
  await expect(page.getByText('单位 EUR，填写整数。')).toBeVisible();
  await save(page).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(item.draft).toEqual({ ...before, internal: { ...before.internal, notes: '只补充内部跟进记录' } });
});

test('configuration saves only confirmed structured facts alongside the configuration', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/admin/vehicles/new');
  await fillRequiredVehicleBasics(page);
  await tab(page, '车辆配置'); await openLegacyConfiguration(page);
  const items = [
    { name: '排量(cc)', value: '1989' },
    { name: '原始马力(hp)', value: '140' },
    { name: '变速箱', value: '双离合' },
    { name: '驱动形式', value: '未知' },
  ];
  await configuration(page).fill(JSON.stringify({ version: 1, items }));
  await expect(save(page)).toBeDisabled();
  await parse(page).click();
  await confirmConfiguration(page).click();
  await expect(save(page)).toBeEnabled();
  items[0]!.value = '1990';
  await configuration(page).fill(JSON.stringify({ version: 1, items }));
  await expect(save(page)).toBeDisabled();
  await expect(confirmConfiguration(page)).toHaveCount(0);
  await parse(page).click();
  await confirmConfiguration(page).click();
  await save(page).click();
  await expect.poll(() => api.creates.length).toBe(1);
  expect(JSON.parse(api.creates[0]!.body!).draft.facts).toMatchObject({
    engineCc: 1990, powerHp: 140, transmission: 'dct', body: null, powerKw: null,
  });
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
  const api = await installApi(page); await page.goto('/admin/vehicles/new'); await fillRequiredVehicleBasics(page); await tab(page, '车辆配置'); await openLegacyConfiguration(page);
  for (const [label, raw] of invalidConfigurations) {
    expect(() => parseVehicleConfigurationJson(raw), label).toThrow(); await configuration(page).fill(raw);
    await expect(configuration(page)).toHaveValue(raw); await expect(configuration(page)).toHaveAttribute('aria-invalid', 'true'); await expect(save(page)).toBeDisabled();
    await page.locator('.ant-collapse-header').filter({ hasText: '查看正确格式示例' }).getAttribute('aria-expanded').then(value => expect(value).toBe('true'));
    await page.locator('form').filter({ has: configuration(page) }).evaluate(form => (form as HTMLFormElement).requestSubmit());
    expect(api.creates, label).toEqual([]); expect(api.saves, label).toEqual([]);
  }
  const raw = JSON.stringify({ version: 1, items: [{ name: '编号', value: '001' }, { name: '挡位数', value: '0' }] }, null, 3);
  const expected = parseVehicleConfigurationJson(raw); await configuration(page).fill(raw); await expect(configuration(page)).toHaveAttribute('aria-invalid', 'false');
  await parse(page).click();
  await expect(page.getByText('本次没有识别到要更新的标准参数。已保存的参数会保留。')).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await confirmConfiguration(page).click();
  await save(page).click(); await expect.poll(() => api.creates.length).toBe(1); expect(JSON.parse(api.creates[0]!.body!).draft.configuration).toBe(raw);
  expect(api.items[0]!.draft.configuration).toEqual(expected); await page.reload(); await tab(page, '车辆配置'); await openLegacyConfiguration(page);
  expect(parseVehicleConfigurationJson(await configuration(page).inputValue())).toEqual(expected);
  await configuration(page).fill(''); await save(page).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0]!.draft.configuration).toBe(''); expect(api.items[0]!.draft.configuration).toBeNull();
});

test('configuration malformed edits send no PATCH and valid raw JSON remains lossless after reload', async ({ page }) => {
  const item = vehicle(); item.draft.configuration = structuredClone(vehicleConfigurationExample);
  item.draft.configuration.items.push({ name: '动力类型', value: '汽油' });
  item.draft.facts.powertrain = 'hev';
  const api = await installApi(page, { items: [item] }); await page.goto(`/admin/vehicles/${item.id}`); await tab(page, '车辆配置'); await openLegacyConfiguration(page);
  await configuration(page).fill('{"version":1,"items":[{"name":"排量","value":1989}]}'); await expect(save(page)).toBeDisabled();
  await page.locator('form').filter({ has: configuration(page) }).evaluate(form => (form as HTMLFormElement).requestSubmit()); expect(api.saves).toEqual([]);
  const raw = '{ "items": [{ "value": "001.0", "name": "原样参数" }, { "name": "动力类型", "value": "汽油" }], "version": 1 }'; await configuration(page).fill(raw); await parse(page).click(); await confirmConfiguration(page).click(); await save(page).click();
  await expect.poll(() => api.saves.length).toBe(1); expect(api.saves[0]!.draft.configuration).toBe(raw); expect(item.draft.configuration).toEqual(parseVehicleConfigurationJson(raw));
  expect(item.draft.facts.powertrain).toBe('hev');
  await page.reload(); await tab(page, '车辆配置'); await openLegacyConfiguration(page); expect(parseVehicleConfigurationJson(await configuration(page).inputValue())).toEqual(parseVehicleConfigurationJson(raw));
  await page.setViewportSize({ width: 320, height: 844 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('configuration-json-320.png'), fullPage: true, animations: 'disabled' });
});

test('configuration prompt copies basic facts and asks for one trilingual JSON without guessing', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedConfigurationPrompt: string }).copiedConfigurationPrompt = text; } } }); });
  await installApi(page); await page.goto('/admin/vehicles/new'); await fillRequiredVehicleBasics(page, '仅用于测试的中文标题'); await tab(page, '车辆配置');
  await page.getByRole('button', { name: /复制三语 JSON 提示词$/ }).click();
  const prompt = await page.evaluate(() => (window as unknown as { copiedConfigurationPrompt: string }).copiedConfigurationPrompt);
  await page.getByText('查看 AI 提示词', { exact: true }).click();
  await expect(page.getByLabel('三语 JSON 提示词', { exact: true })).toHaveValue(prompt);
  expect(prompt).toContain('只使用我提供的事实');
  expect(prompt).toContain('不要查询或补写缺失参数');
  expect(prompt).toContain('中文 zh、英文 en 和俄文 ru');
  expect(prompt).toContain(JSON.stringify({ 品牌: '丰田', 车型: '卡罗拉', 配置款型: '合成配置款型', 年款: '2024', 标题: '仅用于测试的中文标题' }));
});
