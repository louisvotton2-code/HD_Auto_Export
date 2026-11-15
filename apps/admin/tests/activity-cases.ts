/** Activity UI contract simulations: no real employee, inventory or provider writes. */
import { expect, test, type Page } from '@playwright/test';
import type { ActivityEvent, AdminActivitySummary, ExternalIngestionStatus } from '@hd/contracts/admin';
import { makeExternalAdminFixture, makeExternalVehicleDraftFixture } from '@hd/contracts/fixtures';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { notes } from './ui-helpers';

const actor = { kind: 'staff' as const, staffId: 'staff_historical_1', name: '操作时姓名' };
const at = '2026-11-13T01:02:03.000Z';
const summary: AdminActivitySummary = {
  created: { at, actor }, lastModified: { at, actor },
  firstImported: { at: '2026-11-12T01:00:00.000Z', batchId: 'fixed-pilot-batch' },
  lastSyncedAt: '2026-11-13T03:00:00.000Z',
};
const event = (overrides: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: 'event-1', action: 'vehicle.save', at, actor, oldVersion: 0, newVersion: 1,
  detailState: 'recorded', changes: [], ...overrides,
});
const history = (page: Page) => page.getByRole('dialog', { name: '车辆操作记录' });
const clickHistory = (page: Page) => page.getByRole('button', { name: '操作记录', exact: true }).first().click();

test('activity event IDs distinguish overlapping vehicle and media versions and preserve readable action labels', async ({ page }) => {
  const record = vehicle();
  await installApi(page, { items: [record], permissions: ['vehicles:read'] });
  await page.route(`**/api/v1/admin/vehicles/${record.id}/activity?*`, route => reply(route, envelope({ items: [
    event({ id: 'title-save', oldVersion: 1, newVersion: 2, changes: [{ path: 'draft.content.title.sourceText', beforePresent: true, afterPresent: true, before: '修改前标题', after: '修改后标题' }, { path: 'draft.content.title.translations.zh.text', beforePresent: true, afterPresent: true, before: '修改前标题', after: '修改后标题' }] }),
    event({ id: 'image-upload', action: 'media.upload', oldVersion: 1, newVersion: 2, changes: [{ path: 'media.image-1.state', beforePresent: true, afterPresent: true, before: 'pending', after: 'uploaded' }] }),
    event({ id: 'image-create', action: 'media.create' }), event({ id: 'image-complete', action: 'media.complete' }), event({ id: 'image-delete', action: 'media.delete' }),
    event({ id: 'future-action', action: 'constructor' }),
  ], nextCursor: null })));
  await page.goto('/admin/vehicles'); await clickHistory(page);
  const drawer = history(page);
  await expect(drawer.getByText('版本 1 → 2', { exact: true })).toHaveCount(2);
  for (const label of ['申请图片上传', '图片文件上传完成', '图片处理完成', '删除图片', '其他操作（constructor）']) await expect(drawer.getByText(label, { exact: true })).toBeVisible();
  const saved = drawer.getByTestId('activity-event-title-save');
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText('保存草稿');
  await expect(saved).toContainText('版本 1 → 2');
  await saved.click();
  // Match the actual source/zh translation duplicate values from the second real-run trace.
  await expect(drawer.locator('pre').filter({ hasText: /^"修改前标题"$/ })).toHaveCount(2);
  const savedItem = drawer.locator('.ant-collapse-item').filter({ has: page.getByTestId('activity-event-title-save') });
  await expect(savedItem).toHaveCount(1);
  const titleDifference = savedItem.getByRole('region', { name: '车辆标题 · draft.content.title.sourceText的变更', exact: true });
  await expect(titleDifference).toHaveCount(1);
  const beforeTitle = titleDifference.locator('dl > div').filter({ has: page.getByText('变更前', { exact: true }) }).locator('pre');
  const afterTitle = titleDifference.locator('dl > div').filter({ has: page.getByText('变更后', { exact: true }) }).locator('pre');
  await expect(beforeTitle).toHaveCount(1);
  await expect(beforeTitle).toHaveJSProperty('textContent', JSON.stringify('修改前标题'));
  await expect(afterTitle).toHaveCount(1);
  await expect(afterTitle).toHaveJSProperty('textContent', JSON.stringify('修改后标题'));
  await expect(drawer.locator('pre').filter({ hasText: /^"uploaded"$/ })).toHaveCount(0);
});

test('activity read-only list shows historical identity and authoritative falsy and absent differences', async ({ page }) => {
  const record = { ...vehicle(), activity: summary };
  await installApi(page, { items: [record], permissions: ['vehicles:read'] });
  await page.route(`**/api/v1/admin/vehicles/${record.id}/activity?*`, route => {
    expect(new URL(route.request().url()).searchParams.get('limit')).toBe('20');
    expect(route.request().method()).toBe('GET');
    return reply(route, envelope({ items: [event({ changes: [
      { path: 'price.money.amount', beforePresent: true, afterPresent: true, before: 0, after: '0' },
      { path: 'hidden', beforePresent: true, afterPresent: true, before: false, after: true },
      { path: 'facts.engineCc', beforePresent: false, afterPresent: true, before: null, after: null },
      { path: 'content.description', beforePresent: true, afterPresent: true, before: '', after: '<script>throw 1</script>' },
    ] }), event({ id: 'old-event', action: 'historical.unknown', actor: { kind: 'unknown', staffId: null, name: null }, detailState: 'unknown', changes: null })], nextCursor: null }));
  });
  await page.goto('/admin/vehicles');
  await expect(page.getByText('操作时姓名', { exact: true })).toHaveCount(2);
  await expect(page.locator('dl[aria-label="员工与系统操作摘要"] [tabindex="0"]')).toHaveCount(2);
  await expect(page.getByRole('link', { name: '编辑', exact: true })).toHaveCount(0);
  await clickHistory(page);
  const drawer = history(page);
  await expect(drawer.getByText('UTC：' + at)).toHaveCount(2);
  await expect(drawer.getByText('2026/11/13 09:02:03（北京时间）', { exact: true })).toHaveCount(2);
  await drawer.getByText('保存草稿', { exact: true }).click();
  for (const value of ['0', '"0"', 'false', 'true', '未记录', 'null（空值）', '""（空字符串）', '"<script>throw 1</script>"']) {
    await expect(drawer.locator('pre').filter({ hasText: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toHaveCount(1);
  }
  await drawer.getByText('其他操作（historical.unknown）').click();
  await expect(drawer.getByText('历史差异未知', { exact: true })).toBeVisible();
  await expect(drawer.getByText('操作人未知', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^(保存|删除|恢复|回滚)$/ })).toHaveCount(0);
});

test('activity cursor failures do not display old events and refresh returns to page one', async ({ page }) => {
  const record = vehicle();
  await installApi(page, { items: [record] });
  const cursors: Array<string | null> = [];
  await page.route(`**/api/v1/admin/vehicles/${record.id}/activity?*`, route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); cursors.push(cursor);
    return cursor ? reply(route, error('FORBIDDEN'), 403)
      : reply(route, envelope({ items: [event()], nextCursor: 'opaque+cursor/one=' }));
  });
  await page.goto('/admin/vehicles'); await clickHistory(page);
  const drawer = history(page);
  await expect(drawer.getByText('保存草稿', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '下一页记录' }).click();
  await expect(drawer.getByText(/当前账号没有此操作权限/)).toBeVisible();
  await expect(drawer.getByText('保存草稿', { exact: true })).toHaveCount(0);
  await expect(drawer.getByText(/暂无可读取/)).toHaveCount(0);
  await drawer.getByRole('button', { name: '上一页记录' }).click();
  await expect(drawer.getByText('保存草稿', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '刷新操作记录' }).click();
  await expect.poll(() => cursors.length).toBe(4);
  expect(cursors).toEqual([null, 'opaque+cursor/one=', null, null]);
});

test('activity close and switch discard a late response from another vehicle', async ({ page }) => {
  const a = vehicle(), b = { ...vehicle(), id: 'fixture_second_vehicle', stockCode: 'SECOND-CAR' };
  await installApi(page, { items: [a, b], permissions: ['vehicles:read'] });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pending = false;
  let settled = false;
  await page.route(`**/api/v1/admin/vehicles/${a.id}/activity?*`, async route => { pending = true; await gate; await reply(route, envelope({ items: [event({ actor: { ...actor, name: '旧车敏感姓名' } })], nextCursor: 'old-cursor' })).catch(() => {}); settled = true; });
  await page.route(`**/api/v1/admin/vehicles/${b.id}/activity?*`, route => reply(route, envelope({ items: [event({ actor: { ...actor, name: '新车操作人' } })], nextCursor: null })));
  await page.goto('/admin/vehicles'); await clickHistory(page);
  await expect.poll(() => pending).toBe(true);
  await history(page).getByRole('button', { name: '关闭' }).click();
  await page.getByRole('row').filter({ hasText: 'SECOND-CAR' }).getByRole('button', { name: '操作记录' }).click();
  await expect(history(page).getByText('新车操作人 · 员工 ID staff_historical_1')).toBeVisible();
  release();
  await expect.poll(() => settled).toBe(true);
  await expect(history(page).getByText('旧车敏感姓名', { exact: false })).toHaveCount(0);
  await expect(history(page).getByRole('button', { name: '下一页记录' })).toBeDisabled();
});

test('activity expiration clears loaded history and requires an explicit fresh read after sign in', async ({ page }) => {
  const record = vehicle();
  const api = await installApi(page, { items: [record] });
  let reads = 0;
  await page.route(`**/api/v1/admin/vehicles/${record.id}/activity?*`, route => reply(route, envelope({ items: [event({ actor: { ...actor, name: ++reads === 1 ? '失效前姓名' : '重新读取姓名' } })], nextCursor: null })));
  await page.goto('/admin/vehicles'); await clickHistory(page);
  await expect(history(page).getByText('失效前姓名 · 员工 ID staff_historical_1')).toBeVisible();
  api.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('admin:unauthorized')));
  await expect(history(page).getByText('失效前姓名', { exact: false })).toHaveCount(0);
  const login = page.getByRole('dialog').filter({ hasText: '登录已失效' });
  await login.getByLabel('账号或工作邮箱').fill('fixture-editor');
  await login.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await login.getByRole('button', { name: /登录工作台$/ }).click();
  await history(page).getByRole('button', { name: '刷新操作记录' }).click();
  await expect(history(page).getByText('重新读取姓名 · 员工 ID staff_historical_1')).toBeVisible();
});

test('activity read permission works from recycle bin and viewing history preserves an editor draft', async ({ page }) => {
  const record = vehicle();
  await installApi(page, { items: [{ ...record, deletedAt: at }], permissions: ['vehicles:read'] });
  await page.route(`**/api/v1/admin/vehicles/${record.id}/activity?*`, route => reply(route, envelope({ items: [event({ action: 'vehicle.delete' })], nextCursor: null })));
  await page.goto('/admin/recycle-bin'); await clickHistory(page);
  await expect(history(page).getByText('删除车辆', { exact: true })).toBeVisible();
  await history(page).getByRole('button', { name: '关闭' }).click();
  await installApi(page, { items: [record] });
  await page.route(`**/api/v1/admin/vehicles/${record.id}/activity?*`, route => reply(route, envelope({ items: [event({ action: 'vehicle.delete' })], nextCursor: null })));
  await page.goto(`/admin/vehicles/${record.id}`);
  await (await notes(page)).fill('未保存输入保留');
  await clickHistory(page);
  await expect(history(page).getByText('删除车辆', { exact: true })).toBeVisible();
  await history(page).getByRole('button', { name: '关闭' }).click();
  await expect(await notes(page)).toHaveValue('未保存输入保留');
});

test('activity external history keeps system import separate and long differences fit a narrow screen', async ({ page }, testInfo) => {
  await installApi(page, { permissions: ['vehicles:read'] });
  const listing = { ...makeExternalAdminFixture().listing, activity: summary };
  await page.route('**/api/v1/admin/external/listings/overview*', route => reply(route, envelope({ total: 1, published: 1, hidden: 0, withdrawn: 0, platforms: [], makes: [], models: [], years: [] })));
  await page.route('**/api/v1/admin/external/listings?*', route => reply(route, envelope({ items: [{ id: listing.id, state: listing.state, platformId: listing.identity.platformId, externalId: listing.identity.externalId, provider: listing.identity.provider, title: '来源车', version: listing.version, fetchedAt: listing.fetchedAt, sourceUpdatedAt: listing.sourceUpdatedAt, publishedAt: null, hasOverrides: false, listingUrl: null, facts: null, activity: summary }], total: 1, page: 1, pageSize: 25 })));
  await page.route(`**/api/v1/admin/external/listings/${listing.id}?*`, route => reply(route, envelope(listing)));
  const long = '很长的配置字段'.repeat(70);
  await page.route(`**/api/v1/admin/external/listings/${listing.id}/activity?*`, route => reply(route, envelope({ items: [event({ action: 'external.override.save', changes: [{ path: 'facts.engineCc', beforePresent: true, afterPresent: true, before: 1989, after: 1990 }, { path: long, beforePresent: true, afterPresent: true, before: 'before'.repeat(300), after: 'after'.repeat(300) }] })], nextCursor: null })));
  await page.goto('/admin/public-catalog');
  await expect(page.getByText('首次系统导入', { exact: true })).toBeVisible();
  await expect(page.getByText('最近系统同步', { exact: true })).toBeVisible();
  await expect(page.getByText('最近人工修改', { exact: true })).toBeVisible();
  await clickHistory(page);
  await expect(history(page).getByText('保存人工修订', { exact: true })).toBeVisible();
  await history(page).getByRole('button', { name: '关闭' }).click();
  await page.goto(`/admin/external-sources/listings/${listing.id}`);
  await page.setViewportSize({ width: 320, height: 850 });
  await clickHistory(page);
  await history(page).getByText('保存人工修订', { exact: true }).click();
  await expect(history(page).getByText(long, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await history(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(history(page).locator('pre').last()).toHaveText(JSON.stringify('after'.repeat(300)));
  await page.screenshot({ path: testInfo.outputPath('activity-320.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('activity-desktop.png'), animations: 'disabled' });
});


test('activity employee-managed external copies retain creator identity in list detail and recycle bin', async ({ page }) => {
  const record = vehicle();
  record.draft = makeExternalVehicleDraftFixture();
  record.activity = { ...summary, firstImported: null };
  const api = await installApi(page, { items: [record] });
  await page.setViewportSize({ width: 1200, height: 960 });
  await page.goto('/admin/vehicles');
  await expect(page.getByText('操作时姓名', { exact: true })).toHaveCount(2);
  const listGeometry = () => page.locator('.table-region .ant-table-content').evaluate(element => ({ pageWidth: document.documentElement.scrollWidth, tableScrolls: element.scrollWidth > element.clientWidth }));
  await expect.poll(listGeometry).toEqual({ pageWidth: 1200, tableScrolls: false });
  await page.goto(`/admin/vehicles/${record.id}`);
  await expect(page.getByText('操作时姓名 · 员工 ID staff_historical_1')).toHaveCount(2);
  api.items[0].deletedAt = at;
  await page.goto('/admin/recycle-bin');
  await expect(page.getByText('操作时姓名', { exact: true })).toHaveCount(2);
  await expect.poll(listGeometry).toEqual({ pageWidth: 1200, tableScrolls: false });
});

const ingestionJob: NonNullable<ExternalIngestionStatus['latestJob']> = {
  id: '00000000-0000-4000-8000-000000000123', state: 'paused',
  createdAt: at, generatedAt: at, completedAt: null, triggeredByStaffId: 'trigger_staff_1',
  receivedEvents: 12, appliedEvents: 7, rawIdentityCount: 345, canonicalVehicleCount: 300,
  publicVehicleCount: 298, networkRequests: 18, failures: 2, recoveryCount: 0,
};

test('activity fixed import status keeps raw canonical public and received applied counts distinct', async ({ page }) => {
  await installApi(page, { permissions: ['vehicles:read'] });
  await page.route('**/api/v1/admin/external/ingestion-status', route => reply(route, envelope({ mode: 'fixed_once', continuous: false, latestJob: ingestionJob })));
  await page.route('**/api/v1/admin/external/status', route => reply(route, envelope({ catalogRevision: '1', sync: 'manual_import_only', translation: 'dry_run', lastBatch: null, batchCharacterLimit: 100000, accountFreeRemaining: null })));
  await page.route('**/api/v1/admin/external/batches?*', route => reply(route, envelope({ items: [], total: 0, page: 1, pageSize: 25 })));
  await page.goto('/admin/external-sources/batches');
  const card = page.locator('.ant-card').filter({ has: page.getByText('历史固定名单导入任务', { exact: true }) });
  await expect(card.getByText('已暂停，待处理', { exact: true })).toBeVisible();
  await expect(card.getByText('持续调度关闭', { exact: true })).toBeVisible();
  for (const value of ['345', '300', '298', '12', '7', '18', '2', '0']) await expect(card.getByText(value, { exact: true })).toBeVisible();
  await expect(card.getByText('trigger_staff_1', { exact: true })).toBeVisible();
  await expect(card.getByText('尚未完成', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: /开始|恢复|全量|开启/ })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.route('**/api/v1/admin/external/ingestion-status', route => reply(route, error('SERVICE_UNAVAILABLE'), 503));
  await card.getByRole('button', { name: '刷新正式导入状态' }).click();
  await expect(card.getByText(/服务暂时不可用/)).toBeVisible();
  await expect(card.getByText('持续调度关闭', { exact: true })).toHaveCount(0);
  await expect(card.getByText('345', { exact: true })).toHaveCount(0);
});

test('activity source documents are read on demand as full inert text with cursor and retry isolation', async ({ page }) => {
  await installApi(page, { permissions: ['vehicles:read'] });
  const listing = makeExternalAdminFixture().listing;
  await page.route(`**/api/v1/admin/external/listings/${listing.id}?*`, route => reply(route, envelope(listing)));
  const root = `/api/v1/admin/external/listings/${listing.id}/source-documents`;
  const first = { id: '00000000-0000-4000-8000-000000000101', kind: 'detail', locale: 'zh', hash: 'a'.repeat(64), firstObservedAt: at, lastObservedAt: at, sourceUpdatedAt: null };
  const second = { ...first, id: '00000000-0000-4000-8000-000000000102', hash: 'b'.repeat(64), locale: 'ru', kind: 'specs' };
  let directoryReads = 0, bodyReads = 0, secondReads = 0;
  const raw = '<script>window.sourceDocumentExecuted=true</script>' + '完整原文'.repeat(1000);
  await page.route(`**${root}?*`, route => {
    directoryReads++;
    expect(route.request().method()).toBe('GET');
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('limit')).toBe('20');
    return reply(route, envelope(query.has('cursor') ? { items: [second], nextCursor: null } : { items: [first], nextCursor: 'doc+next/=' }));
  });
  await page.route(`**${root}/*`, route => {
    bodyReads++;
    expect(route.request().method()).toBe('GET');
    if (route.request().url().endsWith(second.id)) {
      if (++secondReads === 1) return reply(route, error('NOT_FOUND'), 404);
      return reply(route, envelope({ ...second, payload: false, rawText: null, response: null }));
    }
    return reply(route, envelope({ ...first, payload: { complete: true, count: 0, source: '<script>not executable</script>' }, rawText: raw, response: { hash: 'c'.repeat(64), shared: true } }));
  });
  await page.goto(`/admin/external-sources/listings/${listing.id}`);
  await expect(page.getByRole('button', { name: '查看供应商原档' })).toBeVisible();
  expect(directoryReads).toBe(0); expect(bodyReads).toBe(0);
  await page.getByRole('button', { name: '查看供应商原档' }).click();
  await expect(page.getByText('CSV来源记录 · 中文', { exact: true })).toHaveCount(0);
  await expect(page.getByText('车辆详情 · 中文', { exact: true })).toBeVisible();
  expect(bodyReads).toBe(0);
  await page.getByRole('button', { name: '读取正文' }).click();
  const body = page.getByRole('region', { name: '供应商文档正文' });
  await expect(body.locator('pre').last()).toHaveText(raw);
  await expect(body.getByText('共享批量响应仅显示归档摘要', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).sourceDocumentExecuted)).toBeUndefined();
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: '下一页原档' }).click();
  await expect(body).toHaveCount(0);
  await page.getByRole('button', { name: '读取正文' }).click();
  await expect(body.getByText(/未找到这条记录/)).toBeVisible();
  await expect(body.locator('pre')).toHaveCount(0);
  await page.getByRole('button', { name: '读取正文' }).click();
  await expect(body.locator('pre')).toHaveText('false');
  await expect(body.getByText(/没有保存独立的单车原文字串/)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('admin:unauthorized')));
  await expect(body.locator('pre')).toHaveCount(0);
  expect(bodyReads).toBe(3);
});
