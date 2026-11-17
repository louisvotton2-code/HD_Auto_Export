/** Publication contract simulations. Trilingual import is covered in configuration-import-cases. */
import { expect, test, type Page, type Route } from '@playwright/test';
import type { AdminVehicle } from '@hd/contracts/admin';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { notes, select, tab } from './ui-helpers';
import { captureFixtureEvidence } from './fixture-evidence';
import { waitForPublicationPreview, chooseYear } from './publication-test-helpers';

const id = '30000000-0000-4000-8000-000000000001';
function publishedVehicle(): AdminVehicle {
  return { ...vehicle(), id, publicationState: 'published', publishedRevisionId: 'fixture_revision', publishedAt: '2026-11-08T08:00:00Z', availability: 'available', availabilityCheckedAt: '2026-11-08T08:00:00Z', hasUnpublishedChanges: false };
}
const publishButton = (page: Page) => page.getByTestId('vehicle-publish');
function requestSnapshot(route: Route) { return { key: route.request().headers()['idempotency-key'], body: route.request().postData() }; }
async function openPreview(page: Page, record: AdminVehicle) { await page.goto(`/admin/vehicles/${record.id}`); await tab(page, '发布预览'); }

test('publication inventory is aligned above the grouped publish and archive actions', async ({ page }) => {
  const record = publishedVehicle();
  await installApi(page, { items: [record] });
  await openPreview(page, record);
  const selectControl = page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '核验后的库存状态' }) });
  const verify = page.getByRole('button', { name: '核验并更新库存' });
  const actions = page.getByRole('group', { name: '发布与下架' });
  await expect(actions.getByTestId('vehicle-publish')).toBeVisible();
  await expect(actions.getByRole('button', { name: '下架车辆' })).toBeVisible();
  const desktop = (await selectControl.boundingBox())!;
  const verifyPosition = (await verify.boundingBox())!;
  expect(Math.abs(desktop.y + desktop.height - verifyPosition.y - verifyPosition.height)).toBeLessThan(2);
  expect(verifyPosition.y + verifyPosition.height).toBeLessThan((await actions.boundingBox())!.y);
  await page.setViewportSize({ width: 375, height: 844 });
  await expect(verify).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await verify.boundingBox())!.y).toBeLessThan((await actions.boundingBox())!.y);
});

test('publication unchanged state survives refresh and internal or inventory changes do not unlock publishing', async ({ page }) => {
  const record = publishedVehicle(); const api = await installApi(page, { items: [record] });
  await page.route(`**/api/v1/admin/vehicles/${id}/availability`, route => { const body = route.request().postDataJSON(); Object.assign(record, { version: record.version + 1, availability: body.availability, availabilityCheckedAt: body.checkedAt }); return reply(route, envelope(record)); });
  await openPreview(page, record);
  await expect(publishButton(page)).toHaveText(/已发布，暂无待发布修改/); await expect(publishButton(page)).toBeDisabled();
  await page.reload(); await tab(page, '发布预览'); await expect(publishButton(page)).toBeDisabled();
  await (await notes(page)).fill('只修改内部备注');
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(record.hasUnpublishedChanges).toBe(false);
  await expect(page.locator('.ant-alert-success').filter({ hasText: '草稿已保存，对外内容已是最新，无需重复发布。' })).toBeVisible();
  await tab(page, '发布预览'); await expect(publishButton(page)).toBeDisabled();
  await select(page, '核验后的库存状态', '已售');
  await page.getByRole('button', { name: /核验并更新库存$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.locator('.ant-message-success').filter({ hasText: '库存状态和核验时间已更新' })).toBeVisible();
  await expect(page.locator('.ant-alert-success').filter({ hasText: '官网库存已同步，无需再次保存或发布。' })).toBeVisible();
  expect(record.hasUnpublishedChanges).toBe(false); await expect(publishButton(page)).toBeDisabled();
});

test('publication recovers verified inventory when a newer readiness read arrives before a lost stock receipt', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true };
  const api = await installApi(page, { items: [record], publicationDefaultConfirmed: false });
  let stockCalls = 0;
  let publishCalls = 0;
  let releaseStock!: () => void;
  const stockReceipt = new Promise<void>(resolve => { releaseStock = resolve; });
  await page.route(`**/api/v1/admin/vehicles/${id}/availability`, async route => {
    stockCalls++;
    const input = route.request().postDataJSON();
    expect(input.version).toBe(record.version);
    Object.assign(record, { version: record.version + 1, availability: input.availability, availabilityCheckedAt: input.checkedAt });
    await stockReceipt;
    return route.abort('failed');
  });
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => {
    publishCalls++;
    expect(route.request().postDataJSON()).toEqual({ version: record.version });
    Object.assign(record, { version: record.version + 1, hasUnpublishedChanges: false, publishedRevisionId: 'fixture_revision_2' });
    return reply(route, envelope(record));
  });
  await openPreview(page, record);
  await expect(publishButton(page)).toBeEnabled();
  await select(page, '核验后的库存状态', '已预订');
  await page.getByRole('button', { name: '核验并更新库存' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认操作' }).click();
  try {
    await expect.poll(() => stockCalls).toBe(1);
    const readiness = page.waitForResponse(response => response.url().includes('/publish-readiness?'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect((await (await readiness).json()).data.vehicleVersion).toBe(record.version);
    await expect(page.getByText('服务端车辆版本已变化，当前发布检查未采用。请核对最新车辆资料。')).toBeVisible();
  } finally {
    releaseStock();
  }
  const readCurrent = page.getByRole('button', { name: /读取当前状态$/ });
  await expect(readCurrent).toBeEnabled();
  await expect(publishButton(page)).toBeDisabled();
  expect(api.previewConfirmations).toEqual([]);
  await readCurrent.click({ timeout: 4000 });
  await page.getByRole('button', { name: '采用核对到的版本，结束本次重试' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认操作' }).click();
  await expect(page.getByText('车辆已被其他操作更新', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/当前：已预订/)).toBeVisible();
  expect(stockCalls).toBe(1);
  expect(publishCalls).toBe(0);

  const stockVersion = record.version;
  await tab(page, '基础资料');
  await chooseYear(page, '年款', 2025);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0]).toMatchObject({ version: stockVersion });
  await waitForPublicationPreview(page);
  await publishButton(page).click();
  await expect(publishButton(page)).toHaveText('已发布，暂无待发布修改');
  expect(api.previewConfirmations).toHaveLength(1);
  expect(publishCalls).toBe(1);
});

test('publication inventory mutation still reports a definitive version conflict', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true };
  const api = await installApi(page, { items: [record] });
  await page.route(`**/api/v1/admin/vehicles/${id}/availability`, route => {
    record.version++;
    return reply(route, error('VERSION_CONFLICT'), 409);
  });
  await openPreview(page, record);
  await select(page, '核验后的库存状态', '已预订');
  await page.getByRole('button', { name: /核验并更新库存$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.getByText('车辆已被其他操作更新', { exact: true })).toBeVisible();
  await expect(publishButton(page)).toBeDisabled();
  await expect(page.getByText('库存核验结果尚未确认', { exact: true })).toHaveCount(0);
  expect(api.previewConfirmations).toEqual([]);
});

test('publication saved public changes remain publishable after a successful inventory update', async ({ page }) => {
  const record = publishedVehicle(); const api = await installApi(page, { items: [record] });
  await page.route(`**/api/v1/admin/vehicles/${id}/availability`, route => {
    const input = route.request().postDataJSON();
    expect(input.version).toBe(record.version);
    Object.assign(record, { version: record.version + 1, availability: input.availability, availabilityCheckedAt: input.checkedAt });
    return reply(route, envelope(record));
  });
  await page.goto(`/admin/vehicles/${id}`);
  await chooseYear(page, '年款', 2025);
  await page.getByRole('button', { name: /保存草稿$/ }).click(); await expect.poll(() => api.saves.length).toBe(1);
  expect(record.hasUnpublishedChanges).toBe(true);
  await waitForPublicationPreview(page);
  await select(page, '核验后的库存状态', '已预订');
  await page.getByRole('button', { name: /核验并更新库存$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.locator('.ant-alert-success').filter({ hasText: '资料发布请继续核对当前草稿。' })).toBeVisible();
  await expect(publishButton(page)).toBeEnabled();
  expect(record.hasUnpublishedChanges).toBe(true);
  expect(api.previewConfirmations).toEqual([]);
});

test('publication same-task double clicks create one confirmation and one request, then success is visible and publishing disables', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; const api = await installApi(page, { items: [record] });
  let calls = 0; let release!: () => void; const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, async route => { calls++; await pause; Object.assign(record, { version: 2, hasUnpublishedChanges: false, publishedRevisionId: 'fixture_revision_2' }); return reply(route, envelope(record)); });
  await openPreview(page, record);
  await expect(publishButton(page)).toBeEnabled();
  await publishButton(page).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect.poll(() => calls).toBe(1);
  expect(api.previewConfirmations).toHaveLength(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(publishButton(page)).toBeDisabled();
  release();
  await expect(page.locator('.ant-message-success').filter({ hasText: '已确认当前公开版本' })).toBeVisible();
  await expect(page.locator('.ant-alert-success').filter({ hasText: '已确认当前公开版本' })).toBeVisible();
  await expect(publishButton(page)).toHaveText(/已发布，暂无待发布修改/); await expect(publishButton(page)).toBeDisabled();
  await captureFixtureEvidence(page, 'published-disabled');
  await page.reload(); await tab(page, '发布预览'); await expect(publishButton(page)).toBeDisabled(); expect(calls).toBe(1);
});

test('publication a definitive validation failure has a toast and a persistent recovery message', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; await installApi(page, { items: [record] });
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => reply(route, error('PUBLISH_VALIDATION_FAILED'), 422));
  await openPreview(page, record); await publishButton(page).click();
  await expect(page.locator('.ant-message-error').filter({ hasText: '尚未满足发布条件' })).toBeVisible();
  await expect(page.locator('.ant-alert-error').filter({ hasText: '尚未满足发布条件' })).toBeVisible();
  await expect(publishButton(page)).toBeEnabled();
});

test('publication an unknown original request remains retryable even after the server reports no unpublished changes', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; await installApi(page, { items: [record] });
  const calls: ReturnType<typeof requestSnapshot>[] = [];
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => {
    calls.push(requestSnapshot(route));
    if (calls.length === 1) { Object.assign(record, { version: 2, hasUnpublishedChanges: false, publishedRevisionId: 'fixture_revision_2' }); return route.abort('failed'); }
    return reply(route, envelope(record));
  });
  await openPreview(page, record); await publishButton(page).click();
  await expect(page.getByRole('button', { name: /重试原发布请求$/ })).toBeEnabled();
  await page.getByRole('button', { name: /重试原发布请求$/ }).click();
  await expect(page.locator('.ant-message-success').filter({ hasText: '已确认当前公开版本' })).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); await expect(publishButton(page)).toBeDisabled();
});

test('publication missing historical comparison requires a fresh read before showing the unchanged state', async ({ page }) => {
  const record: AdminVehicle = { ...publishedVehicle(), hasUnpublishedChanges: null }; await installApi(page, { items: [record] });
  let publishes = 0;
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => { publishes++; return reply(route, error('INTERNAL_ERROR'), 500); });
  await openPreview(page, record);
  await expect(page.getByText('发布差异待核对', { exact: true })).toBeVisible();
  await expect(publishButton(page)).not.toHaveText('已发布，暂无待发布修改');
  record.hasUnpublishedChanges = false;
  await page.getByRole('button', { name: /^(?:reload )?核对发布状态$/ }).click();
  await expect(publishButton(page)).toHaveText(/已发布，暂无待发布修改/); await expect(publishButton(page)).toBeDisabled();
  expect(publishes).toBe(0);
});

test('publication a replayed publish receipt cannot announce success after the current vehicle was deleted', async ({ page }) => {
  const record = { ...publishedVehicle(), hasUnpublishedChanges: true }; await installApi(page, { items: [record] });
  let calls = 0; const receipt = { ...structuredClone(record), version: 2, hasUnpublishedChanges: false, publishedRevisionId: 'fixture_revision_2' };
  await page.route(`**/api/v1/admin/vehicles/${id}/publish`, route => {
    calls++;
    if (calls === 1) { Object.assign(record, { ...receipt, deletedAt: '2026-11-08T09:00:00Z', version: 3 }); return route.abort('failed'); }
    return reply(route, envelope(receipt));
  });
  await openPreview(page, record); await publishButton(page).click();
  await page.getByRole('button', { name: /重试原发布请求$/ }).click();
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-message-info').filter({ hasText: '回收站' })).toBeVisible();
  await expect(page.locator('.ant-message-success').filter({ hasText: '已确认当前公开版本' })).toHaveCount(0);
  expect(calls).toBe(2);
});
