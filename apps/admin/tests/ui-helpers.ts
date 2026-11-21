import { expect, type Page } from '@playwright/test';
export async function tab(page: Page, label: string) {
  const target = page.getByRole('tab', { name: new RegExp(label) });
  // Focusing a tab scrolls Ant's tab strip on narrow viewports.
  await target.focus();
  await target.click();
  await expect(target).toHaveAttribute('aria-selected', 'true');
}
export async function notes(page: Page) { await tab(page, '价格与内部信息'); return page.getByRole('textbox', { name: '内部备注', exact: true }); }
export async function select(page: Page, name: string, option: string | RegExp) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText(option, { exact: typeof option === 'string' }).click();
}
export async function newName(page: Page, kind: '品牌' | '车型', name: string) {
  await page.getByRole('button', { name: `新增${kind}`, exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('textbox', { name: `${kind}名称`, exact: true }).fill(name);
  await modal.getByRole('button', { name: `添加${kind}`, exact: true }).click();
  await expect(modal).not.toBeVisible();
}

export async function fillRequiredVehicleBasics(page: Page, title = '合成测试车辆') {
  await select(page, '品牌', '丰田 / Toyota');
  const model = page.getByRole('combobox', { name: '车型', exact: true });
  await model.click();
  // Search before clicking so the virtual list keeps the exact match in view.
  await model.fill('Corolla');
  const corolla = page.locator('.ant-select-dropdown:visible').getByText('卡罗拉 / Corolla', { exact: true });
  await expect(corolla).toBeInViewport();
  await corolla.click();
  await page.getByLabel('标题原文', { exact: true }).fill(title);
  await page.getByLabel('配置名称', { exact: true }).fill('合成配置款型');
  await page.getByRole('textbox', { name: '年款', exact: true }).click();
  await page.locator('.ant-picker-dropdown:visible td[title="2024"]').click();
  await page.getByLabel('里程（公里）', { exact: true }).fill('0');
  await page.getByLabel('车辆所在地', { exact: true }).fill('成都市');
}
