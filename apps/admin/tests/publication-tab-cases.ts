/** Tab boundaries are exercised with a synthetic authenticated iframe, not real FE evidence. */
import { expect, test, type Page } from '@playwright/test';
import { envelope, installApi, reply, vehicle } from './api-fixture';
import { acknowledgePublicationPreview } from './publication-test-helpers';
import { tab } from './ui-helpers';

const id = '60000000-0000-4000-8000-000000000011';
const publish = (page: Page) => page.getByTestId('vehicle-publish');
const acknowledge = '我已检查当前预览，确认图片、价格和文字正确';
async function expectNoPublicationControls(page: Page) {
  await expect(publish(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: acknowledge, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认当前预览', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /重试原发布请求$/ })).toHaveCount(0);
}

test('publication tab only exposes confirm and publish controls in the rendered preview tab', async ({ page }) => {
  const item = { ...vehicle(), id }; const api = await installApi(page, { items: [item], publicationDefaultConfirmed: false }); let writes = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => { writes++; return reply(route, envelope(item)); });
  await page.goto(`/admin/vehicles/${id}`); await expectNoPublicationControls(page);
  for (const name of ['车辆配置', '价格与内部信息', '图片管理', '公开字段多语']) { await tab(page, name); await expectNoPublicationControls(page); }
  await tab(page, '发布预览'); await expect(publish(page)).toBeDisabled(); expect(api.previewConfirmations).toEqual([]);
  await acknowledgePublicationPreview(page); expect(api.previewConfirmations).toHaveLength(1); await expect(publish(page)).toBeEnabled();
  await tab(page, '基础资料'); await expectNoPublicationControls(page); expect(writes).toBe(0);
  await tab(page, '发布预览'); await expect(publish(page)).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: acknowledge, exact: true })).not.toBeChecked();
  expect(writes).toBe(0); expect(api.previewConfirmations).toHaveLength(1);
});

test('publication tab a previously opened confirmation cannot publish after the active tab changes', async ({ page }) => {
  const item = { ...vehicle(), id }; await installApi(page, { items: [item] }); let writes = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => { writes++; return reply(route, envelope(item)); });
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '发布预览'); await expect(publish(page)).toBeEnabled(); await publish(page).click();
  const dialog = page.getByRole('dialog', { name: '发布当前已保存的草稿？', exact: true }); await expect(dialog).toBeVisible();
  // Simulate an active-tab transition while the modal's async handler is retained.
  await page.getByRole('tab', { name: /基础资料/ }).evaluate(node => (node as HTMLElement).click());
  await expect(page.getByRole('tab', { name: /基础资料/ })).toHaveAttribute('aria-selected', 'true'); await expectNoPublicationControls(page);
  await dialog.getByRole('button', { name: /确认操作$/ }).click(); await expect(dialog).toBeHidden();
  expect(writes).toBe(0); await tab(page, '发布预览');
  await expect(page.locator('.ant-alert-error').filter({ hasText: '请先进入发布预览检查后再发布' })).toBeVisible(); expect(writes).toBe(0);
});

test('publication tab unknown publication is recoverable only from preview with the exact original version body and key', async ({ page }) => {
  const item = { ...vehicle(), id }; await installApi(page, { items: [item] });
  const calls: Array<{ key?: string; body: string | null }> = [];
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => {
    calls.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    if (calls.length === 1) { Object.assign(item, { version: 2, publicationState: 'published', publishedRevisionId: 'synthetic-published', publishedAt: '2026-11-12T00:00:00Z', hasUnpublishedChanges: false }); return route.abort('failed'); }
    return reply(route, envelope(item));
  });
  await page.goto(`/admin/vehicles/${id}`); await tab(page, '发布预览'); await expect(publish(page)).toBeEnabled(); await publish(page).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.getByRole('button', { name: /重试原发布请求$/ })).toBeEnabled();
  const original = structuredClone(calls[0]!); expect(original.key).toBeTruthy(); expect(JSON.parse(original.body!)).toEqual({ version: 1 });
  await tab(page, '价格与内部信息'); await expectNoPublicationControls(page); expect(calls).toEqual([original]);
  await tab(page, '发布预览'); await page.getByRole('button', { name: /重试原发布请求$/ }).click();
  await expect(page.locator('.ant-message-success').filter({ hasText: '已确认当前公开版本' })).toBeVisible();
  expect(calls).toEqual([original, original]); await expect(publish(page)).toBeDisabled();
});
