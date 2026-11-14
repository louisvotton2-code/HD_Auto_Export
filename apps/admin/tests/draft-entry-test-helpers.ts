import { expect, type Page } from '@playwright/test';
import { vehicleConfigurationExample } from '@hd/contracts/admin';
import { chooseYear } from './publication-test-helpers';
import { select, tab } from './ui-helpers';

export async function fillEntryBasics(page: Page, title = '合成车辆草稿') {
  await select(page, '品牌', '丰田 / Toyota');
  await select(page, '车型', '卡罗拉 / Corolla');
  await page.getByLabel('标题原文', { exact: true }).fill(title);
  await page.getByLabel('配置名称', { exact: true }).fill('合成配置');
  await chooseYear(page, '年款', 2024);
  const powertrain = page.getByRole('combobox', { name: '动力类型', exact: true });
  await powertrain.click();
  // The virtual list opens at the selected last item. Move to its first option by keyboard.
  await expect(powertrain).toHaveAttribute('aria-expanded', 'true');
  await powertrain.press('ArrowDown');
  await powertrain.press('Enter');
  await expect(page.locator('.ant-select').filter({ has: powertrain }).getByTitle('汽油', { exact: true })).toBeVisible();
  await page.getByLabel('里程（公里）', { exact: true }).fill('0');
}

export async function fillEntryCommercial(page: Page) {
  await tab(page, '价格与内部信息');
  await page.getByLabel('公开价格金额', { exact: true }).fill('120000.00');
  await page.getByLabel('内部采购成本', { exact: true }).fill('100000.00');
  await page.getByLabel('车况描述', { exact: true }).fill('此车况仅用于测试。');
}

export async function fillRequiredEntry(page: Page, title?: string) {
  await fillEntryBasics(page, title);
  await tab(page, '车辆配置');
  await page.getByLabel('配置内容（JSON）', { exact: true }).fill(JSON.stringify(vehicleConfigurationExample));
  await fillEntryCommercial(page);
}
