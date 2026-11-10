import { expect, test } from '@playwright/test';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { select } from './ui-helpers';

const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
function batchItems() { return ids.map((id, i) => ({ ...vehicle(), id, stockCode: `BULK-${i + 1}`, draft: { ...vehicle().draft, media: [] } })); }
function demoVehicle() {
  const demo = vehicle();
  demo.draft.source.kind = 'demo'; demo.draft.price = { kind: 'on_request', money: null, includes: [] };
  demo.draft.facts.manufacturedAt = null; demo.draft.facts.firstRegistration = null; demo.draft.facts.mileageKm = null; demo.draft.facts.location = null;
  demo.draft.internal.vin = null; demo.publicationState = 'published';
  demo.draft.facts.make = { id: 'qa-long-name', name: '展示联调品牌1794123856215' };
  demo.draft.facts.model = { id: 'qa-model', name: '隔离测试车型' };
  return demo;
}

test('bulk preserves selection versions across refresh and recovers ambiguous retry with the same request', async ({ page }) => {
  const items = batchItems();
  const api = await installApi(page, { items });
  const calls: { key?: string; body: string | null }[] = [];
  await page.route('**/api/v1/admin/vehicles/bulk', async route => {
    calls.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    if (calls.length === 1) return route.abort('failed');
    return reply(route, envelope({ operation: 'archive', results: [
      { id: ids[0], status: 'failed', error: { code: 'VERSION_CONFLICT', message: 'Changed', retryable: false } },
      { id: ids[1], status: 'succeeded', version: 2, publicationState: 'archived', availability: 'unknown', availabilityCheckedAt: null },
    ], summary: { total: 2, succeeded: 1, failed: 1 } }));
  });
  await page.goto('/admin/vehicles');
  await page.getByRole('checkbox', { name: '选择车辆 BULK-1', exact: true }).check();
  api.items[0]!.version = 2;
  await page.getByRole('button', { name: /刷新列表$/ }).click();
  await expect(page.getByRole('button', { name: /刷新列表$/ })).not.toHaveClass(/ant-btn-loading/);
  await page.getByRole('checkbox', { name: '选择车辆 BULK-2', exact: true }).check();
  await page.getByRole('button', { name: /批量下架$/ }).click();
  await page.getByRole('button', { name: /确认批量操作$/ }).click();
  await expect(page.getByText('批量操作结果尚未确认', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试原批量请求' }).click();
  await expect(page.getByRole('dialog')).toContainText('版本已变化');
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  expect(JSON.parse(calls[0]!.body!).items).toEqual([{ id: ids[0], expectedVersion: 1 }, { id: ids[1], expectedVersion: 1 }]);
  await page.getByRole('button', { name: /读取最新版本$/ }).click();
  await page.getByRole('button', { name: /采用当前版本$/ }).click();
  await expect(page.getByText('已核对版本 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /完\s*成$/ }).click();
  await expect(page.getByText('已选择 1 辆', { exact: true })).toBeVisible();
});

test('slow bulk reconciliation locks competing result actions', async ({ page }) => {
  await installApi(page, { items: batchItems() });
  await page.route('**/api/v1/admin/vehicles/bulk', route => reply(route, envelope({ operation: 'availability', results: [
    { id: ids[0], status: 'failed', error: { code: 'VERSION_CONFLICT', message: 'Changed', retryable: false } },
    { id: ids[1], status: 'failed', error: { code: 'DEMO_RESTRICTION', message: 'Demo', retryable: false } },
  ], summary: { total: 2, succeeded: 0, failed: 2 } })));
  await page.goto('/admin/vehicles');
  for (const n of [1, 2]) await page.getByRole('checkbox', { name: `选择车辆 BULK-${n}`, exact: true }).check();
  await page.getByRole('button', { name: /批量更新库存$/ }).click();
  await page.getByRole('checkbox', { name: '我已实际核验所选真实车辆的库存状态' }).check();
  await page.getByRole('button', { name: /确认批量操作$/ }).click();
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/admin/vehicles/${ids[0]}`, async route => { await pause; return reply(route, envelope({ ...batchItems()[0], version: 2 })); });
  await page.getByRole('button', { name: /读取最新版本$/ }).click();
  await expect(page.getByRole('button', { name: /移出选择$/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /完\s*成$/ })).toBeDisabled();
  release();
  await page.getByRole('button', { name: /保留原选择$/ }).click();
  await expect(page.getByRole('button', { name: /移出选择$/ })).toBeEnabled();
});

test('home conflict preserves local titles; cancelled or failed reload never discards edits', async ({ page }) => {
  await installApi(page);
  let gets = 0; let fail = false;
  const base = { version: 1, sections: [
    { id: 'featured', title: { zh: '旧推荐', en: 'Featured', ru: 'Избранное' }, vehicleIds: [] },
    { id: 'recent', title: { zh: '旧上新', en: 'Recent', ru: 'Новое' }, vehicleIds: [] },
  ] };
  await page.route('**/api/v1/admin/home/vehicle-sections', route => {
    if (route.request().method() === 'PUT') { base.version = 2; return reply(route, error('VERSION_CONFLICT'), 409); }
    gets++;
    return fail ? reply(route, error('SERVICE_UNAVAILABLE'), 503) : reply(route, envelope(base));
  });
  await page.goto('/admin/home-sections');
  await page.getByLabel('区块 1中文标题').fill('本地新标题');
  await page.getByRole('button', { name: /放弃本地修改$/ }).click();
  const before = gets;
  await page.getByRole('button', { name: /继续编辑$/ }).click();
  expect(gets).toBe(before);
  await expect(page.getByLabel('区块 1中文标题')).toHaveValue('本地新标题');
  await page.getByRole('button', { name: /保存首页配置$/ }).click();
  await expect(page.getByText('服务端已有配置版本 2，当前编辑已保留', { exact: true })).toBeVisible();
  await expect(page.getByLabel('区块 1中文标题')).toHaveValue('本地新标题');
  fail = true;
  await page.getByRole('button', { name: /放弃本地修改并载入最新$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /载入最新配置$/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: '服务暂时不可用' })).toBeVisible();
  await expect(page.getByLabel('区块 1中文标题')).toHaveValue('本地新标题');
});

test('home section ordering is explicit and persists in its versioned request', async ({ page }) => {
  const items = batchItems().map(item => ({ ...item, publicationState: 'published' as const, availability: 'available' as const }));
  await installApi(page, { items });
  let home = { version: 3, sections: [
    { id: 'featured', title: { zh: '推荐', en: 'Featured', ru: 'Избранное' }, vehicleIds: [...ids] },
    { id: 'recent', title: { zh: '上新', en: 'Recent', ru: 'Новое' }, vehicleIds: [] as string[] },
  ] };
  let saved: typeof home | null = null;
  await page.route('**/api/v1/admin/home/vehicle-sections', route => {
    if (route.request().method() === 'PUT') { saved = route.request().postDataJSON(); home = { ...saved!, version: 4 }; }
    return reply(route, envelope(home));
  });
  await page.goto('/admin/home-sections');
  await page.getByRole('button', { name: '区块 1上移车辆 2', exact: true }).click();
  expect(saved).toBeNull();
  await page.getByRole('button', { name: /保存首页配置$/ }).click();
  await expect.poll(() => saved).not.toBeNull();
  expect(saved).toMatchObject({ version: 3, sections: [{ id: 'featured', vehicleIds: [ids[1], ids[0]] }, { id: 'recent', vehicleIds: [] }] });
  await expect(page.getByRole('button', { name: /保存首页配置$/ })).toBeDisabled();
  await page.reload();
  const rows = page.getByRole('row').filter({ hasText: /BULK-[12]/ });
  await expect(rows.first()).toContainText('BULK-2');
});

test('published demo basics fit 320px after switching from the publication tab', async ({ page }) => {
  const demo = demoVehicle();
  await installApi(page, { items: [demo] });
  await page.goto(`/admin/vehicles/${demo.id}`);
  const { tab } = await import('./ui-helpers');
  await tab(page, '三语与发布');
  await page.setViewportSize({ width: 320, height: 844 });
  await tab(page, '基础资料');
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    nodes: [...document.querySelectorAll('main *')].filter(node => { const r=node.getBoundingClientRect(); return r.width>0 && r.right>innerWidth+1; }).map(node => ({ tag: node.tagName, cls: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right, text: node.textContent?.slice(0,50) })).slice(0,20) }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
});

test('filtered long-brand list fits narrow viewports after responsive layout settles', async ({ page }) => {
  const demo = demoVehicle();
  await installApi(page, { items: [demo] });
  await page.goto('/admin/vehicles');
  await page.getByRole('searchbox', { name: '关键词搜索' }).fill(demo.stockCode);
  await page.getByRole('button', { name: /搜\s*索$/ }).click();
  await select(page, '品牌筛选', demo.draft.facts.make!.name);
  await select(page, '车型筛选', demo.draft.facts.model!.name);
  await expect(page.getByText(demo.stockCode, { exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
});

test('populated home sections keep tables inside cards at 390 and 320px', async ({ page }) => {
  const demo = demoVehicle();
  await installApi(page, { items: [demo] });
  await page.route('**/api/v1/admin/home/vehicle-sections', route => reply(route, envelope({ version: 1, sections: [
    { id: 'featured', title: { zh: '隔离展示推荐', en: 'Featured', ru: 'Избранное' }, vehicleIds: [demo.id] },
    { id: 'recent', title: { zh: '隔离新车展示', en: 'Recent', ru: 'Новое' }, vehicleIds: [demo.id] },
  ] })));
  await page.goto('/admin/home-sections');
  await expect(page.getByRole('button', { name: /保存首页配置$/ })).toBeVisible();
  await expect(page.getByText(demo.stockCode, { exact: true }).first()).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    try { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0); }
    catch (error) {
      const diagnostic = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('main *')].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).map(node => ({ cls: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right, grid: getComputedStyle(node).gridTemplateColumns, overflowX: getComputedStyle(node).overflowX })).slice(0, 18) }));
      throw new Error(`${String(error)}\n${JSON.stringify(diagnostic)}`);
    }
  }
});
