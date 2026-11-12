import { expect, type Page } from '@playwright/test';
import { TranslationPlanResponseSchema, VehicleTranslationBundleResponseSchema } from '@hd/contracts/admin';
import { tab } from './ui-helpers';

export const bundleSave = (page: Page) => page.getByTestId('translation-bundle-save');
export const planButton = (page: Page) => page.getByTestId('vehicle-translation-generate');
export const recoverResult = (page: Page) => page.getByTestId('translation-result-recover');
export async function openWorkspace(page: Page, id: string) {
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '公开字段多语');
  await expect(page.getByLabel('标题原文（只读）', { exact: true })).toBeVisible();
}
/** Creating an estimate never authorizes a paid generation. Call confirmPlan separately. */
export async function requestPlan(page: Page) {
  const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/translation-plans'));
  await planButton(page).click();
  const result = await response; expect(result.status()).toBe(200);
  const plan = TranslationPlanResponseSchema.parse(await result.json()).data;
  await expect(page.getByTestId('translation-plan-confirmation')).toBeVisible();
  return plan;
}
export async function confirmPlan(page: Page, doubleClick = false) {
  await page.getByTestId('translation-generate-confirm').check();
  const start = page.getByTestId('translation-plan-start'); await expect(start).toBeEnabled();
  if (doubleClick) await start.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  else await start.click();
}
export async function generateSuggestions(page: Page) { const plan = await requestPlan(page); await confirmPlan(page); return plan; }
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
