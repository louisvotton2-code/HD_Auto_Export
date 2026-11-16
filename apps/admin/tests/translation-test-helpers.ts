import { expect, type Page } from '@playwright/test';
import { VehicleTranslationBundleResponseSchema } from '@hd/contracts/admin';
import { tab } from './ui-helpers';

export const bundleSave = (page: Page) => page.getByTestId('translation-bundle-save');
export async function openWorkspace(page: Page, id: string) {
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '车辆配置');
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toBeVisible();
}
export async function saveBundle(page: Page) {
  const response = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/translation-bundle'));
  await bundleSave(page).click(); const result = await response; expect(result.status()).toBe(200);
  const bundle = VehicleTranslationBundleResponseSchema.parse(await result.json()).data;
  await expect(bundleSave(page)).toBeDisabled(); return bundle;
}
export async function noReviewControls(page: Page) {
  await expect(page.getByRole('checkbox', { name: /已审核/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /来源语言$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /保存多语展示资料|生成所选展示字段英俄译文|生成英俄译文$/ })).toHaveCount(0);
}
