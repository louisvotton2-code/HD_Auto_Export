import { expect, test } from '@playwright/test';
import { installApi, vehicle } from './api-fixture';
import { fillRequiredVehicleBasics, tab } from './ui-helpers';

test('vehicle list distinguishes an incomplete asking quote from an explicit on-request price', async ({ page }) => {
  const missingMoney = vehicle(); missingMoney.stockCode = 'ASKING-NO-MONEY';
  missingMoney.draft.price = { kind: 'asking', money: null, includes: [] };
  const missingAmount = vehicle(); missingAmount.id = 'fixture_missing_amount'; missingAmount.stockCode = 'ASKING-CNY-NO-AMOUNT';
  missingAmount.draft.price = { kind: 'asking', money: { amount: null, currency: 'CNY' }, includes: [] };
  const onRequest = vehicle(); onRequest.id = 'fixture_on_request'; onRequest.stockCode = 'ON-REQUEST';
  onRequest.draft.price = { kind: 'on_request', money: null, includes: [] };
  await installApi(page, { items: [missingMoney, missingAmount, onRequest] });
  await page.goto('/admin/vehicles');
  for (const [stockCode, amountText, kindText] of [
    ['ASKING-NO-MONEY', '报价待填写', '公开报价'],
    ['ASKING-CNY-NO-AMOUNT', '报价待填写 · CNY', '公开报价'],
    ['ON-REQUEST', '待询价', '暂无公开报价'],
  ]) {
    const row = page.getByRole('row').filter({ has: page.getByText(stockCode, { exact: true }) });
    const price = row.locator('.vehicle-price');
    await expect(price).toHaveText(`${amountText} ${kindText}`);
    if (stockCode !== 'ON-REQUEST') await expect(price).not.toContainText('待询价');
    else await expect(price).not.toContainText('报价待填写');
  }
});

test('manual entry defaults and model suggestions are saved as draft facts only', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/admin/vehicles/new');
  await fillRequiredVehicleBasics(page);
  await expect(page.getByLabel('车辆所在地', { exact: true })).toHaveValue('成都市');
  await expect(page.getByLabel('公开所在地描述', { exact: true })).toHaveCount(0);
  await tab(page, '价格与内部信息');
  await expect(page.getByLabel('价格包含项目', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /保存草稿$/ }).click();
  await expect.poll(() => api.creates.length).toBe(1);
  expect(JSON.parse(api.creates[0].body!)).toMatchObject({ draft: {
    facts: { model: { id: 'toyota-corolla', name: '卡罗拉' }, registrationStatus: 'registered', location: { country: 'CN', city: '成都市', displayName: null } },
    price: { includes: [] },
  } });
  expect(api.items[0]).toMatchObject({ availability: 'unknown', availabilityCheckedAt: null });
  await expect(page).toHaveURL(/\/admin\/vehicles\/fixture_vehicle_1$/);
  await tab(page, '发布预览');
  await expect(page.getByText('官网公开内容', { exact: true })).toHaveCount(0);
  await expect(page.locator('.ant-form-item').filter({ has: page.getByRole('combobox', { name: '核验后的库存状态' }) })).toContainText('可售');
});

test('manual entry finds expanded brands by alias and searches within the selected brand', async ({ page }) => {
  await installApi(page);
  await page.goto('/admin/vehicles/new');
  const brand = page.getByRole('combobox', { name: '品牌', exact: true });
  const model = page.getByRole('combobox', { name: '车型', exact: true });
  const choices = page.locator('.ant-select-dropdown:visible');

  await brand.click();
  await brand.fill('Сяоми');
  await choices.getByText('小米汽车 / Xiaomi Auto', { exact: true }).click();
  await model.click();
  await model.fill('SU7');
  await choices.getByText('小米SU7 / Xiaomi SU7', { exact: true }).click();
  await expect(page.getByText('小米SU7 / Xiaomi SU7', { exact: true })).toBeVisible();

  await brand.click();
  await brand.fill('Toyota');
  await choices.getByText('丰田 / Toyota', { exact: true }).click();
  await expect(page.getByText('小米SU7 / Xiaomi SU7', { exact: true })).toBeHidden();
  await model.click();
  await model.fill('Corolla');
  await expect(choices.getByText('卡罗拉 / Corolla', { exact: true })).toBeVisible();
});

test('publication preview omits the public content card for a published vehicle', async ({ page }) => {
  const item = { ...vehicle(), id: '30000000-0000-4000-8000-000000000001',
    publicationState: 'published' as const, publishedRevisionId: 'rev1', publishedAt: '2026-11-16T08:00:00Z' };
  await installApi(page, { items: [item] });
  await page.goto(`/admin/vehicles/${item.id}`);
  await tab(page, '发布预览');
  await expect(page.locator('iframe[title="中文车辆发布预览"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: '库存与发布' })).toBeVisible();
  await expect(page.getByText('官网公开内容', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预览官网公开内容' })).toHaveCount(0);
});

for (const startsOnDesktop of [false, true]) {
  test(`vehicle table scrolls only inside the table on mobile ${startsOnDesktop ? 'after desktop resize' : 'on first load'}`, async ({ page }, testInfo) => {
    const record = vehicle();
    record.activity = {
      created: { at: '2026-11-13T01:02:03.000Z', actor: { kind: 'staff', staffId: 'staff-layout-creator-000000000000000000000001', name: '采购资料维护员工甲（姓名完整可读）' } },
      lastModified: { at: '2026-11-13T03:04:05.000Z', actor: { kind: 'staff', staffId: 'staff-layout-editor-000000000000000000000002', name: '车辆运营修改员工乙（姓名完整可读）' } },
      firstImported: null, lastSyncedAt: null,
    };
    await installApi(page, { items: [record] });
    await page.setViewportSize(startsOnDesktop ? { width: 1200, height: 960 } : { width: 390, height: 844 });
    await page.goto('/admin/vehicles');
    await expect(page.getByText('FIXTURE-0001', { exact: true })).toBeVisible();
    const geometry = () => page.locator('.table-region .ant-table-content').evaluate(table => ({
      pageWidth: document.documentElement.scrollWidth,
      tableScrolls: table.scrollWidth > table.clientWidth,
    }));
    const table = page.locator('.table-region .ant-table-content');
    const metadata = page.locator('dl[aria-label="员工与系统操作摘要"]');
    for (const actor of [record.activity.created!.actor, record.activity.lastModified!.actor]) await expect(metadata.getByText(actor.name!, { exact: true })).toBeVisible();
    const creation = metadata.locator(':scope > div').filter({ has: page.getByText('创建', { exact: true }) }).locator('[tabindex="0"]');
    await creation.focus();
    await expect(page.getByRole('tooltip')).toContainText(record.activity.created!.actor.staffId!);
    await expect(page.getByRole('tooltip')).toContainText(record.activity.created!.at);
    await expect(page.getByRole('tooltip')).toContainText('北京时间');
    await creation.blur();
    await expect(page.getByRole('tooltip')).not.toBeVisible();
    if (startsOnDesktop) {
      await expect.poll(geometry).toEqual({ pageWidth: 1200, tableScrolls: false });
      await table.scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: '操作记录', exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('vehicle-table-1200.png'), animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await expect.poll(geometry).toEqual({ pageWidth: 390, tableScrolls: true });
    await table.scrollIntoViewIfNeeded();
    await table.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(page.getByRole('button', { name: '操作记录', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('vehicle-table-390-actions.png'), animations: 'disabled' });
    await table.evaluate(element => { element.scrollLeft = 0; });
    await expect(page.getByText('FIXTURE-0001', { exact: true })).toBeInViewport();
    await expect.poll(geometry).toEqual({ pageWidth: 390, tableScrolls: true });
    await page.screenshot({ path: testInfo.outputPath('vehicle-table-390-vehicle.png'), animations: 'disabled' });
  });
}
