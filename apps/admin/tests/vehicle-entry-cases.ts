import { expect, test } from '@playwright/test';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { envelope, error, installApi, reply, vehicle } from './api-fixture';
import { select, tab } from './ui-helpers';

test('manual entry defaults and model suggestions are saved as draft facts only', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/admin/vehicles/new');
  await page.locator('.ant-radio-button-wrapper').filter({ hasText: '真实车源录入' }).click();
  await select(page, '品牌', '丰田 / Toyota');
  await select(page, '车型', '卡罗拉 / Corolla');
  await expect(page.getByLabel('所在地城市', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('公开所在地描述', { exact: true })).toHaveCount(0);
  await tab(page, '价格与内部信息');
  await expect(page.getByLabel('价格包含项目', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.creates.length).toBe(1);
  expect(JSON.parse(api.creates[0].body!)).toMatchObject({ draft: {
    facts: { model: { id: 'toyota-corolla', name: '卡罗拉' }, registrationStatus: 'registered', location: { country: 'CN', city: null, displayName: null } },
    price: { includes: [] },
  } });
  expect(api.items[0]).toMatchObject({ availability: 'unknown', availabilityCheckedAt: null });
  await expect(page).toHaveURL(/\/admin\/vehicles\/fixture_vehicle_1$/);
  await tab(page, '三语与发布');
  await expect(page.getByText('发布后可在这里查看官网访客能读取的内容。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '预览官网公开内容' })).toHaveCount(0);
  await expect(page.locator('.ant-form-item').filter({ has: page.getByRole('combobox', { name: '核验后的库存状态' }) })).toContainText('可售');
});

test('public snapshot preview distinguishes a missing locale from a proxy route failure', async ({ page }) => {
  const published = makeLocalizedPublicVehicleFixture('zh');
  await installApi(page, { items: [{ ...vehicle(), publicationState: 'published', publishedRevisionId: 'rev1', publishedAt: published.publishedAt }] });
  await page.route(`**/api/v1/vehicles/${published.id}?*`, route => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('view')).toBe('localized');
    if (query.get('locale') === 'en') return reply(route, error('NOT_FOUND'), 404);
    if (query.get('locale') === 'ru') return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' });
    return reply(route, envelope(published));
  });
  await page.goto(`/admin/vehicles/${published.id}`);
  await tab(page, '三语与发布');
  const preview = page.getByRole('button', { name: '预览官网公开内容' });
  await preview.click();
  await expect(page.getByRole('heading', { name: published.content.title.text, exact: true })).toBeVisible();
  await select(page, '公开内容语言', '英文');
  await preview.click();
  await expect(page.getByText(/当前没有这个语言的公开版本/)).toBeVisible();
  await select(page, '公开内容语言', '俄文');
  await preview.click();
  await expect(page.getByText('服务暂时不可用，请稍后重试。', { exact: true }).first()).toBeVisible();
});

for (const startsOnDesktop of [false, true]) {
  test(`vehicle table scrolls only inside the table on mobile ${startsOnDesktop ? 'after desktop resize' : 'on first load'}`, async ({ page }) => {
    await installApi(page, { items: [vehicle()] });
    await page.setViewportSize(startsOnDesktop ? { width: 1200, height: 960 } : { width: 390, height: 844 });
    await page.goto('/admin/vehicles');
    await expect(page.getByText('FIXTURE-0001', { exact: true })).toBeVisible();
    const geometry = () => page.locator('.table-region .ant-table-content').evaluate(table => ({
      pageWidth: document.documentElement.scrollWidth,
      tableScrolls: table.scrollWidth > table.clientWidth,
    }));
    if (startsOnDesktop) {
      await expect.poll(geometry).toEqual({ pageWidth: 1200, tableScrolls: false });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await expect.poll(geometry).toEqual({ pageWidth: 390, tableScrolls: true });
  });
}
