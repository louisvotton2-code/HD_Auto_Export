/** Synthetic browser contract simulations. Never reads inventory or calls Meta. */
import { expect, test, type Page, type Route } from '@playwright/test';
import { makeExternalAdminFixture } from '@hd/contracts/fixtures';
import { AdminVehicleSchema, EnabledPixelVehiclesResponseSchema, ExternalListingSchema, ExternalListingListResponseSchema, type StaffMe } from '@hd/contracts/admin';
import { envelope, error, installApi, reply, staff, vehicle } from './api-fixture';

const pixelPage = '/admin/vehicle-pixel';
const enabledPixelPath = '/api/v1/admin/vehicle-pixel/enabled';
const pixelSwitch = (page: Page) => page.getByRole('switch', { name: 'Facebook Pixel', exact: true });
const savePixel = (page: Page) => page.getByRole('button', { name: '保存 Pixel 设置', exact: true });
const viewLabel = (page: Page, name: '查找车辆' | '已开启') =>
  page.getByRole('radiogroup', { name: '推广管理范围' }).getByText(name, { exact: true });
const pixelPath = (id: string) => `/api/v1/admin/${id.startsWith('ext-') ? 'external/listings' : 'vehicles'}/${id}/pixel`;
type PixelReceipt = { vehicleId: string; pixelEnabled: boolean; version: number };
type PixelWrite = { path: string; version: number; pixelEnabled: boolean };

function makePixelInventory() {
  const owned = [1, 2].map(index => AdminVehicleSchema.parse({
    ...vehicle(), id: `10000000-0000-4000-8000-${String(850 + index).padStart(12, '0')}`,
    stockCode: `SYNTH-PIXEL-${index}`, version: 23 + index,
  }));
  const { listing } = makeExternalAdminFixture();
  const published = ExternalListingSchema.parse(listing);
  const hidden = ExternalListingSchema.parse({ ...listing, id: 'ext-10000000-0000-4000-8000-000000000853',
    state: 'hidden', overrides: { ...listing.overrides, hidden: true }, vehicle: null });
  const withdrawn = ExternalListingSchema.parse({ ...listing, id: 'ext-10000000-0000-4000-8000-000000000854',
    state: 'withdrawn', vehicle: null });
  return { owned, published, hidden, withdrawn };
}

async function installPixelInventory(page: Page, options: { role?: StaffMe['role']; failWrite?: boolean } = {}) {
  const inventory = makePixelInventory();
  const api = await installApi(page, { items: inventory.owned, role: options.role ?? 'admin', permissions: [...staff.permissions, 'staff:manage'] });
  const settings = new Map<string, PixelReceipt>([...inventory.owned, inventory.published].map(record =>
    [record.id, { vehicleId: record.id, pixelEnabled: false, version: 1 }]));
  const writes: PixelWrite[] = [];
  const pixelReads: string[] = [];
  const listQueries: URLSearchParams[] = [];
  const control = { failWrite: options.failWrite ?? false };
  const requests: Array<{ method: string; path: string; body: string | null }> = [];
  const outsideRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname, body: request.postData() });
  });
  // Keep every scenario self-contained, including unexpected advertising scripts or beacons.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3319' || !/^https?:$/.test(url.protocol)) return route.fallback();
    outsideRequests.push(url.origin);
    return route.abort('blockedbyclient');
  });
  await page.route('**/api/v1/admin/external/listings?*', route => {
    const query = new URL(route.request().url()).searchParams;
    listQueries.push(query);
    expect(query.get('state')).toBe('published');
    const record = inventory.published;
    return reply(route, ExternalListingListResponseSchema.parse(envelope({
      page: Number(query.get('page') ?? 1), pageSize: Number(query.get('pageSize') ?? 20), total: 1,
      items: [{ ...record.identity, id: record.id, version: record.version, listingUrl: record.source?.listingUrl ?? null,
        title: 'SYNTH-PIXEL-EXTERNAL', state: record.state, fetchedAt: record.fetchedAt, sourceUpdatedAt: record.sourceUpdatedAt,
        publishedAt: record.vehicle?.publishedAt ?? null, hasOverrides: false }],
    })));
  });
  await page.route(`**${enabledPixelPath}?*`, route => {
    const query = new URL(route.request().url()).searchParams;
    const page = Number(query.get('page'));
    const pageSize = Number(query.get('pageSize'));
    const items = [...settings.values()].filter(row => row.pixelEnabled).map(row => {
      const own = inventory.owned.find(vehicle => vehicle.id === row.vehicleId);
      return { vehicleId: row.vehicleId, code: own?.stockCode ?? row.vehicleId,
        title: own ? '测试自录车' : '已开启的测试三方车' };
    });
    return reply(route, EnabledPixelVehiclesResponseSchema.parse(envelope({
      page, pageSize, total: items.length, items: items.slice((page - 1) * pageSize, page * pageSize),
    })));
  });
  await page.route(/\/api\/v1\/admin\/(?:vehicles|external\/listings)\/[^/]+\/pixel$/, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const id = path.split('/').at(-2)!;
    const setting = settings.get(id);
    if (!setting) return reply(route, error('NOT_FOUND'), 404);
    if (request.method() === 'GET') {
      pixelReads.push(id);
      return reply(route, envelope(setting));
    }
    expect(request.method()).toBe('PUT');
    const input = request.postDataJSON();
    expect(input).toEqual({ version: expect.any(Number), pixelEnabled: expect.any(Boolean) });
    writes.push({ path, ...input });
    if (control.failWrite) return reply(route, error('SERVICE_UNAVAILABLE'), 503);
    if (input.pixelEnabled === setting.pixelEnabled) return reply(route, envelope(setting));
    if (input.version !== setting.version) return reply(route, error('VERSION_CONFLICT'), 409);
    if (setting.pixelEnabled !== input.pixelEnabled) {
      setting.pixelEnabled = input.pixelEnabled;
      setting.version += 1;
    }
    return reply(route, envelope(setting));
  });
  for (const listing of [inventory.published, inventory.hidden, inventory.withdrawn]) {
    await page.route(`**/api/v1/admin/external/listings/${listing.id}?*`, route => reply(route, envelope(listing)));
  }
  return { inventory, api, requests, outsideRequests, settings, writes, pixelReads, listQueries, control };
}

function expectOnlyPixelRequests(state: Awaited<ReturnType<typeof installPixelInventory>>, writes: readonly string[]) {
  expect(state.requests.filter(request => request.method !== 'GET').map(request => request.path)).toEqual(writes);
  expect(state.requests.filter(request => /\/(?:publish|publish-readiness|publication-preview|translation[^/]*|sync[^/]*)(?:\/|$)/.test(request.path))).toEqual([]);
  expect(state.api.previewConfirmations).toEqual([]);
  expect(state.api.translationPlans).toEqual([]);
  expect(state.api.translationGenerations).toEqual([]);
  expect(state.api.creates).toEqual([]);
  expect(state.api.saves).toEqual([]);
  expect(state.outsideRequests).toEqual([]);
}

async function openOwnedPixel(page: Page, state: Awaited<ReturnType<typeof installPixelInventory>>, index = 0) {
  await page.goto(pixelPage);
  await expect(page.getByRole('heading', { name: 'Pixel 推广', exact: true })).toBeVisible();
  await viewLabel(page, '查找车辆').click();
  await page.getByRole('radio', { name: new RegExp(state.inventory.owned[index]!.stockCode) }).click();
  await expect(pixelSwitch(page)).toBeEnabled();
}

async function chooseExternalPixel(page: Page) {
  const lookup = page.getByRole('radio', { name: '查找车辆', exact: true });
  if (!await lookup.isChecked()) await viewLabel(page, '查找车辆').click();
  await page.getByText('第三方车', { exact: true }).click();
  await page.getByRole('radio', { name: /SYNTH-PIXEL-EXTERNAL/ }).click();
  await expect(pixelSwitch(page)).toBeEnabled();
}

test('vehicle Pixel administrator reads the independent default and explicitly saves without publishing', async ({ page }) => {
  const state = await installPixelInventory(page);
  await page.goto('/admin/vehicles');
  await page.getByRole('link', { name: 'Pixel 推广', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pixel 推广', exact: true })).toBeVisible();
  const item = state.inventory.owned[0]!;
  await viewLabel(page, '查找车辆').click();
  await page.getByRole('radio', { name: new RegExp(item.stockCode) }).click();
  await expect(pixelSwitch(page)).toBeEnabled();
  await expect(pixelSwitch(page)).not.toBeChecked();
  expect(state.pixelReads).toContain(item.id);
  expectOnlyPixelRequests(state, []);

  await pixelSwitch(page).click();
  await expect(pixelSwitch(page)).toBeChecked();
  expectOnlyPixelRequests(state, []);
  await savePixel(page).click();
  await expect(page.getByText('Pixel 设置已保存', { exact: true }).first()).toBeVisible();
  expect(state.writes).toEqual([{ path: pixelPath(item.id), version: 1, pixelEnabled: true }]);
  expect(state.settings.get(item.id)).toEqual({ vehicleId: item.id, version: 2, pixelEnabled: true });
  expect(item.version).toBe(24);
  expect(item.publicationState).toBe('draft');
  await page.reload();
  await page.getByRole('radio', { name: new RegExp(item.stockCode) }).click();
  await expect(pixelSwitch(page)).toBeChecked();
  expectOnlyPixelRequests(state, [pixelPath(item.id)]);
});

test('vehicle Pixel public third-party setting is independent and unpublished listings are not offered', async ({ page }) => {
  const state = await installPixelInventory(page);
  await openOwnedPixel(page, state);
  const owned = state.inventory.owned[0]!;
  await pixelSwitch(page).click();
  await savePixel(page).click();
  await expect(page.getByText('Pixel 设置已保存', { exact: true }).first()).toBeVisible();
  await chooseExternalPixel(page);
  await expect(pixelSwitch(page)).not.toBeChecked();
  expect(state.listQueries.length).toBeGreaterThan(0);
  expect(state.listQueries.every(query => query.get('state') === 'published' && query.get('locale') === 'zh')).toBe(true);
  await expect(page.getByRole('radio', { name: new RegExp(state.inventory.hidden.id) })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: new RegExp(state.inventory.withdrawn.id) })).toHaveCount(0);
  expect(state.pixelReads).not.toContain(state.inventory.hidden.id);
  expect(state.pixelReads).not.toContain(state.inventory.withdrawn.id);
  await pixelSwitch(page).click();
  expectOnlyPixelRequests(state, [pixelPath(owned.id)]);
  await savePixel(page).click();
  await expect(page.getByText('Pixel 设置已保存', { exact: true }).first()).toBeVisible();
  expect(state.writes).toEqual([
    { path: pixelPath(owned.id), version: 1, pixelEnabled: true },
    { path: pixelPath(state.inventory.published.id), version: 1, pixelEnabled: true },
  ]);
  expect(state.inventory.published.version).toBe(3);
  expect(state.inventory.published.state).toBe('published');
  expectOnlyPixelRequests(state, [pixelPath(owned.id), pixelPath(state.inventory.published.id)]);
});

test('vehicle Pixel editor has no menu and direct access makes zero Pixel requests even with legacy write permissions', async ({ page }) => {
  const state = await installPixelInventory(page, { role: 'editor' });
  await page.goto('/admin/vehicles');
  await expect(page.getByRole('link', { name: 'Pixel 推广', exact: true })).toHaveCount(0);
  await page.goto(pixelPage);
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(pixelSwitch(page)).toHaveCount(0);
  await expect(savePixel(page)).toHaveCount(0);
  expect(state.requests.filter(request => request.path.endsWith('/pixel'))).toEqual([]);
  expect(state.requests.filter(request => request.path === enabledPixelPath)).toEqual([]);
  expectOnlyPixelRequests(state, []);
});

test('vehicle Pixel uncertain save keeps the change and rereads before retrying only the setting request', async ({ page }) => {
  const state = await installPixelInventory(page, { failWrite: true });
  await openOwnedPixel(page, state);
  const item = state.inventory.owned[0]!;
  await pixelSwitch(page).click();
  await savePixel(page).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Pixel 设置已保存', { exact: true })).toHaveCount(0);
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(savePixel(page)).toBeDisabled();
  expect(state.settings.get(item.id)).toEqual({ vehicleId: item.id, version: 1, pixelEnabled: false });
  state.control.failWrite = false;
  await page.getByRole('button', { name: '读取最新设置', exact: true }).click();
  await expect(page.getByText('正在读取 Pixel 设置…', { exact: true })).toBeHidden();
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(savePixel(page)).toBeEnabled();
  await savePixel(page).click();
  await expect(page.getByText('Pixel 设置已保存', { exact: true }).first()).toBeVisible();
  expect(state.writes).toEqual(Array.from({ length: 2 }, () => ({ path: pixelPath(item.id), version: 1, pixelEnabled: true })));
  expectOnlyPixelRequests(state, [pixelPath(item.id), pixelPath(item.id)]);
});

test('vehicle Pixel changing the selected vehicle or source never carries an unsaved toggle', async ({ page }) => {
  const state = await installPixelInventory(page);
  await openOwnedPixel(page, state);
  await pixelSwitch(page).click();
  await page.getByRole('radio', { name: new RegExp(state.inventory.owned[1]!.stockCode) }).click();
  await expect(pixelSwitch(page)).toBeEnabled();
  await expect(pixelSwitch(page)).not.toBeChecked();
  await page.getByRole('radio', { name: new RegExp(state.inventory.owned[0]!.stockCode) }).click();
  await expect(pixelSwitch(page)).toBeEnabled();
  await expect(pixelSwitch(page)).not.toBeChecked();
  await pixelSwitch(page).click();
  await chooseExternalPixel(page);
  await expect(pixelSwitch(page)).not.toBeChecked();
  await page.getByText('自录车', { exact: true }).click();
  await page.getByRole('radio', { name: new RegExp(state.inventory.owned[0]!.stockCode) }).click();
  await expect(pixelSwitch(page)).not.toBeChecked();
  expectOnlyPixelRequests(state, []);
});

test('vehicle Pixel version conflict requires a fresh read and never reuses the vehicle draft version', async ({ page }) => {
  const state = await installPixelInventory(page);
  await openOwnedPixel(page, state);
  const item = state.inventory.owned[0]!;
  state.settings.set(item.id, { vehicleId: item.id, pixelEnabled: false, version: 5 });
  await pixelSwitch(page).click();
  await savePixel(page).click();
  await expect(page.getByRole('button', { name: '读取最新设置', exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: pixelPath(item.id), version: 1, pixelEnabled: true }]);
  await page.getByRole('button', { name: '读取最新设置', exact: true }).click();
  await expect(page.getByText('正在读取 Pixel 设置…', { exact: true })).toBeHidden();
  await expect(pixelSwitch(page)).toBeEnabled();
  await expect(pixelSwitch(page)).toBeChecked();
  expect(state.pixelReads.filter(id => id === item.id).length).toBeGreaterThanOrEqual(2);
  await savePixel(page).click();
  await expect(page.getByText('Pixel 设置已保存', { exact: true }).first()).toBeVisible();
  expect(state.writes.at(-1)).toEqual({ path: pixelPath(item.id), version: 5, pixelEnabled: true });
  expect(item.version).toBe(24);
  expectOnlyPixelRequests(state, [pixelPath(item.id), pixelPath(item.id)]);
});

test('vehicle Pixel accepts a same-value success receipt from a newer independent version', async ({ page }) => {
  const state = await installPixelInventory(page);
  await openOwnedPixel(page, state);
  const item = state.inventory.owned[0]!;
  // Another administrator has already applied exactly the desired value.
  state.settings.set(item.id, { vehicleId: item.id, pixelEnabled: true, version: 5 });
  await pixelSwitch(page).click();
  await savePixel(page).click();
  await expect(page.getByText('Pixel 设置已保存', { exact: true }).first()).toBeVisible();
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(savePixel(page)).toBeDisabled();
  expect(state.writes).toEqual([{ path: pixelPath(item.id), version: 1, pixelEnabled: true }]);
  expect(state.settings.get(item.id)?.version).toBe(5);
  expectOnlyPixelRequests(state, [pixelPath(item.id)]);
});

test('vehicle Pixel service permission denial never displays a writable default', async ({ page }) => {
  const state = await installPixelInventory(page);
  const item = state.inventory.owned[0]!;
  await page.route(`**${pixelPath(item.id)}`, route => reply(route, error('FORBIDDEN'), 403));
  await page.goto(pixelPage);
  await viewLabel(page, '查找车辆').click();
  await page.getByRole('radio', { name: new RegExp(item.stockCode) }).click();
  await expect(page.getByRole('alert')).toContainText('读取 Pixel 设置失败');
  await expect(pixelSwitch(page)).toHaveCount(0);
  await expect(savePixel(page)).toHaveCount(0);
  expectOnlyPixelRequests(state, []);
});

test('vehicle Pixel search is scoped to the source and checks the selected supplier public projection', async ({ page }) => {
  const state = await installPixelInventory(page);
  await openOwnedPixel(page, state);
  const { published } = state.inventory;
  await page.route(`**/api/v1/admin/external/listings/${published.id}?*`,
    route => reply(route, envelope({ ...published, vehicle: null })));
  await page.getByText('第三方车', { exact: true }).click();
  const search = page.getByLabel('搜索车辆');
  await search.fill(published.id);
  await search.press('Enter');
  await expect.poll(() => state.listQueries.some(query => query.get('q') === published.id
    && query.get('state') === 'published' && query.get('page') === '1')).toBe(true);
  await page.getByRole('radio', { name: /SYNTH-PIXEL-EXTERNAL/ }).click();
  await expect(page.getByText('无法确认该三方车源已公开', { exact: true })).toBeVisible();
  await expect(pixelSwitch(page)).toHaveCount(0);
  expect(state.pixelReads).not.toContain(published.id);
  expectOnlyPixelRequests(state, []);
});

test('vehicle Pixel rechecks supplier visibility immediately before saving', async ({ page }) => {
  const state = await installPixelInventory(page);
  await page.goto(pixelPage);
  await chooseExternalPixel(page);
  await pixelSwitch(page).click();
  const { published } = state.inventory;
  await page.route(`**/api/v1/admin/external/listings/${published.id}?*`,
    route => reply(route, envelope({ ...published, vehicle: null })));
  await savePixel(page).click();
  await expect(page.getByText('这条三方车源当前未确认公开。你的选择已保留，请重新核对。')).toBeVisible();
  await expect(savePixel(page)).toBeDisabled();
  expectOnlyPixelRequests(state, []);
});

test('vehicle Pixel rereads a committed setting after a lost receipt without performing another write', async ({ page }) => {
  const state = await installPixelInventory(page);
  await openOwnedPixel(page, state);
  const item = state.inventory.owned[0]!;
  const path = pixelPath(item.id);
  await page.route(`**${path}`, route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    state.settings.set(item.id, { vehicleId: item.id, version: 2, pixelEnabled: true });
    return route.abort('failed');
  });
  await pixelSwitch(page).click();
  await savePixel(page).click();
  await page.getByRole('button', { name: '读取最新设置', exact: true }).click();
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(savePixel(page)).toBeDisabled();
  expectOnlyPixelRequests(state, [path]);
});

test('vehicle Pixel manages enabled vehicles from both sources and removes an unpublished supplier only after confirmed disable', async ({ page }) => {
  const state = await installPixelInventory(page);
  const owned = state.inventory.owned[0]!;
  const { withdrawn } = state.inventory;
  state.settings.set(owned.id, { vehicleId: owned.id, pixelEnabled: true, version: 2 });
  state.settings.set(withdrawn.id, { vehicleId: withdrawn.id, pixelEnabled: true, version: 7 });
  await page.goto(pixelPage);
  const enabled = page.getByRole('radiogroup', { name: '已开启的车辆' });
  await expect(enabled.getByRole('radio')).toHaveCount(2);
  await expect(page.getByText('共 2 辆', { exact: true })).toBeVisible();
  expect(state.pixelReads).toEqual([]);
  const supplier = enabled.getByRole('radio', { name: new RegExp(withdrawn.id) });
  await supplier.click();
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(page.getByText('可关闭现有推广。再次开启需要车源在官网公开。')).toBeVisible();
  await pixelSwitch(page).click();
  await expect(supplier).toBeVisible();
  await savePixel(page).click();
  await expect(page.getByText('Pixel 设置已保存', { exact: true })).toBeVisible();
  await expect(supplier).toHaveCount(0);
  await expect(enabled.getByRole('radio', { name: new RegExp(owned.stockCode) })).toBeVisible();
  await expect(page.getByText('共 1 辆', { exact: true })).toBeVisible();
  await expect(pixelSwitch(page)).not.toBeChecked();
  await expect(pixelSwitch(page)).toBeDisabled();
  expect(state.writes).toEqual([{ path: pixelPath(withdrawn.id), version: 7, pixelEnabled: false }]);
  expectOnlyPixelRequests(state, [pixelPath(withdrawn.id)]);
});

test('vehicle Pixel unavailable endpoints show actionable errors without implying a removed vehicle or an empty index', async ({ page }) => {
  const state = await installPixelInventory(page);
  const item = state.inventory.owned[0]!;
  await page.route(`**${enabledPixelPath}?*`, route => reply(route, error('NOT_FOUND'), 404));
  await page.route(`**${pixelPath(item.id)}`, route => reply(route, error('NOT_FOUND'), 404));
  await page.goto(pixelPage);
  await expect(page.getByRole('alert')).toContainText('当前后台接口尚未提供已开启列表');
  await expect(page.getByText('暂无启用 Pixel 的车辆。')).toHaveCount(0);
  await viewLabel(page, '查找车辆').click();
  await page.getByRole('radio', { name: new RegExp(item.stockCode) }).click();
  await expect(page.getByRole('alert')).toContainText('核对 Pixel 接口版本');
  await expect(page.getByRole('alert')).toContainText('browser-contract-test');
  await expect(page.getByText('可能已被移除', { exact: false })).toHaveCount(0);
  await expect(pixelSwitch(page)).toHaveCount(0);
  expectOnlyPixelRequests(state, []);
});

test('vehicle Pixel restores the enabled list when the same admin rereads a setting after reauthentication', async ({ page }) => {
  const state = await installPixelInventory(page);
  const item = state.inventory.owned[0]!;
  const path = pixelPath(item.id);
  state.settings.set(item.id, { vehicleId: item.id, pixelEnabled: true, version: 5 });
  await page.goto(pixelPage);
  const row = page.getByRole('radiogroup', { name: '已开启的车辆' }).getByRole('radio', { name: new RegExp(item.stockCode) });
  await row.click();
  await expect(pixelSwitch(page)).toBeChecked();
  await pixelSwitch(page).click();
  await page.route(`**${path}`, route => route.request().method() === 'PUT'
    ? reply(route, error('UNAUTHENTICATED'), 401) : route.fallback(), { times: 1 });
  await savePixel(page).click();
  await expect(page.getByRole('heading', { name: '重新登录' })).toBeVisible();
  await page.getByLabel('账号或工作邮箱').fill('fixture-editor');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await page.getByRole('button', { name: '读取最新设置', exact: true }).click();
  await expect(row).toBeVisible();
  await expect(pixelSwitch(page)).not.toBeChecked();
  await savePixel(page).click();
  await expect(page.getByText('暂无启用 Pixel 的车辆。')).toBeVisible();
  await expect(pixelSwitch(page)).toBeDisabled();
  expect(state.writes).toEqual([{ path, version: 5, pixelEnabled: false }]);
  expectOnlyPixelRequests(state, [path, '/api/auth/sign-in/email', path]);
});

test('vehicle Pixel warns before leaving with unsaved changes', async ({ page }) => {
  const state = await installPixelInventory(page);
  await openOwnedPixel(page, state);
  await pixelSwitch(page).click();
  await page.getByRole('link', { name: '精品车辆管理' }).click();
  await expect(page.getByRole('dialog')).toContainText('离开 Pixel 推广？');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(page.getByRole('dialog')).toBeHidden();
  expectOnlyPixelRequests(state, []);
});

test('vehicle Pixel keeps a supplier selection across session expiry and rechecks before the next write', async ({ page }) => {
  const state = await installPixelInventory(page);
  await page.goto(pixelPage);
  await chooseExternalPixel(page);
  await pixelSwitch(page).click();
  const path = pixelPath(state.inventory.published.id);
  await page.route(`**${path}`, route => route.request().method() === 'PUT'
    ? reply(route, error('UNAUTHENTICATED'), 401) : route.fallback(), { times: 1 });
  await savePixel(page).click();
  await expect(page.getByRole('heading', { name: '重新登录' })).toBeVisible();
  await page.getByLabel('账号或工作邮箱').fill('fixture-editor');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await page.getByRole('button', { name: '重新核对', exact: true }).click();
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(savePixel(page)).toBeEnabled();
  expect(state.requests.filter(request => request.path === path && request.method === 'PUT')).toHaveLength(1);
});

test('vehicle Pixel cancels an in-flight supplier eligibility check when the session expires', async ({ page }) => {
  const state = await installPixelInventory(page);
  await page.goto(pixelPage);
  await chooseExternalPixel(page);
  const { published } = state.inventory;
  const supplierDetail = `**/api/v1/admin/external/listings/${published.id}?*`;
  let pendingDetail: Route | undefined;
  await page.route(supplierDetail, route => { pendingDetail = route; }, { times: 1 });
  await pixelSwitch(page).click();
  await savePixel(page).click();
  await expect.poll(() => pendingDetail?.request().method()).toBe('GET');
  await page.route('**/api/v1/admin/me/upload-stats', route => reply(route, error('UNAUTHENTICATED'), 401), { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '重新登录' })).toBeVisible();
  await reply(pendingDetail!, envelope(published)).catch(() => {});
  await page.getByLabel('账号或工作邮箱').fill('fixture-editor');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await page.getByRole('button', { name: '重新核对', exact: true }).click();
  await expect(pixelSwitch(page)).toBeChecked();
  expectOnlyPixelRequests(state, ['/api/auth/sign-in/email']);
});

test('vehicle Pixel keeps the picker and settings usable at 320 pixels', async ({ page }) => {
  const state = await installPixelInventory(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await openOwnedPixel(page, state);
  const search = await page.getByLabel('搜索车辆').boundingBox();
  const save = await savePixel(page).boundingBox();
  expect(search).not.toBeNull();
  expect(save).not.toBeNull();
  expect(search!.x + search!.width).toBeLessThanOrEqual(320);
  expect(save!.x + save!.width).toBeLessThanOrEqual(320);
  expect(save!.y).toBeGreaterThan(search!.y);
  await pixelSwitch(page).focus();
  await page.keyboard.press('Space');
  await expect(pixelSwitch(page)).toBeChecked();
  await expect(savePixel(page)).toBeEnabled();
  expectOnlyPixelRequests(state, []);
});
