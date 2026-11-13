/** EXT07 browser contract simulations, run by OPS in server isolation only. */
import { expect, test, type Page } from '@playwright/test';
import { ExternalFullSyncControlSchema } from '@hd/contracts/admin';
import { makeExternalAdminFixture } from '@hd/contracts/fixtures';
import { envelope, error, installApi, reply, staff } from './api-fixture';
import { syncStatus } from './sync-fixture';
import { select } from './ui-helpers';

const root = '/api/v1/admin/external';
const ui = '/admin/external-sources';
async function setup(page: Page, admin = false) {
  await installApi(page, { permissions: ['vehicles:read'] });
  await page.route('**/api/v1/admin/me', route => reply(route, envelope({ ...staff, role: admin ? 'admin' : 'editor', permissions: ['vehicles:read'] })));
  await page.route(`**${root}/provider-status`, route => reply(route, envelope({ provider: 'chinacarapi', worker: 'continuous', lastBatch: null, lastImportAt: null, lastFetchedAt: null, lastSupplierUpdatedAt: null,
    account: { state: 'not_configured', checkedAt: null, plan: null, expiresAt: null, sources: [], dailyLimit: null, remainingToday: null } })));
  await page.route(`**${root}/sync-status`, route => reply(route, envelope(syncStatus())));
}
const card = (page: Page) => page.locator('.ant-card').filter({ has: page.getByText('全量与持续同步', { exact: true }) });

test('EXT07 sync read-only progress separates real counts pending classes and failed reads', async ({ page }) => {
  await setup(page);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/sync-control')) writes++; });
  await page.goto(ui);
  const panel = card(page);
  for (const [label, value] of [['来源记录', '410'], ['去重车辆', '300'], ['当前公开车辆', '290'], ['来源撤回', '10'], ['失败记录', '2'], ['待补详情', '30'], ['待补语言项', '20'], ['待补报告', '0']]) {
    const metric = panel.locator('.ant-statistic').filter({ has: page.getByText(label, { exact: true }) });
    await expect(metric.locator('.ant-statistic-content-value')).toHaveText(value);
  }
  await expect(panel.getByText('已接收事件', { exact: true })).toBeVisible();
  await expect(panel.getByText('900', { exact: true })).toBeVisible();
  await expect(panel.getByText('870', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: /暂停|恢复/ })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 850 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.route(`**${root}/sync-status`, route => reply(route, error('SERVICE_UNAVAILABLE'), 503));
  await panel.getByRole('button', { name: '刷新同步进度' }).click();
  await expect(panel.getByText(/服务暂时不可用/)).toBeVisible();
  await expect(panel.locator('.ant-statistic')).toHaveCount(0);
  await expect(panel.getByText('重任务未暂停', { exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});

test('EXT07 administrator confirms versioned pause and resume without duplicate submissions', async ({ page }) => {
  await setup(page, true);
  let current = syncStatus();
  await page.route(`**${root}/sync-status`, route => reply(route, envelope(current)));
  const writes: Array<{ body: unknown; key: string | undefined }> = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${root}/sync-control`, async route => {
    const input = ExternalFullSyncControlSchema.parse(route.request().postDataJSON());
    writes.push({ body: input, key: route.request().headers()['idempotency-key'] });
    if (writes.length === 1) await gate;
    current = syncStatus({ version: input.version + 1, paused: input.action === 'pause', state: input.action === 'pause' ? 'paused' : 'syncing' });
    return reply(route, envelope(current));
  });
  await page.goto(ui);
  await card(page).getByRole('button', { name: '暂停同步重任务', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认暂停同步重任务' });
  await expect(confirm).toContainText('来源撤回处理保持可用');
  await confirm.getByRole('button', { name: '确认暂停', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(confirm.getByRole('button', { name: '确认暂停', exact: true })).toBeDisabled();
  await expect(card(page).getByRole('button', { name: '刷新同步进度' })).toBeDisabled();
  expect(writes[0].body).toEqual({ version: 7, action: 'pause' });
  expect(writes[0].key).toMatch(/^[a-f0-9-]{36}$/);
  release();
  await card(page).getByRole('button', { name: '恢复同步重任务', exact: true }).click();
  await page.getByRole('dialog', { name: '确认恢复同步重任务' }).getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(card(page).getByRole('button', { name: '暂停同步重任务', exact: true })).toBeEnabled();
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual({ version: 8, action: 'resume' });
  expect(writes[1].key).not.toBe(writes[0].key);
});

test('EXT07 uncertain control retains the original body and key across a safe status refresh', async ({ page }) => {
  await setup(page, true);
  let current = syncStatus();
  let reads = 0;
  await page.route(`**${root}/sync-status`, route => { reads++; return reply(route, envelope(current)); });
  const writes: Array<{ body: string | null; key: string | undefined }> = [];
  await page.route(`**${root}/sync-control`, route => {
    writes.push({ body: route.request().postData(), key: route.request().headers()['idempotency-key'] });
    current = syncStatus({ version: 8, paused: true, state: 'paused' });
    return writes.length === 1 ? route.abort('failed') : reply(route, envelope(current));
  });
  await page.goto(ui);
  await card(page).getByRole('button', { name: '暂停同步重任务', exact: true }).click();
  await page.getByRole('dialog', { name: '确认暂停同步重任务' }).getByRole('button', { name: '确认暂停', exact: true }).click();
  await expect(card(page).getByText('操作结果尚未确认', { exact: true })).toBeVisible();
  await card(page).getByRole('button', { name: '刷新同步进度' }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(card(page).getByRole('button', { name: '恢复同步重任务', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(1);
  await card(page).getByRole('button', { name: '重试原请求', exact: true }).click();
  await expect(card(page).getByRole('button', { name: '恢复同步重任务', exact: true })).toBeEnabled();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test('EXT07 stale versions and forbidden controls require a fresh read without claiming success', async ({ page }) => {
  await setup(page, true);
  let current = syncStatus(), attempts = 0;
  await page.route(`**${root}/sync-status`, route => reply(route, envelope(current)));
  await page.route(`**${root}/sync-control`, route => {
    current = syncStatus({ version: 8 });
    return reply(route, error(++attempts === 1 ? 'VERSION_CONFLICT' : 'FORBIDDEN'), attempts === 1 ? 409 : 403);
  });
  await page.goto(ui);
  async function pause() {
    await card(page).getByRole('button', { name: '暂停同步重任务', exact: true }).click();
    await page.getByRole('dialog', { name: '确认暂停同步重任务' }).getByRole('button', { name: '确认暂停', exact: true }).click();
  }
  await pause();
  await expect(card(page).getByText(/记录已被其他同事更新/)).toBeVisible();
  await expect(card(page).getByRole('button', { name: '暂停同步重任务', exact: true })).toBeDisabled();
  await card(page).getByRole('button', { name: '重新读取同步状态', exact: true }).click();
  await pause();
  await expect(card(page).getByText(/当前账号没有此操作权限/)).toBeVisible();
  await expect(card(page).getByRole('button', { name: '暂停同步重任务', exact: true })).toBeDisabled();
  expect(attempts).toBe(2);
  await expect(page.getByText('本次同步控制请求已确认，正在读取最新状态。', { exact: true })).toHaveCount(0);
});

test('EXT07 full snapshot disabled setup and persistent protection remain distinct from completion', async ({ page }) => {
  await setup(page, true);
  const safeError = '<script>window.syncErrorExecuted=true</script>来源暂不可用';
  let current = syncStatus({ mode: 'full', state: 'snapshot', lastSuccessAt: null,
    lastError: { code: 'UPSTREAM_UNAVAILABLE', message: safeError, at: '2026-11-14T01:00:00.000Z' } });
  await page.route(`**${root}/sync-status`, route => reply(route, envelope(current)));
  await page.goto(ui);
  const panel = card(page);
  await expect(panel.getByText('正式全量同步', { exact: true })).toBeVisible();
  await expect(panel.getByText('接收与校验来源快照', { exact: true })).toBeVisible();
  await expect(panel.getByText('尚无成功记录', { exact: true })).toBeVisible();
  await expect(panel.getByText(/快照仍在处理/)).toBeVisible();
  await expect(panel.getByText(safeError)).toBeVisible();
  expect(await page.evaluate(() => 'syncErrorExecuted' in window)).toBe(false);
  await expect(panel.getByText('当前同步阶段完成', { exact: true })).toHaveCount(0);
  current = syncStatus({ state: 'disabled', snapshot: null });
  await panel.getByRole('button', { name: '刷新同步进度' }).click();
  await expect(panel.getByRole('button', { name: '暂停同步重任务', exact: true })).toBeDisabled();
  await expect(panel.getByText('正式同步未启用', { exact: true })).toBeVisible();
  current = syncStatus({ state: 'paused', paused: true });
  await panel.getByRole('button', { name: '刷新同步进度' }).click();
  let writes = 0;
  await page.route(`**${root}/sync-control`, route => {
    writes++;
    current = syncStatus({ version: 8, state: 'paused', paused: true });
    return reply(route, envelope(current));
  });
  await panel.getByRole('button', { name: '恢复同步重任务', exact: true }).click();
  await page.getByRole('dialog', { name: '确认恢复同步重任务' }).getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(panel.getByRole('button', { name: '恢复同步重任务', exact: true })).toBeEnabled();
  await expect(panel.getByText('重任务暂停中', { exact: true })).toBeVisible();
  await expect(panel.getByText('操作结果尚未确认', { exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
});

test('EXT07 short inquiry codes preserve source URL and old identifier search and private originals', async ({ page }) => {
  await setup(page);
  const listing = makeExternalAdminFixture().listing;
  listing.inquiryCode = 'che168-000123';
  listing.identity.platformId = 'che168';
  if (listing.source) listing.source.platformId = 'che168';
  const originalUrl = 'https://example.invalid/listing/000123?lang=ru&x=1';
  const summary = { ...listing.identity, id: listing.id, version: listing.version, listingUrl: originalUrl, title: '短编号测试车辆', state: listing.state, fetchedAt: listing.fetchedAt, sourceUpdatedAt: listing.sourceUpdatedAt, publishedAt: null, hasOverrides: false, inquiryCode: listing.inquiryCode, facts: null };
  await page.route(`**${root}/listings/overview*`, route => reply(route, envelope({ total: 1, published: 1, hidden: 0, withdrawn: 0, platforms: ['che168'], makes: [], models: [], years: [] })));
  const queries: Array<{ q: string | null; platform: string | null }> = [];
  await page.route(`**${root}/listings?*`, route => {
    const params = new URL(route.request().url()).searchParams;
    queries.push({ q: params.get('q'), platform: params.get('platformId') });
    return reply(route, envelope({ items: [summary], total: 1, page: 1, pageSize: 25 }));
  });
  await page.route(`**${root}/listings/${listing.id}?*`, route => reply(route, envelope(listing)));
  let rawReads = 0;
  page.on('request', request => { if (request.url().includes('/source-documents')) rawReads++; });
  await page.goto('/admin/public-catalog');
  await expect(page.getByText('询价编号：che168-000123', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '访问原站', exact: true })).toHaveAttribute('href', originalUrl);
  await select(page, '来源平台', '车168');
  for (const value of [listing.inquiryCode, originalUrl, listing.id]) {
    await page.getByRole('searchbox', { name: '搜索三方车源' }).fill(value);
    await page.getByRole('searchbox', { name: '搜索三方车源' }).press('Enter');
    await expect.poll(() => queries.some(query => query.q === value && query.platform === 'che168')).toBe(true);
  }
  await page.getByRole('link', { name: '短编号测试车辆', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/external-sources/listings/${listing.id}`));
  await expect(page.getByText('询价编号：che168-000123', { exact: true })).toBeVisible();
  await expect(page.getByText(`旧站内车源 ID ${listing.id}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看供应商原档', exact: true })).toBeVisible();
  expect(rawReads).toBe(0);
});
