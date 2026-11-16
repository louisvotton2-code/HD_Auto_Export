/** AD-UX-11 browser contract simulations. Only synthetic draft data is written. */
import { expect, test, type Page } from '@playwright/test';
import { installApi, vehicle } from './api-fixture';
import { fillRequiredVehicleBasics, notes } from './ui-helpers';

const save = (page: Page) => page.getByRole('button', { name: /保存草稿$/ });
const selected = (page: Page, name: string) => page.locator('.ant-form-item').filter({ has: page.getByRole('combobox', { name, exact: true }) }).locator('.ant-select-content-has-value');
test('configuration requires new draft basics before moving on and saves in CNY', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/admin/vehicles/new');
  await expect(page.getByLabel('车源类型', { exact: true })).toHaveCount(0);
  await expect(save(page)).toBeDisabled();
  await page.getByRole('tab', { name: /车辆配置/ }).click();
  await expect(page.getByRole('tab', { name: /基础资料/ })).toHaveAttribute('aria-selected', 'true');
  await fillRequiredVehicleBasics(page);
  const location = page.getByLabel('车辆所在地', { exact: true });
  await location.fill('   ');
  await expect(save(page)).toBeDisabled();
  await page.getByRole('button', { name: '下一步：车辆配置' }).click();
  await expect(location).toBeFocused();
  expect(api.creates).toHaveLength(0);
  await location.fill(' 成都 ');
  await expect(page.getByLabel('所在地国家', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '动力类型', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '下一步：车辆配置' }).click();
  await expect(page).toHaveURL(/\/admin\/vehicles\/fixture_vehicle_1$/);
  await expect(page.getByLabel('三语 JSON', { exact: true })).toHaveValue('');
  await expect.poll(() => api.creates.length).toBe(1);
  expect(JSON.parse(api.creates[0]!.body!).draft).toMatchObject({
    source: { kind: 'manual' }, configuration: null,
    facts: { registrationStatus: 'registered', powertrain: 'unknown', mileageKm: 0, location: { country: 'CN', city: '成都', displayName: null } },
    price: { kind: 'asking', money: { amount: null, currency: 'CNY' } },
    internal: { purchaseCost: { amount: null, currency: 'CNY' } },
  });
  expect(api.items[0]!.availability).toBe('unknown');
  await page.getByRole('button', { name: '下一步：价格与内部信息' }).click();
  expect(api.saves).toHaveLength(0);
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
  expect(api.saves).toHaveLength(0);
  await publicPrice.fill('80000');
  await expect(next).toBeDisabled();
  await cost.fill('68000');
  await next.click();
  await expect.poll(() => api.saves.length).toBe(1);
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
