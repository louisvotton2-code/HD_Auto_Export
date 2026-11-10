import './ux-cases';
import './lifecycle-cases';
import './translation-cases';
import './brand-cases';
import './localization-cases';
import './vehicle-entry-cases';
import './external-source-cases';
import { expect, test } from '@playwright/test';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { notes, select, tab } from './ui-helpers';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';

test('initial authentication, native auth error and explicit sign out', async ({ page }) => {
  const api = await installApi(page, { authenticated: false });
  await page.goto('/admin/vehicles');
  await expect(page.getByRole('heading', { name: '登录员工工作台' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByLabel('账号或工作邮箱').fill(' Fixture-Editor ');
  await page.getByLabel('密码', { exact: true }).fill('incorrect-password');
  const [login] = await Promise.all([
    page.waitForRequest(request => request.url().endsWith('/api/auth/sign-in/email')),
    page.getByRole('button', { name: /登录工作台$/ }).click(),
  ]);
  expect(login.postDataJSON()).toMatchObject({ email: 'fixture-editor@staff.hd-auto.invalid' });
  await expect(page.getByRole('alert')).toContainText('账号或密码不正确');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('heading', { name: '车辆管理', exact: true })).toBeVisible();
  expect(api.authenticated).toBe(true);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录员工工作台' })).toBeVisible();
  expect(api.authenticated).toBe(false);
});

test('service failure is not presented as an empty successful list', async ({ page }) => {
  await installApi(page);
  await page.route('**/api/v1/admin/vehicles?*', route => reply(route, error('SERVICE_UNAVAILABLE'), 503));
  await page.goto('/admin/vehicles');
  await expect(page.getByRole('alert')).toContainText('服务暂时不可用');
  await page.unroute('**/api/v1/admin/vehicles?*');
  await page.reload();
  await expect(page.getByRole('heading', { name: '车辆管理', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/暂无.*车辆|没有.*车辆/)).toBeVisible();
});

test('write permission is checked before direct entry into the editor', async ({ page }) => {
  const api = await installApi(page, { permissions: ['vehicles:read'] });
  await page.goto('/admin/vehicles/new');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /保存草稿/ })).toHaveCount(0);
  expect(api.creates).toHaveLength(0);
});

test('editing preserves unrelated media and translations while saving only a draft', async ({ page }) => {
  const original = vehicle();
  const before = structuredClone(original);
  const api = await installApi(page, { items: [original] });
  await page.goto(`/admin/vehicles/${original.id}`);
  await (await notes(page)).fill('本轮待核验，未发布');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.saves.length).toBe(1);
  expect(api.saves[0].draft.media).toEqual(before.draft.media);
  expect(api.saves[0].draft.content.title.translations).toEqual(before.draft.content.title.translations);
  expect(api.saves[0].draft.internal.notes).toBe('本轮待核验，未发布');
  expect(api.saves[0].version).toBe(1);
  await expect(page.getByRole('status')).toContainText('草稿已保存');
  await page.reload();
  await expect((await notes(page))).toHaveValue('本轮待核验，未发布');
});

test('an ambiguous create retry uses the original body and idempotency key', async ({ page }) => {
  const api = await installApi(page);
  const attempts: { key?: string; body: string | null }[] = [];
  await page.route('**/api/v1/admin/vehicles', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    attempts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
    if (attempts.length === 1) {
      // Persist before dropping the response: this is the duplicate-creation risk.
      api.items.push({ ...vehicle(), draft: request.postDataJSON().draft });
      return route.abort('failed');
    }
    if (attempts.length === 2) {
      api.authenticated = false;
      return reply(route, error('UNAUTHENTICATED'), 401);
    }
    return reply(route, envelope(api.items[0]), 201);
  });
  await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '真实车源录入' }).click();
  await page.getByLabel('标题原文', { exact: true }).fill('断网重试测试草稿');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page.getByText('创建结果尚未确认', { exact: true })).toBeVisible();
  await expect(page.getByLabel('标题原文', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试原创建请求' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('账号或工作邮箱').fill('editor@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('标题原文', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试原创建请求' }).click();
  await expect(page).toHaveURL(/\/admin\/vehicles\/fixture_vehicle_1$/);
  expect(attempts).toHaveLength(3);
  expect(attempts[0].key).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[2]).toEqual(attempts[0]);
  expect(api.items).toHaveLength(1);
  await expect(page.getByLabel('标题原文', { exact: true })).toHaveValue('断网重试测试草稿');
});

test('a delayed save cannot overwrite another vehicle after confirmed navigation', async ({ page }) => {
  const first = vehicle();
  const second = { ...vehicle(), id: 'fixture_vehicle_2', stockCode: 'FIXTURE-0002' };
  second.draft.content.title.sourceText = '第二辆车的独立原文';
  second.draft.facts.model!.name = 'Second vehicle';
  await installApi(page, { items: [first, second] });
  await page.goto(`/admin/vehicles/${second.id}`);
  await page.getByRole('button', { name: '返回车辆列表' }).click();
  await page.getByRole('link', { name: 'Example Sample vehicle' }).click();
  let release: () => void = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  await page.route(`**/api/v1/admin/vehicles/${first.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    received = true;
    await waiting;
    return reply(route, envelope({ ...first, version: 2, draft: route.request().postDataJSON().draft }));
  });
  await page.getByLabel('标题原文', { exact: true }).fill('第一辆车正在保存的原文');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => received).toBe(true);
  await page.evaluate(() => history.go(-2));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认离开' }).click();
  await expect(page).toHaveURL(/\/admin\/vehicles\/fixture_vehicle_2$/);
  await expect(page.getByLabel('标题原文', { exact: true })).toHaveValue('第二辆车的独立原文');
  const completed = page.waitForResponse(response => response.url().endsWith(`/vehicles/${first.id}`) && response.request().method() === 'PATCH');
  release();
  await completed;
  await expect(page.getByLabel('标题原文', { exact: true })).toHaveValue('第二辆车的独立原文');
});

test('list pagination and status filters preserve their distinct meanings', async ({ page }) => {
  const items = Array.from({ length: 25 }, (_, index) => ({
    ...vehicle(), id: `fixture_vehicle_${index + 1}`, stockCode: `FIXTURE-${index + 1}`,
    publicationState: index === 24 ? 'published' as const : 'draft' as const,
    availability: index === 24 ? 'sold' as const : 'unknown' as const,
  }));
  await installApi(page, { items });
  await page.goto('/admin/vehicles');
  await expect(page.getByText('FIXTURE-1', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('admin-desktop-list.png'), fullPage: true });
  await page.locator('.ant-pagination-next button').click();
  await expect(page.getByText('FIXTURE-13', { exact: true })).toBeVisible();
  await page.locator('.ant-pagination-next button').click();
  await expect(page.getByText('FIXTURE-25', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-pagination-next button')).toBeDisabled();
  await select(page, '库存状态', '已售');
  await expect(page).toHaveURL(/availability=sold/);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await expect(page.getByText('已发布', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('已售', { exact: true }).last()).toBeVisible();
  await select(page, '发布状态', '草稿');
  await expect(page.getByText('当前条件下暂无车辆', { exact: true })).toBeVisible();
});

test('unsaved edits block both links and browser back until explicitly discarded', async ({ page }) => {
  await installApi(page, { items: [vehicle()] });
  await page.goto('/admin/vehicles');
  await page.getByRole('link', { name: 'Example Sample vehicle' }).click();
  await (await notes(page)).fill('不能静默丢弃');
  await page.getByRole('button', { name: '返回车辆列表' }).click();
  await expect(page.getByRole('dialog')).toContainText('离开当前草稿');
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect((await notes(page))).toHaveValue('不能静默丢弃');
  await page.goBack();
  await expect(page.getByRole('dialog')).toContainText('离开当前草稿');
  await page.getByRole('button', { name: '确认离开' }).click();
  await expect(page).toHaveURL(/\/admin\/vehicles$/);
});

test('conflicting save keeps local input and fetches the current remote version', async ({ page }) => {
  const current = vehicle();
  await installApi(page, { items: [current] });
  await page.goto(`/admin/vehicles/${current.id}`);
  await (await notes(page)).fill('本地未保存的输入');
  current.version = 2;
  current.draft.internal.notes = '同事保存的内容';
  await page.route(`**/api/v1/admin/vehicles/${current.id}`, route => route.request().method() === 'PATCH'
    ? reply(route, error('VERSION_CONFLICT'), 409)
    : reply(route, envelope(current)));
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page.getByRole('alert').first()).toContainText(/更新|冲突/);
  await expect((await notes(page))).toHaveValue('本地未保存的输入');
  await expect(page.getByText('同事保存的内容', { exact: true })).toBeVisible();
});

test('session expiry locks the editor and same-account reauthentication preserves input', async ({ page }) => {
  const current = vehicle();
  const api = await installApi(page, { items: [current] });
  await page.goto(`/admin/vehicles/${current.id}`);
  await (await notes(page)).fill('会话失效前的输入');
  api.authenticated = false;
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('账号或工作邮箱').fill('editor@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect((await notes(page))).toHaveValue('会话失效前的输入');
});

test('signing in as another employee discards the previous employee unsaved memory', async ({ page }) => {
  const current = vehicle();
  const api = await installApi(page, { items: [current] });
  await page.goto(`/admin/vehicles/${current.id}`);
  await (await notes(page)).fill('前一员工未保存的私有输入');
  api.authenticated = false;
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  api.me.id = 'fixture_other_staff';
  api.me.name = '另一位测试员工';
  await page.getByLabel('账号或工作邮箱').fill('other@example.invalid');
  await page.getByLabel('密码', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: /登录工作台$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect((await notes(page))).toHaveValue('INTERNAL_FIXTURE_NOT_PUBLIC');
});

test('320px viewport keeps login and vehicle editor within the page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await installApi(page, { items: [vehicle()] });
  await page.goto('/admin/vehicles/fixture_vehicle_1');
  await expect((await notes(page))).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('admin-mobile-editor.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: test.info().outputPath('admin-desktop-editor.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录员工工作台' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('public catalog scopes shared model IDs to their brand and normalizes model-only URLs', async ({ page }) => {
  await installApi(page);
  const items = ['a', 'b'].map(brand => {
    const item = makePublicVehicleFixture();
    item.id = `fixture_public_${brand}`;
    item.stockCode = `MODEL-SCOPE-${brand.toUpperCase()}`;
    item.facts.make = { id: `brand_${brand}`, name: `品牌${brand.toUpperCase()}` };
    item.facts.model = { id: 'shared', name: `车型${brand.toUpperCase()}` };
    item.facts.powertrain = 'petrol';
    return item;
  });
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/vehicle-filters?*', route => reply(route, envelope({
    catalog: 'curated',
    makes: items.map(item => ({ ...item.facts.make!, count: 1 })),
    models: items.map(item => ({ ...item.facts.model!, makeId: item.facts.make!.id, count: 1 })),
    powertrains: [{ id: 'petrol', count: 2 }],
  })));
  await page.route('**/api/v1/vehicles?*', route => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    const filtered = items.filter(item =>
      (!query.has('make') || item.facts.make?.id === query.get('make')) &&
      (!query.has('model') || item.facts.model?.id === query.get('model')));
    return reply(route, {
      data: { items: filtered, page: Number(query.get('page')), pageSize: 24, hasMore: false },
      meta: { requestId: 'public-model-scope', catalog: 'curated', total: filtered.length, totalKind: 'exact', accessibleTotal: filtered.length, dataAsOf: '2026-11-08T00:00:00Z', freshness: 'fresh' },
    });
  });
  await page.goto('/admin/public-catalog?model=shared&page=2&powertrain=petrol');
  const brandSelect = page.getByRole('combobox', { name: '品牌分类', exact: true });
  const modelSelect = page.getByRole('combobox', { name: '车型分类', exact: true });
  await expect(modelSelect).toBeDisabled();
  await expect(page.getByText('请先选择品牌，再选择该品牌下的车型。', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/public-catalog\?powertrain=petrol$/);
  await expect(page.getByText('MODEL-SCOPE-A', { exact: true })).toBeVisible();
  await expect(page.getByText('MODEL-SCOPE-B', { exact: true })).toBeVisible();
  expect(queries.every(query => !query.has('model'))).toBe(true);
  expect(queries.every(query => query.get('page') === '1')).toBe(true);

  await select(page, '品牌分类', '品牌A（1）');
  await expect(modelSelect).toBeEnabled();
  await modelSelect.click();
  await expect(page.locator('.ant-select-dropdown:visible').getByText('车型A（1）', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-select-dropdown:visible').getByText('车型B（1）', { exact: true })).toHaveCount(0);
  await modelSelect.press('Escape');
  await select(page, '车型分类', new RegExp('车型[AB]（1）'));
  await expect(page.getByText('MODEL-SCOPE-A', { exact: true })).toBeVisible();
  await expect(page.getByText('MODEL-SCOPE-B', { exact: true })).toHaveCount(0);
  expect(queries.at(-1)?.get('make')).toBe('brand_a');
  await expect.poll(() => queries.at(-1)?.get('model')).toBe('shared');

  await select(page, '品牌分类', '品牌B（1）');
  await expect(modelSelect).toHaveValue('');
  await select(page, '车型分类', new RegExp('车型[AB]（1）'));
  await expect(page.getByText('MODEL-SCOPE-B', { exact: true })).toBeVisible();
  await expect(page.getByText('MODEL-SCOPE-A', { exact: true })).toHaveCount(0);
  expect(queries.at(-1)?.get('make')).toBe('brand_b');
  await expect.poll(() => queries.at(-1)?.get('model')).toBe('shared');

  await page.getByRole('button', { name: /清空筛选$/ }).click();
  await expect(modelSelect).toBeDisabled();
  await expect(page.getByText('MODEL-SCOPE-A', { exact: true })).toBeVisible();
  await expect(page.getByText('MODEL-SCOPE-B', { exact: true })).toBeVisible();
  expect(queries.every(query => !query.has('model') || Boolean(query.get('make')))).toBe(true);
});
