import { expect, test, type Page, type Route } from '@playwright/test';
import { AnalyticsOverviewResponseSchema, type AnalyticsDays } from '@hd/contracts/analytics';
import { envelope, error, installApi, reply, staff } from './api-fixture';
import { select } from './ui-helpers';

const overviewPath = '**/api/v1/admin/analytics/overview?days=*';
const vehicleId = '10000000-0000-4000-8000-000000000301';
const supplierVehicleId = 'ext-10000000-0000-4000-8000-000000000304';
const emptyTotals = { pageViews: 0, detailViews: 0, vehicleClicks: 0, contactClicks: 0 };
const sampleTotals = { pageViews: 1280, detailViews: 410, vehicleClicks: 36, contactClicks: 9 };

function sampleOverview(days: AnalyticsDays, hasData = true, collectionStartedAt = hasData ? '2026-11-18T16:35:00.000Z' : null) {
  const end = Date.UTC(2026, 10, 19);
  const trend = Array.from({ length: days }, (_, index) => ({
    date: new Date(end - (days - index - 1) * 86_400_000).toISOString().slice(0, 10),
    ...(index === days - 1 && hasData ? sampleTotals : emptyTotals),
  }));
  return AnalyticsOverviewResponseSchema.parse(envelope({
    days, timeZone: 'Asia/Shanghai', hasData,
    startDate: trend[0]!.date, endDate: trend.at(-1)!.date,
    collectionStartedAt,
    totals: hasData ? sampleTotals : emptyTotals, trend: hasData ? trend : [],
    topVehicles: hasData ? [
      { vehicleId, detailViews: 17, vehicleClicks: 11, contactClicks: 3 },
      { vehicleId: supplierVehicleId, detailViews: 12, vehicleClicks: 6, contactClicks: 1 },
    ] : [],
  }));
}

async function installAnalyticsAdmin(page: Page) {
  await installApi(page, { role: 'admin', permissions: [...staff.permissions, 'staff:manage'] });
}

test('an administrator can select website analytics periods, trend metrics and vehicle rankings', async ({ page }) => {
  await installAnalyticsAdmin(page);
  const periods: string[] = [];
  await page.route(overviewPath, route => {
    const period = new URL(route.request().url()).searchParams.get('days')!;
    periods.push(period);
    return reply(route, sampleOverview(period === '7' ? 7 : 30));
  });
  await page.goto('/admin/vehicles');
  await page.getByRole('link', { name: '网站分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '网站分析', exact: true })).toBeVisible();
  await expect(page.getByText(/2026-10-21 至 2026-11-19（北京时间）/)).toBeVisible();
  await expect(page.getByText(/采集开始.*2026年11月19日.*00:35/)).toBeVisible();
  await expect(page.getByRole('region', { name: '统计概览' })).toContainText('1,280');
  await expect(page.getByRole('row').filter({ hasText: vehicleId }).getByRole('cell'))
    .toHaveText([vehicleId, '17', '11', '3']);
  await expect(page.getByText('主动联系点击表示联系意向。目前官网接入 WhatsApp 和 Telegram。', { exact: true })).toBeVisible();
  await select(page, '趋势指标', '车辆卡片点击');
  await expect(page.getByRole('figure', { name: '车辆卡片点击每日趋势' })).toBeVisible();
  await page.getByText('查看每日数据', { exact: true }).click();
  await expect(page.getByText('未采集', { exact: true }).first()).toBeVisible();
  await page.getByText('近 7 天', { exact: true }).click();
  await expect(page.getByText(/2026-11-13 至 2026-11-19（北京时间）/)).toBeVisible();
  await expect(page.getByRole('figure', { name: '车辆卡片点击每日趋势' })).toBeVisible();
  expect(periods).toEqual(['30', '7']);
  await page.getByRole('button', { name: /刷新$/ }).click();
  await expect(page.getByRole('figure', { name: '车辆卡片点击每日趋势' })).toBeVisible();
  expect(periods).toEqual(['30', '7', '7']);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const supplier = page.getByRole('link', { name: supplierVehicleId, exact: true });
  await expect(supplier).toHaveAttribute('href', '/admin/external-sources/listings/' + supplierVehicleId);
  await supplier.click();
  await expect(page).toHaveURL('/admin/external-sources/listings/' + supplierVehicleId);
});

test('website analytics shows no collection history on a narrow screen', async ({ page }) => {
  await installAnalyticsAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(overviewPath, route => reply(route, sampleOverview(30, false)));
  await page.goto('/admin/analytics');
  await expect(page.getByText('尚无采集数据', { exact: true })).toBeVisible();
  await expect(page.getByText(/采集开始.*尚无采集记录/)).toBeVisible();
  await expect(page.getByRole('figure')).toHaveCount(0);
  await expect(page.getByText('此期间暂无车辆数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '统计概览' }).getByText('—', { exact: true })).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('website analytics displays a read failure and reloads when the API recovers', async ({ page }) => {
  await installAnalyticsAdmin(page);
  let recovered = false;
  await page.route(overviewPath, route => recovered ? reply(route, sampleOverview(30)) : reply(route, error('SERVICE_UNAVAILABLE'), 503));
  await page.goto('/admin/analytics');
  await expect(page.getByRole('alert')).toContainText('网站分析读取失败');
  await expect(page.getByText('尚无采集数据', { exact: true })).toHaveCount(0);
  recovered = true;
  await page.getByRole('button', { name: /刷新$/ }).click();
  await expect(page.getByRole('region', { name: '统计概览' })).toContainText('1,280');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('website analytics shows actual zeros for an empty period after collection started', async ({ page }) => {
  await installAnalyticsAdmin(page);
  await page.route(overviewPath, route => reply(route, sampleOverview(30, false, '2026-09-01T01:00:00.000Z')));
  await page.goto('/admin/analytics');
  await expect(page.getByText('此期间暂无访问数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '统计概览' }).getByText('0', { exact: true })).toHaveCount(4);
});

test('website analytics waits for the current request when quickly switching back to an earlier period', async ({ page }) => {
  await installAnalyticsAdmin(page);
  const reads: string[] = [];
  const waiting: Route[] = [];
  await page.route(overviewPath, route => {
    const days = new URL(route.request().url()).searchParams.get('days')!;
    reads.push(days);
    if (reads.length === 1) return reply(route, sampleOverview(30));
    waiting.push(route);
  });
  await page.goto('/admin/analytics');
  await expect(page.getByRole('region', { name: '统计概览' })).toContainText('1,280');
  await page.getByText('近 30 天', { exact: true }).click();
  await page.getByText('近 7 天', { exact: true }).click();
  await expect.poll(() => waiting.length).toBe(1);
  await page.getByText('近 30 天', { exact: true }).click();
  await expect(page.getByText('正在读取网站分析…', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '统计概览' })).toHaveCount(0);
  expect(reads).toEqual(['30', '7']);
  await reply(waiting[0]!, sampleOverview(7));
  await expect.poll(() => waiting.length).toBe(2);
  await expect(page.getByRole('region', { name: '统计概览' })).toHaveCount(0);
  await reply(waiting[1]!, sampleOverview(30, false));
  await expect(page.getByText('尚无采集数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '统计概览' })).not.toContainText('1,280');
  expect(reads).toEqual(['30', '7', '30']);
});

test('website analytics shows a permission denial from the service without a loading or empty dashboard', async ({ page }) => {
  await installAnalyticsAdmin(page);
  await page.route(overviewPath, route => reply(route, error('FORBIDDEN'), 403));
  await page.goto('/admin/analytics');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '统计概览' })).toHaveCount(0);
  await expect(page.getByText('尚无采集数据', { exact: true })).toHaveCount(0);
});

test('an editor cannot navigate to or fetch website analytics from the admin screen', async ({ page }) => {
  await installApi(page);
  let analyticsReads = 0;
  await page.route(overviewPath, route => {
    analyticsReads++;
    return reply(route, error('FORBIDDEN'), 403);
  });
  await page.goto('/admin/analytics');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '网站分析', exact: true })).toHaveCount(0);
  expect(analyticsReads).toBe(0);
});
