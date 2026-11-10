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
