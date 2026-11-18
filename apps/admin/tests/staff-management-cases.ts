import { expect, test } from '@playwright/test';
import { envelope, error, installApi, reply, staff, vehicle } from './api-fixture';
import { fillRequiredVehicleBasics } from './ui-helpers';

const directory = '/api/v1/admin/staff';
const employee = {
  id: 'fixture-employee',
  login: 'editor_fixture',
  name: '示例员工',
  role: 'editor',
  disabled: false,
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
  uploads: { today: 3, total: 31 },
};
const testPassword = 'synthetic-test-only';

test('staff uploads show account names, filter on the server and refresh the daily target', async ({ page }) => {
  const api = await installApi(page);
  const mine = { ...vehicle(), uploaderLogin: 'my_fixture' };
  const other = { ...vehicle(), id: 'other-fixture', stockCode: 'OTHER-001', uploaderLogin: 'other_fixture' };
  const requests: URLSearchParams[] = [];
  await page.route('**/api/v1/admin/me/upload-stats', route => reply(route, envelope({
    staffId: staff.id, today: 9 + api.creates.length, total: 31 + api.creates.length,
  })));
  await page.route('**/api/v1/admin/vehicles?*', route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const items = params.get('mine') === 'true' ? [mine] : [mine, other];
    const includesUploader = params.get('includeUploader') === 'true' || params.get('mine') === 'true' || params.has('uploader');
    return reply(route, envelope({
      items: includesUploader ? items : items.map(item => ({ ...item, uploaderLogin: undefined })),
      page: Number(params.get('page')), pageSize: 12, hasMore: false, total: items.length,
    }));
  });
  await page.goto('/admin/vehicles?page=2');
  const stats = page.getByRole('group', { name: '我的上传统计' });
  await expect(stats).toContainText('累计上传 31');
  const today = stats.getByText('9', { exact: true });
  await expect(today).toHaveCSS('color', 'rgb(180, 35, 24)');
  await expect(today).toHaveCSS('font-weight', '700');
  await expect(page.getByText('上传账号：other_fixture')).toBeVisible();
  expect(requests.at(-1)?.get('includeUploader')).toBe('true');
  const filter = page.getByRole('checkbox', { name: '我上传的车辆' });
  await filter.click();
  await expect(filter).toBeChecked();
  await expect.poll(() => requests.at(-1)?.get('mine')).toBe('true');
  expect(requests.at(-1)?.get('page')).toBe('1');
  await expect(page.getByText('上传账号：my_fixture')).toBeVisible();
  await expect(page.getByText('上传账号：other_fixture')).toHaveCount(0);
  await filter.click();
  await expect(filter).not.toBeChecked();
  await expect(page.getByText('上传账号：other_fixture')).toBeVisible();
  expect(requests.at(-1)?.has('mine')).toBe(false);
  await page.getByRole('button', { name: /新建车辆$/ }).click();
  await fillRequiredVehicleBasics(page, '上传计数测试草稿');
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/vehicles/${mine.id}$`));
  await expect(stats.getByText('10', { exact: true })).toHaveCSS('color', 'rgb(35, 115, 58)');
  await expect(stats).toContainText('累计上传 32');
  expect(api.creates).toHaveLength(1);
});

test('staff management and supplier status routes are denied to an editor', async ({ page }) => {
  await installApi(page);
  const privateReads: string[] = [];
  await page.route(/\/api\/v1\/admin\/(?:staff|external\/(?:sync-status|provider-status))$/, route => {
    privateReads.push(route.request().url());
    return route.fulfill({ status: 403 });
  });
  await page.goto('/admin/external-sources');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '后台导航' });
  await expect(nav.getByRole('link', { name: '三方 API 状态' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '员工管理' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '三方车源管理' })).toBeVisible();
  await page.goto('/admin/staff');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  expect(privateReads).toEqual([]);
});

test('staff uploads refresh at Beijing midnight and hide stats for a different identity', async ({ page }) => {
  await installApi(page);
  await page.clock.install({ time: new Date('2026-11-18T15:58:00Z') });
  await page.clock.pauseAt(new Date('2026-11-18T15:59:59Z'));
  let today = 10;
  let staffId = staff.id;
  await page.route('**/api/v1/admin/me/upload-stats', route => reply(route, envelope({ staffId, today, total: 55 })));
  await page.goto('/admin/vehicles');
  const stats = page.getByRole('group', { name: '我的上传统计' });
  await expect(stats).toContainText('今日上传 10');
  today = 0;
  await page.clock.fastForward(1_000);
  await expect(stats).toContainText('今日上传 0');
  staffId = employee.id;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog').getByRole('button', { name: /登录工作台$/ })).toBeVisible();
  await expect(stats).toHaveCount(0);
});

test('staff management adds an editor, shows the profile and uploads, resets and removes the account', async ({ page }) => {
  await installApi(page, { role: 'admin', permissions: [...staff.permissions, 'staff:manage'] });
  let employees: typeof employee[] = [];
  const actions: unknown[] = [];
  await page.route(`**${directory}`, route => {
    if (route.request().method() === 'POST') {
      actions.push(route.request().postDataJSON());
      employees = [employee];
      return reply(route, envelope(employee), 201);
    }
    return reply(route, envelope({ items: employees }));
  });
  await page.route(`**${directory}/${employee.id}/password`, route => {
    actions.push(route.request().postDataJSON());
    return reply(route, envelope({ id: employee.id }));
  });
  await page.route(`**${directory}/${employee.id}`, route => {
    actions.push(route.request().method());
    employees = [];
    return reply(route, envelope({ id: employee.id }));
  });
  await page.route('**/api/v1/admin/vehicles?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const items = params.get('uploader') === employee.id ? [{ ...vehicle(), uploaderLogin: employee.login }] : [];
    return reply(route, envelope({ items, page: 1, pageSize: 12, total: items.length, hasMore: false }));
  });
  await page.goto('/admin/staff');
  const nav = page.getByRole('navigation', { name: '后台导航' });
  const lastLinks = nav.getByRole('link');
  await expect(lastLinks.nth(-2)).toHaveText('员工管理');
  await expect(lastLinks.last()).toHaveText('三方 API 状态');
  await expect(page.getByRole('button', { name: /上传车辆$/ })).toHaveCount(0);
  await page.getByRole('button', { name: /添加员工$/ }).click();
  const create = page.getByRole('dialog', { name: '添加员工' });
  await create.getByLabel('登录账号').fill(employee.login);
  await create.getByLabel('员工姓名').fill(employee.name);
  await create.getByLabel('初始密码').fill(testPassword);
  await create.getByRole('button', { name: '添加员工' }).click();
  await expect(page.getByText('员工账号已添加。')).toBeVisible();
  await page.getByRole('button', { name: employee.name }).click();
  const profile = page.getByRole('dialog', { name: '员工资料' });
  await expect(profile).toContainText(employee.login);
  await expect(profile).toContainText('累计上传');
  await expect(profile).toContainText('31');
  await profile.getByRole('link', { name: '查看上传车辆' }).click();
  await expect(page.getByText(`上传账号：${employee.login}`)).toBeVisible();
  await page.getByRole('button', { name: '取消员工筛选' }).click();
  await expect(page.getByText(`上传账号：${employee.login}`)).toHaveCount(0);
  await nav.getByRole('link', { name: '员工管理', exact: true }).click();
  await page.getByRole('button', { name: '重置密码', exact: true }).click();
  const reset = page.getByRole('dialog', { name: '重置密码' });
  await reset.getByLabel('新密码').fill('different-test-password');
  await reset.getByRole('button', { name: '确认重置' }).click();
  await expect(page.getByText(/密码已重置/)).toBeVisible();
  await page.getByRole('button', { name: '删除员工', exact: true }).click();
  const remove = page.getByRole('dialog', { name: '删除员工' });
  await expect(remove).toContainText('已录入的车辆和历史记录会保留');
  await remove.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText(/员工账号已删除/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: employee.login })).toHaveCount(0);
  expect(actions).toEqual([
    { login: employee.login, name: employee.name, password: testPassword },
    { password: 'different-test-password' },
    'DELETE',
  ]);
});

test('staff management releases no private records on denial and keeps an uncertain reset explicit', async ({ page }) => {
  await installApi(page, { role: 'admin', permissions: [...staff.permissions, 'staff:manage'] });
  let canRead = true;
  await page.route(`**${directory}`, route => canRead
    ? reply(route, envelope({ items: [employee] }))
    : reply(route, error('FORBIDDEN'), 403));
  await page.route(`**${directory}/${employee.id}/password`, route => reply(route, error('INTERNAL_ERROR'), 500));
  await page.goto('/admin/staff');
  await page.getByRole('button', { name: '重置密码', exact: true }).click();
  const reset = page.getByRole('dialog', { name: '重置密码' });
  await reset.getByLabel('新密码').fill(testPassword);
  await reset.getByRole('button', { name: '确认重置' }).click();
  await expect(reset.getByText(/暂未确认操作结果/)).toBeVisible();
  await expect(reset.getByLabel('新密码')).toHaveValue('');
  await expect(reset.getByRole('button', { name: '确认重置' })).toBeDisabled();
  await reset.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.getByRole('button', { name: '刷新员工列表' }).click();
  await expect(page.getByText(/上次密码重置结果未确认/)).toBeVisible();
  await page.getByRole('link', { name: '精品车辆管理' }).click();
  const blocked = page.getByRole('dialog', { name: '员工操作结果尚未确认' });
  await blocked.getByRole('button', { name: '留在当前页面' }).click();
  await expect(page).toHaveURL(/\/admin\/staff$/);
  canRead = false;
  await page.getByRole('button', { name: '刷新员工列表' }).click();
  await expect(page.getByText('员工列表读取失败', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: employee.login })).toHaveCount(0);
});
