/** Contract simulations: these tests do not establish real API persistence. */
import { expect, test, type Page, type Route } from '@playwright/test';
import { makeExternalVehicleDraftFixture } from '@hd/contracts/fixtures';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { notes, select, tab } from './ui-helpers';

const deletedTime = '2026-11-08T09:00:00Z';
function deletedVehicle() { return { ...vehicle(), deletedAt: deletedTime, publicationState: 'published' as const, version: 7, publishedRevisionId: 'fixture_revision', publishedAt: deletedTime, availability: 'available' as const, availabilityCheckedAt: deletedTime }; }
async function openDelete(page: Page) {
  await tab(page, '三语与发布');
  await page.getByRole('button', { name: /删除车辆$/ }).click();
  await expect(page.getByRole('dialog', { name: '删除到回收站？', exact: true })).toBeVisible();
}
async function confirm(page: Page, operation: '删除' | '恢复') {
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`确认${operation}$`) }).click();
}
function attempt(route: Route) { return { key: route.request().headers()['idempotency-key'], body: route.request().postData() }; }

test('lifecycle delete is explicit, cancelling writes nothing and confirmation removes the normal list row', async ({ page }) => {
  const original = vehicle();
  const api = await installApi(page, { items: [original] });
  await page.goto(`/admin/vehicles/${original.id}`);
  await openDelete(page);
  await expect(page.getByRole('dialog')).toContainText(/回收站/);
  await page.getByRole('dialog').getByRole('button', { name: /取\s*消$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.lifecycle).toHaveLength(0);
  await openDelete(page);
  await confirm(page, '删除');
  await expect.poll(() => api.lifecycle.length).toBe(1);
  expect(api.lifecycle[0]).toMatchObject({ operation: 'delete', body: '{"version":1}' });
  expect(api.lifecycle[0]!.key).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);
  await page.goto('/admin/vehicles');
  await expect(page.getByText(original.stockCode, { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: /回收站/ }).first().click();
  await expect(page).toHaveURL(/\/admin\/recycle-bin$/);
  await expect(page.getByText(original.stockCode, { exact: true })).toBeVisible();
});

test('lifecycle recycle list requests deleted only; deleted details stay read only without any media reads', async ({ page }) => {
  const deleted = deletedVehicle();
  const alive = { ...vehicle(), id: 'fixture_alive', stockCode: 'ALIVE-0002' };
  await installApi(page, { items: [deleted, alive] });
  const queries: URL[] = []; const mediaReads: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/admin/vehicles') queries.push(url);
    if (/\/api\/v1\/(?:admin\/)?media\//.test(url.pathname)) mediaReads.push(url.pathname);
  });
  await page.goto('/admin/recycle-bin');
  await expect(page.getByText(deleted.stockCode, { exact: true })).toBeVisible();
  await expect(page.getByText(alive.stockCode, { exact: true })).toHaveCount(0);
  expect(queries.length).toBeGreaterThan(0);
  expect(queries.every(url => url.searchParams.get('deleted') === 'only')).toBe(true);
  const details = page.waitForRequest(request => new URL(request.url()).pathname === `/api/v1/admin/vehicles/${deleted.id}`);
  await page.getByRole('link', { name: 'Example Sample vehicle' }).click();
  expect(new URL((await details).url()).searchParams.get('includeDeleted')).toBe('true');
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /保存草稿|发布车辆|下架车辆|核验并更新库存/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '标题原文', exact: true })).toHaveCount(0);
  await expect(page.locator('input[type=file], main img')).toHaveCount(0);
  expect(mediaReads).toEqual([]);
});

test('lifecycle restore keeps the draft and media but becomes unpublished with unknown inventory', async ({ page }) => {
  const deleted = deletedVehicle(); const before = structuredClone(deleted.draft);
  const api = await installApi(page, { items: [deleted] });
  await page.goto(`/admin/vehicles/${deleted.id}`);
  await page.getByRole('button', { name: /恢复车辆$/ }).click();
  await expect(page.getByRole('dialog')).toContainText(/草稿|库存未知/);
  await confirm(page, '恢复');
  await expect(page.getByRole('textbox', { name: '标题原文', exact: true })).toBeVisible();
  expect(api.lifecycle).toHaveLength(1);
  expect(api.lifecycle[0]).toMatchObject({ operation: 'restore', body: '{"version":7}' });
  expect(api.items[0]).toMatchObject({ deletedAt: null, version: 8, publicationState: 'draft', availability: 'unknown', availabilityCheckedAt: null, publishedAt: null, publishedRevisionId: null, draft: before });
  await page.goto('/admin/recycle-bin');
  await expect(page.getByText(deleted.stockCode, { exact: true })).toHaveCount(0);
});

test('lifecycle version conflict reads the newer version without silently resending a deletion', async ({ page }) => {
  const original = vehicle();
  await installApi(page, { items: [original] });
  const calls: ReturnType<typeof attempt>[] = [];
  await page.route(new RegExp(`/api/v1/admin/vehicles/${original.id}(?:[?]|/restore|$)`), route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    calls.push(attempt(route)); original.version = 9;
    return reply(route, error('VERSION_CONFLICT'), 409);
  });
  await page.goto(`/admin/vehicles/${original.id}`);
  await openDelete(page); await confirm(page, '删除');
  await expect(page.getByRole('alert').filter({ hasText: /版本|冲突/ }).first()).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0]!.body!)).toEqual({ version: 1 });
  await expect(page.getByRole('button', { name: /重试原删除请求$/ })).toHaveCount(0);
  expect(original.deletedAt).toBeNull();
});

test('lifecycle ambiguous delete retry preserves the key and body and reconciles a stale deletion receipt', async ({ page }) => {
  const original = vehicle();
  await installApi(page, { items: [original] });
  const calls: ReturnType<typeof attempt>[] = []; let receipt = structuredClone(original); let currentReads = 0;
  await page.route(new RegExp(`/api/v1/admin/vehicles/${original.id}(?:[?]|/restore|$)`), route => {
    if (route.request().method() === 'GET') { currentReads++; return reply(route, envelope(original)); }
    if (route.request().method() !== 'DELETE') return route.fallback();
    calls.push(attempt(route));
    if (calls.length === 1) {
      receipt = { ...structuredClone(original), deletedAt: deletedTime, version: 2 };
      // Another employee restores before the client learns that deletion succeeded.
      Object.assign(original, { version: 3, deletedAt: null, publicationState: 'draft', availability: 'unknown', availabilityCheckedAt: null });
      return route.abort('failed');
    }
    return reply(route, envelope(receipt));
  });
  await page.goto(`/admin/vehicles/${original.id}`);
  await openDelete(page); await confirm(page, '删除');
  await expect(page.getByText('删除结果尚未确认', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /保存草稿$/ })).toBeDisabled();
  const readsBeforeRetry = currentReads;
  await page.getByRole('button', { name: /重试原删除请求$/ }).click();
  await expect.poll(() => currentReads).toBeGreaterThan(readsBeforeRetry);
  await expect(page.getByText('删除结果尚未确认', { exact: true })).toHaveCount(0);
  await tab(page, '基础资料');
  await expect(page.getByLabel('标题原文', { exact: true })).toBeVisible();
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toHaveCount(0);
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
});

test('lifecycle ambiguous restore retry reads a later deletion instead of trusting its old restore receipt', async ({ page }) => {
  const original = deletedVehicle();
  await installApi(page, { items: [original] });
  const calls: ReturnType<typeof attempt>[] = []; let currentReads = 0;
  const receipt = { ...structuredClone(original), version: 8, deletedAt: null, publicationState: 'draft' as const, availability: 'unknown' as const, availabilityCheckedAt: null, publishedRevisionId: null, publishedAt: null };
  await page.route(new RegExp(`/api/v1/admin/vehicles/${original.id}(?:[?]|/restore|$)`), route => {
    if (route.request().method() === 'GET') { currentReads++; return reply(route, envelope(original)); }
    if (route.request().method() !== 'POST') return route.fallback();
    calls.push(attempt(route));
    if (calls.length === 1) { original.version = 9; return route.abort('failed'); }
    return reply(route, envelope(receipt));
  });
  await page.goto(`/admin/vehicles/${original.id}`);
  await page.getByRole('button', { name: /恢复车辆$/ }).click(); await confirm(page, '恢复');
  await expect(page.getByText('恢复结果尚未确认', { exact: true })).toBeVisible();
  const readsBeforeRetry = currentReads;
  await page.getByRole('button', { name: /重试原恢复请求$/ }).click();
  await expect.poll(() => currentReads).toBeGreaterThan(readsBeforeRetry);
  await expect(page.getByText('恢复结果尚未确认', { exact: true })).toHaveCount(0);
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toBeVisible();
  await expect(page.getByLabel('标题原文', { exact: true })).toHaveCount(0);
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
});

test('lifecycle successful receipt with a failed current-state read remains uncertain and retries the same operation', async ({ page }) => {
  const original = vehicle();
  await installApi(page, { items: [original] });
  const calls: ReturnType<typeof attempt>[] = []; let failRead = false;
  await page.route(new RegExp(`/api/v1/admin/vehicles/${original.id}(?:[?]|$)`), route => {
    if (route.request().method() === 'GET') return failRead ? reply(route, error('SERVICE_UNAVAILABLE'), 503) : reply(route, envelope(original));
    if (route.request().method() !== 'DELETE') return route.fallback();
    calls.push(attempt(route));
    if (calls.length === 1) { Object.assign(original, { deletedAt: deletedTime, version: 2 }); failRead = true; }
    return reply(route, envelope(original));
  });
  await page.goto(`/admin/vehicles/${original.id}`);
  await openDelete(page); await confirm(page, '删除');
  await expect(page.getByText('删除结果尚未确认', { exact: true })).toBeVisible();
  await expect(page.getByLabel('标题原文', { exact: true })).toBeDisabled();
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toHaveCount(0);
  failRead = false;
  await page.getByRole('button', { name: /重试原删除请求$/ }).click();
  await expect(page.getByText('车辆已移入回收站', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
});

test('lifecycle unknown deletion survives a 401 retry and same-account reauthentication keeps the original request', async ({ page }) => {
  const original = vehicle();
  const api = await installApi(page, { items: [original] });
  const calls: ReturnType<typeof attempt>[] = [];
  await page.route(new RegExp(`/api/v1/admin/vehicles/${original.id}(?:[?]|/restore|$)`), route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    calls.push(attempt(route));
    if (calls.length === 1) return route.abort('failed');
    if (calls.length === 2) { api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); }
    return route.fallback();
  });
  await page.goto(`/admin/vehicles/${original.id}`);
  await openDelete(page); await confirm(page, '删除');
  await expect(page.getByText('删除结果尚未确认', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /重试原删除请求$/ }).click();
  await expect(page.getByRole('dialog').filter({ has: page.getByLabel('工作邮箱', { exact: true }) })).toBeVisible();
  expect(original.deletedAt).toBeNull();
  await page.getByLabel('工作邮箱').fill('editor@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /重试原删除请求$/ }).click();
  await expect.poll(() => api.lifecycle.length).toBe(1);
  expect(calls).toHaveLength(3); expect(calls[1]).toEqual(calls[0]); expect(calls[2]).toEqual(calls[0]);
});

test('lifecycle an initial explicit 401 performs no mutation and requires a fresh confirmation after login', async ({ page }) => {
  const original = vehicle();
  const api = await installApi(page, { items: [original] });
  const calls: ReturnType<typeof attempt>[] = [];
  await page.route(new RegExp(`/api/v1/admin/vehicles/${original.id}(?:[?]|$)`), route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    calls.push(attempt(route));
    if (calls.length === 1) { api.authenticated = false; return reply(route, error('UNAUTHENTICATED'), 401); }
    return route.fallback();
  });
  await page.goto(`/admin/vehicles/${original.id}`);
  await openDelete(page); await confirm(page, '删除');
  await expect(page.getByLabel('工作邮箱', { exact: true })).toBeVisible();
  expect(original.deletedAt).toBeNull(); expect(api.lifecycle).toEqual([]);
  await page.getByLabel('工作邮箱').fill('editor@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /重试原删除请求$/ })).toHaveCount(0);
  await openDelete(page); await confirm(page, '删除');
  await expect.poll(() => api.lifecycle.length).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]!.key).not.toBe(calls[0]!.key);
  expect(calls[1]!.body).toBe(calls[0]!.body);
});

test('lifecycle read permission never exposes destructive actions and unauthenticated recycle entry is protected', async ({ page }) => {
  const deleted = deletedVehicle();
  const api = await installApi(page, { items: [deleted], permissions: ['vehicles:read'] });
  await page.goto(`/admin/vehicles/${deleted.id}`);
  // Existing editor routes require write permission even when the record is deleted.
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /删除车辆|恢复车辆/ })).toHaveCount(0);
  api.authenticated = false;
  await page.goto('/admin/recycle-bin');
  await expect(page.getByRole('heading', { name: '登录员工工作台' })).toBeVisible();
  await expect(page.getByText(deleted.stockCode, { exact: true })).toHaveCount(0);
  expect(api.lifecycle).toEqual([]);
});

test('external editing preserves immutable source identity, observed facts and honest price and inventory controls', async ({ page }) => {
  const external = { ...vehicle(), draft: makeExternalVehicleDraftFixture(), availability: 'unknown' as const, availabilityCheckedAt: null };
  const before = structuredClone(external.draft);
  const api = await installApi(page, { items: [external] });
  await page.goto(`/admin/vehicles/${external.id}`);
  await expect(page.getByLabel('来源平台标识', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('原始挂牌编号', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('里程（公里）', { exact: true })).not.toBeDisabled();
  await notes(page);
  await page.getByRole('combobox', { name: '公开价格口径', exact: true }).click();
  await expect(page.locator('.ant-select-dropdown:visible').getByText('公开报价', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '公开价格口径', exact: true }).press('Escape');
  await select(page, '公开价格口径', '待询价');
  await (await notes(page)).fill('保持外部实车事实与来源身份');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0]!.draft).toMatchObject({ source: before.source, facts: before.facts, price: { kind: 'on_request', money: null } });
  await tab(page, '三语与发布');
  await expect(page.getByRole('combobox', { name: '核验后的库存状态', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /核验并更新库存$/ })).toHaveCount(0);
});

test('publishing clears the earlier draft-only save notice after accepting the current state', async ({ page }) => {
  const original = vehicle();
  const api = await installApi(page, { items: [original] });
  await page.route(`**/api/v1/admin/vehicles/${original.id}/publish`, route => {
    Object.assign(api.items[0]!, { version: 3, publicationState: 'published', publishedAt: deletedTime, publishedRevisionId: 'fixture_published_revision' });
    return reply(route, envelope(api.items[0]));
  });
  await page.goto(`/admin/vehicles/${original.id}`);
  await (await notes(page)).fill('先保存再明确发布，提示需要对应当前状态');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page.getByText('草稿已保存，尚未发布这些修改。', { exact: true })).toBeVisible();
  await tab(page, '三语与发布');
  await page.getByRole('button', { name: /发布车辆$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确认操作$/ }).click();
  await expect(page.getByText('已读取当前状态，请核对实际公开内容。历史发布回执不会覆盖当前状态。', { exact: true })).toBeVisible();
  await expect(page.getByText('草稿已保存，尚未发布这些修改。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('已发布', { exact: true }).first()).toBeVisible();
});

test('external source identity rejection allows correction with a new key while an unknown creation stays frozen', async ({ page }) => {
  const api = await installApi(page);
  const calls: ReturnType<typeof attempt>[] = [];
  let created = vehicle();
  await page.route('**/api/v1/admin/vehicles', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    calls.push(attempt(route));
    if (calls.length === 1 || calls.length === 3) return reply(route, error('SOURCE_IDENTITY_CONFLICT'), 409);
    if (calls.length === 2) {
      created = { ...vehicle(), draft: route.request().postDataJSON().draft };
      api.items.push(created);
      return route.abort('failed');
    }
    return reply(route, envelope(created), 201);
  });
  await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '外部挂牌资料' }).click();
  await page.getByLabel('来源平台标识', { exact: true }).fill('fixture-identity-market');
  await page.getByLabel('来源平台名称', { exact: true }).fill('合成来源身份平台');
  await page.getByLabel('原始挂牌链接', { exact: true }).fill('https://example.invalid/listings/identity');
  await page.getByLabel('原始挂牌编号', { exact: true }).fill('already-exists');
  await page.getByLabel('资料采集时间（UTC）', { exact: true }).fill('2026-11-08T08:00:00Z');
  await page.getByLabel('标题原文', { exact: true }).fill('重复来源身份纠正与未知创建测试');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => calls.length).toBe(1);
  await expect(page.getByLabel('原始挂牌编号', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('标题原文', { exact: true })).toHaveValue('重复来源身份纠正与未知创建测试');
  await expect(page.getByText('创建结果尚未确认', { exact: true })).toHaveCount(0);
  expect(api.items).toHaveLength(0);
  await page.getByLabel('原始挂牌编号', { exact: true }).fill('corrected-identity');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page.getByText('创建结果尚未确认', { exact: true })).toBeVisible();
  expect(calls[1]!.key).not.toBe(calls[0]!.key);
  expect(JSON.parse(calls[1]!.body!).draft.source.externalId).toBe('corrected-identity');
  await page.getByRole('button', { name: /重试原创建请求$/ }).click();
  await expect.poll(() => calls.length).toBe(3);
  await expect(page.getByText('创建结果尚未确认', { exact: true })).toBeVisible();
  await expect(page.getByLabel('原始挂牌编号', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /重试原创建请求$/ }).click();
  await expect(page).toHaveURL(/\/admin\/vehicles\/fixture_vehicle_1$/);
  expect(calls).toHaveLength(4);
  expect(calls[2]).toEqual(calls[1]); expect(calls[3]).toEqual(calls[1]);
  expect(api.items).toHaveLength(1);
  await expect(page.getByLabel('原始挂牌编号', { exact: true })).toHaveValue('corrected-identity');
});
