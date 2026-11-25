import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  AnalyticsOverviewResponseSchema, AnalyticsTrafficQuerySchema, AnalyticsTrafficResponseSchema,
  type AnalyticsTraffic, type AnalyticsTrafficQuery,
} from '@hd/contracts/analytics';
import { envelope, error, installApi, reply, staff } from './api-fixture';
import { select } from './ui-helpers';

const trafficDate = '2026-11-21';
const previousDate = '2026-11-20';
const firstVisitDay = '2026-11-19';
const now = Date.parse('2026-11-21T03:30:00.000Z');
const hour = 3_600_000;
const shanghaiStart = (day: string) => Date.parse(`${day}T00:00:00+08:00`);
const iso = (timestamp: number) => new Date(timestamp).toISOString();
const endpoint = '/api/v1/admin/analytics';
const analyticsPage = '/admin/analytics';
const vehicleId = '10000000-0000-4000-8000-000000000601';
const supplierId = 'ext-10000000-0000-4000-8000-000000000602';
const counts = (whatsappClicks: number, telegramClicks: number) => ({
  whatsappClicks, telegramClicks, totalContactClicks: whatsappClicks + telegramClicks,
});

type TrafficRow = AnalyticsTraffic['ranking']['items'][number];
const employeeVehicle: TrafficRow = {
  vehicleId, stockCode: 'SYNTH-STAFF', title: '合成自录车', source: 'staff', ...counts(7, 3),
};
const supplierVehicle: TrafficRow = {
  vehicleId: supplierId, stockCode: 'SYNTH-SUPPLIER', title: '合成供应商车', source: 'supplier', ...counts(1, 8),
};
const documentRecords: AnalyticsTraffic['documents'] = [
  { locale: 'zh', pageType: 'catalog', requests: 4 },
  { locale: 'zh', pageType: 'vehicle', requests: 5 },
  { locale: 'ru', pageType: 'vehicle', requests: 2 },
  { locale: 'en', pageType: 'catalog', requests: 0 },
];

function trafficFixture(query: AnalyticsTrafficQuery, { earlierMissing = false, vehicles = [employeeVehicle, supplierVehicle],
  documents = documentRecords }: { earlierMissing?: boolean; vehicles?: TrafficRow[]; documents?: AnalyticsTraffic['documents'] } = {}) {
  const { startDate, endDate, granularity, rankBy, page, pageSize, include } = query;
  if (!startDate || !endDate) throw new Error('Expected an explicit Shanghai calendar range');
  const start = shanghaiStart(startDate);
  const end = endDate === trafficDate ? now : shanghaiStart(endDate) + 24 * hour;
  const range = { start: iso(start), end: iso(end) };
  const emptyCounts = { ...counts(0, 0), documentRequests: 0 };
  const totals = { ...counts(
    vehicles.reduce((sum, row) => sum + row.whatsappClicks, 0),
    vehicles.reduce((sum, row) => sum + row.telegramClicks, 0),
  ), documentRequests: documents.reduce((sum, row) => sum + row.requests, 0) };
  const stride = granularity === 'hour' ? hour : 24 * hour;
  const collectedFrom = shanghaiStart(earlierMissing ? trafficDate : '2026-11-01');
  const visitsStarted = shanghaiStart(earlierMissing ? firstVisitDay : '2026-11-01');
  const visitsCompleteFrom = earlierMissing ? shanghaiStart(previousDate) : visitsStarted;
  const visitCoverage = end <= visitsStarted ? 'not_collected' : end <= visitsCompleteFrom ? 'gap'
    : start < visitsCompleteFrom || end % hour !== 0 ? 'partial' : 'complete';
  const measuredVisits = !earlierMissing && endDate === trafficDate ? 6 : 0;
  const visitTotals = include === 'unique-ip-visits' ? { uniqueIpVisits: visitCoverage === 'complete' || measuredVisits > 0 ? measuredVisits : null } : {};
  const contactCoverage = start < collectedFrom ? 'partial' : 'complete';
  const documentCoverage = start < collectedFrom || end % hour !== 0 ? 'partial' : 'complete';
  const trend = Array.from({ length: Math.ceil((end - start) / stride) }, (_, index) => {
    const bucket = start + index * stride;
    const bucketVisitCoverage = bucket < visitsStarted ? 'not_collected' : bucket < visitsCompleteFrom ? 'gap'
      : bucket + stride > end ? 'partial' : 'complete';
    const measuredBucket = bucket === shanghaiStart(trafficDate) ? measuredVisits : 0;
    const bucketVisits = include === 'unique-ip-visits' ? {
      visitCoverage: bucketVisitCoverage,
      uniqueIpVisits: bucketVisitCoverage === 'complete' || measuredBucket > 0 ? measuredBucket : null,
    } : {};
    return { ...(bucket === shanghaiStart(trafficDate) ? totals : emptyCounts), start: iso(bucket),
      ...bucketVisits,
      contactCoverage: bucket < collectedFrom ? 'not_collected' : 'complete',
      documentCoverage: earlierMissing && bucket === shanghaiStart('2026-11-18') ? 'gap'
        : earlierMissing && bucket === shanghaiStart('2026-11-19') ? 'partial'
          : bucket < collectedFrom ? 'not_collected' : bucket + stride > end ? 'partial' : 'complete' };
  });
  const column = ({ total: 'totalContactClicks', whatsapp: 'whatsappClicks', telegram: 'telegramClicks' } as const)[rankBy];
  const ranked = [...vehicles].sort((left, right) => right[column] - left[column] || left.vehicleId.localeCompare(right.vehicleId));
  const expectedHours = Math.floor((end - start) / hour);
  const importedHours = Math.max(0, Math.floor((end - Math.max(start, collectedFrom)) / hour));
  const visitHours = Math.max(0, Math.floor((end - Math.max(start, visitsCompleteFrom)) / hour));
  return AnalyticsTrafficResponseSchema.parse(envelope({
    timeZone: 'Asia/Shanghai', range, granularity, totals: { ...totals, ...visitTotals }, trend, documents,
    comparison: {
      currentRange: range, previousRange: { start: iso(start - (end - start)), end: iso(start) },
      current: { ...totals, ...visitTotals },
      previous: { ...emptyCounts, ...(include === 'unique-ip-visits' ? { uniqueIpVisits: null } : {}) },
      documentCoverage, previousDocumentCoverage: 'not_collected',
      contactCoverage, previousContactCoverage: 'not_collected',
      ...(include === 'unique-ip-visits' ? { visitCoverage, previousVisitCoverage: 'not_collected' } : {}),
    },
    ranking: { rankBy, page, pageSize, total: ranked.length, items: ranked.slice((page - 1) * pageSize, page * pageSize) },
    quality: {
      documents: { coverage: documentCoverage, expectedHours, importedHours, latestHour: importedHours ? iso((Math.floor(end / hour) - 1) * hour) : null },
      contacts: { configured: true, accepted: totals.totalContactClicks, rejected: 0, rateLimited: 0, unavailable: 0,
        since: iso(collectedFrom), collectionStartedAt: iso(collectedFrom), coverage: contactCoverage },
      ...(include === 'unique-ip-visits' ? { visits: {
        configured: true, coverage: visitCoverage, accepted: measuredVisits, duplicates: 0, rejected: 0, rateLimited: 0, unavailable: 0,
        since: iso(visitsStarted), expectedHours, importedHours: visitHours,
        latestHour: visitHours ? iso((Math.floor(end / hour) - 1) * hour) : null,
      } } : {}),
    },
  }));
}

type RouteTraffic = (route: Route, query: AnalyticsTrafficQuery) => void | Promise<void>;

async function installTraffic(page: Page, serve: RouteTraffic = (route, query) => reply(route, trafficFixture(query))) {
  await page.clock.setFixedTime(new Date(now));
  await installApi(page, { role: 'admin', permissions: [...staff.permissions, 'staff:manage'] });
  const reads: string[] = [];
  const queries: AnalyticsTrafficQuery[] = [];
  await page.route(`**${endpoint}/**`, route => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    const url = new URL(request.url());
    reads.push(url.pathname.split('/').at(-1)!);
    if (url.pathname !== `${endpoint}/traffic`) return reply(route, error('NOT_FOUND'), 404);
    const query = AnalyticsTrafficQuerySchema.parse(Object.fromEntries(url.searchParams));
    queries.push(query);
    return serve(route, query);
  });
  return { reads, queries };
}

const contacts = (page: Page) => page.getByRole('region', { name: '联系点击概览' });
const visits = (page: Page) => page.getByRole('region', { name: '官网访问量概览' });
const statistic = (scope: Page | Locator, title: string) => scope.locator('.ant-statistic').filter({ hasText: title }).locator('.ant-statistic-content');
const trend = (page: Page, metric: string, interval = '每日') => page.getByRole('figure', { name: `${metric}${interval}趋势`, exact: true });
const rank = (page: Page, identifier: string) => page.getByRole('row').filter({ hasText: identifier }).getByRole('cell').first();

async function expectNoDocumentUi(page: Page) {
  await expect(page.getByText('HTML 文档请求', { exact: true })).toHaveCount(0);
  await expect(page.getByText('已记录请求', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '按页面类型', exact: true })).toHaveCount(0);
  const metric = page.getByRole('combobox', { name: '趋势指标', exact: true });
  await metric.click();
  const options = page.locator('.ant-select-dropdown:visible');
  await expect(options.getByText('官网访问量', { exact: true })).toBeVisible();
  await expect(options.getByText('HTML 文档请求', { exact: true })).toHaveCount(0);
  await metric.press('Escape');
}

test('website traffic puts visits first with ECharts and hides document requests at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { reads, queries } = await installTraffic(page);
  await page.goto(analyticsPage);
  await expect(contacts(page)).toBeVisible();
  await expect(page.getByText(/2026-11-15 至 2026-11-21（北京时间）/)).toBeVisible();
  await expect(visits(page)).toBeInViewport();
  await expect(page.locator('.ant-statistic').first()).toContainText('官网访问量');
  await expect(statistic(visits(page), '官网访问量')).toHaveText('6');
  await expect(visits(page)).toContainText(/同一 IP 自上次计入起满 60 分钟后可再计一次.*跨页面和语言合并/);
  await expect(visits(page)).toContainText('所选期间采集未完整，显示已记录的访问次数。');
  await expect(trend(page, '官网访问量').getByTitle(`${trafficDate} · 6（采集未完整）`)).toHaveCount(1);
  await expect(trend(page, '官网访问量').getByRole('img').locator('svg')).toBeVisible();
  await expect(statistic(contacts(page), '联系点击总数')).toHaveText('19');
  await expect(statistic(contacts(page), 'WhatsApp 点击')).toHaveText('8');
  await expect(statistic(contacts(page), 'Telegram 点击')).toHaveText('11');
  await select(page, '趋势指标', '联系点击总数');
  await expect(trend(page, '联系点击总数').getByTitle(`${trafficDate} · 19`)).toHaveCount(1);
  await expect(page.getByRole('img', { name: '联系渠道对比', exact: true }).locator('svg')).toBeVisible();
  await expectNoDocumentUi(page);
  await expect(page.getByText(/收到的询盘由客服确认/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(reads).toEqual(['traffic']);
  expect(queries[0]).toMatchObject({ startDate: '2026-11-15', endDate: trafficDate, granularity: 'day',
    include: 'unique-ip-visits', rankBy: 'total', page: 1, pageSize: 20 });
});

test('website traffic distinguishes missing observations from measured zeros', async ({ page }) => {
  const { queries } = await installTraffic(page, (route, query) => reply(route, trafficFixture(query, { earlierMissing: true, vehicles: [], documents: [] })));
  await page.goto(analyticsPage);
  await expect(statistic(visits(page), '官网访问量')).toHaveText('未采集');
  await expect(trend(page, '官网访问量').getByTitle('2026-11-18 · 未采集')).toHaveCount(1);
  await expect(trend(page, '官网访问量').getByTitle(`${firstVisitDay} · 未采集（缺报）`)).toHaveCount(1);
  await expect(trend(page, '官网访问量').getByTitle(`${previousDate} · 0`)).toHaveCount(1);
  await page.getByText('昨日', { exact: true }).click();
  await expect(statistic(visits(page), '官网访问量')).toHaveText('0');
  await expect(trend(page, '官网访问量', '逐小时').getByTitle('00:00 · 0')).toHaveCount(1);
  await page.getByText('近 7 天', { exact: true }).click();
  await expect(statistic(visits(page), '官网访问量')).toHaveText('未采集');
  await expect(statistic(contacts(page), '联系点击总数')).toHaveText('采集未完整');
  await expectNoDocumentUi(page);
  await select(page, '趋势指标', '联系点击总数');
  await expect(trend(page, '联系点击总数').getByTitle(`${previousDate} · 未采集`)).toHaveCount(1);
  await expect(trend(page, '联系点击总数').getByTitle(`${trafficDate} · 0`)).toHaveCount(1);

  await page.getByText('今日', { exact: true }).click();
  await expect(statistic(contacts(page), '联系点击总数')).toHaveText('0');
  await expect(statistic(contacts(page), 'WhatsApp 点击')).toHaveText('0');
  await expect(trend(page, '联系点击总数', '逐小时').getByTitle('00:00 · 0')).toHaveCount(1);
  await expectNoDocumentUi(page);
  expect(queries.map(({ startDate, endDate, granularity, include }) => [startDate, endDate, granularity, include])).toEqual([
    ['2026-11-15', trafficDate, 'day', 'unique-ip-visits'],
    [previousDate, previousDate, 'hour', 'unique-ip-visits'],
    ['2026-11-15', trafficDate, 'day', 'unique-ip-visits'],
    [trafficDate, trafficDate, 'hour', 'unique-ip-visits'],
  ]);
});

test('website traffic keeps the selected dates across reports and marks incomplete ranking counts', async ({ page }) => {
  const { queries } = await installTraffic(page, (route, query) => reply(route, trafficFixture(query, {
    earlierMissing: true, vehicles: [{ ...employeeVehicle, ...counts(3, 0) }],
  })));
  const reportDates: string[][] = [];
  await page.route(`**${endpoint}/report?*`, route => {
    const { searchParams } = new URL(route.request().url());
    reportDates.push([searchParams.get('startDate') ?? '', searchParams.get('endDate') ?? '']);
    return reply(route, error('SERVICE_UNAVAILABLE'), 503);
  });
  await page.goto(analyticsPage);
  const row = page.getByRole('row').filter({ hasText: 'SYNTH-STAFF' });
  await expect(row.getByRole('cell').nth(3)).toHaveText('3');
  await expect(row.getByRole('cell').last()).toHaveText('未采集');
  await page.getByText('今日', { exact: true }).click();
  await expect(row.getByRole('cell').last()).toHaveText('0');

  await page.getByText('访客行为', { exact: true }).click();
  await expect.poll(() => reportDates).toEqual([[trafficDate, trafficDate]]);
  await page.getByText('官网流量', { exact: true }).click();
  await expect(row.getByRole('cell').last()).toHaveText('0');
  expect(queries.at(-1)).toMatchObject({ startDate: trafficDate, endDate: trafficDate, granularity: 'hour' });
});

test('website traffic loads its chunk on entry and recovers a failed load within the workspace', async ({ page }) => {
  await installTraffic(page, (route, query) => reply(route, trafficFixture({ ...query, include: undefined })));
  const pattern = /\/admin\/assets\/site-analytics-page-[^/]+\.js$/;
  let requests = 0;
  await page.route(pattern, route => { requests += 1; return route.abort(); });
  await page.goto('/admin/vehicles');
  const navigation = page.getByRole('link', { name: '网站分析', exact: true });
  await expect(navigation).toBeVisible();
  expect(requests).toBe(0);
  await navigation.click();
  await expect(page.getByText('网站分析页面加载失败', { exact: true })).toBeVisible();
  await expect(navigation).toBeVisible();
  expect(requests).toBeGreaterThan(0);
  await page.unroute(pattern);
  await page.getByRole('button', { name: '重新加载页面' }).click();
  await expect(statistic(visits(page), '官网访问量')).toHaveText('未采集');
  await expect(trend(page, '官网访问量').getByTitle(`${trafficDate} · 未采集`)).toHaveCount(1);
  await expect(statistic(contacts(page), '联系点击总数')).toHaveText('19');
  await expectNoDocumentUi(page);
});

test('website traffic plots an isolated visit point in a 90-day range', async ({ page }) => {
  const firstDate = '2026-08-24';
  const { queries } = await installTraffic(page, (route, query) => {
    const fixture = trafficFixture(query);
    if (query.startDate === firstDate) {
      fixture.data.trend = fixture.data.trend.map((bucket, index, dates) => index === dates.length - 1
        ? bucket : { ...bucket, uniqueIpVisits: null, visitCoverage: 'not_collected' });
    }
    return reply(route, fixture);
  });
  await page.goto(analyticsPage);
  await expect(visits(page)).toBeVisible();
  await page.getByText('自选日期', { exact: true }).click();
  const start = page.getByLabel('开始日期', { exact: true });
  await start.fill(firstDate);
  await start.press('Enter');
  await page.getByRole('button', { name: /查询日期$/ }).click();
  await expect.poll(() => queries.at(-1)?.startDate).toBe(firstDate);
  const chart = trend(page, '官网访问量');
  await expect(chart.getByTitle(`${firstDate} · 未采集`)).toHaveCount(1);
  await expect(chart.getByTitle(`${trafficDate} · 6（采集未完整）`)).toHaveCount(1);
  await expect(chart.locator('svg path[fill="#9a7524"]')).toBeVisible();
});

test('website traffic pages server-ranked vehicles by total, WhatsApp and Telegram and keeps its trend metric', async ({ page }) => {
  const vehicles: TrafficRow[] = [
    { ...employeeVehicle, ...counts(1, 9) },
    ...Array.from({ length: 19 }, (_, index): TrafficRow => ({
      vehicleId: `10000000-0000-4000-8000-${String(index + 650).padStart(12, '0')}`,
      title: `合成流量车 ${index + 1}`, stockCode: `SYNTH-TRAFFIC-${index + 1}`, source: 'staff', ...counts(2, 6),
    })),
    { ...supplierVehicle, ...counts(7, 0) },
  ];
  let deferredPage: { route: Route; query: AnalyticsTrafficQuery } | undefined;
  const { reads, queries } = await installTraffic(page, (route, query) => {
    if (query.rankBy === 'total' && query.page === 2) { deferredPage = { route, query }; return; }
    return reply(route, trafficFixture(query, { vehicles }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(analyticsPage);
  const staffLink = page.getByRole('link', { name: '合成自录车', exact: true });
  const supplierLink = page.getByRole('link', { name: '合成供应商车', exact: true });
  const nextPage = page.locator('.ant-pagination-next button');
  await expect(staffLink).toHaveAttribute('href', `/admin/vehicles/${vehicleId}`);
  const trendChart = trend(page, '官网访问量').getByRole('img');
  const channelChart = page.getByRole('img', { name: '联系渠道对比', exact: true });
  await expect(trendChart.locator('svg')).toBeVisible();
  await expect(channelChart.locator('svg')).toBeVisible();
  await expect(trendChart).toBeInViewport();
  await expect(channelChart).toBeInViewport();
  const trendBox = await trendChart.boundingBox();
  const channelBox = await channelChart.boundingBox();
  const rankBox = await page.getByText('车辆联系排行', { exact: true }).boundingBox();
  expect(channelBox!.x).toBeGreaterThanOrEqual(trendBox!.x + trendBox!.width);
  expect(Math.abs(trendBox!.y - channelBox!.y)).toBeLessThan(60);
  expect(Math.max(trendBox!.y + trendBox!.height, channelBox!.y + channelBox!.height)).toBeLessThanOrEqual(900);
  expect(rankBox!.y).toBeGreaterThanOrEqual(Math.max(trendBox!.y + trendBox!.height, channelBox!.y + channelBox!.height));
  await expect(rank(page, 'SYNTH-STAFF')).toHaveText('1');
  await expect(supplierLink).toHaveCount(0);
  await select(page, '趋势指标', 'Telegram 点击');
  await expect(trend(page, 'Telegram 点击')).toBeVisible();
  await nextPage.click();
  await expect(page.getByText('正在读取官网流量…', { exact: true })).toBeVisible();
  await expect.poll(() => deferredPage?.query.page).toBe(2);
  await reply(deferredPage!.route, trafficFixture(deferredPage!.query, { vehicles }));
  await expect(supplierLink).toHaveAttribute('href', `/admin/external-sources/listings/${supplierId}`);
  await expect(rank(page, 'SYNTH-SUPPLIER')).toHaveText('21');
  await expect(trend(page, 'Telegram 点击')).toBeVisible();

  await select(page, '车源排行指标', 'WhatsApp 点击');
  await expect(rank(page, 'SYNTH-SUPPLIER')).toHaveText('1');
  await nextPage.click();
  await expect(rank(page, 'SYNTH-STAFF')).toHaveText('21');
  await select(page, '车源排行指标', 'Telegram 点击');
  await expect(rank(page, 'SYNTH-STAFF')).toHaveText('1');
  await nextPage.click();
  await expect(rank(page, 'SYNTH-SUPPLIER')).toHaveText('21');
  await expect(trend(page, 'Telegram 点击')).toBeVisible();
  expect(queries.map(({ rankBy, page, pageSize }) => [rankBy, page, pageSize])).toEqual([
    ['total', 1, 20], ['total', 2, 20], ['whatsapp', 1, 20], ['whatsapp', 2, 20], ['telegram', 1, 20], ['telegram', 2, 20],
  ]);
  expect(reads).toEqual(Array.from({ length: 6 }, () => 'traffic'));
});

test('website traffic loads the session report only when chosen and falls back to the old overview on 404', async ({ page }) => {
  const { reads } = await installTraffic(page);
  const overviewReads: string[] = [];
  await page.route(`**${endpoint}/overview?*`, route => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    overviewReads.push(url.searchParams.get('days')!);
    const days = url.searchParams.get('days') === '30' ? 30 : 7;
    return reply(route, AnalyticsOverviewResponseSchema.parse(envelope({
      days, timeZone: 'Asia/Shanghai', startDate: days === 30 ? '2026-10-23' : '2026-11-15', endDate: trafficDate,
      collectionStartedAt: null, hasData: false, trend: [], topVehicles: [],
      totals: { pageViews: 0, detailViews: 0, vehicleClicks: 0, contactClicks: 0 },
    })));
  });
  await page.goto(analyticsPage);
  await expect(statistic(visits(page), '官网访问量')).toHaveText('6');
  expect(reads).toEqual(['traffic']);
  expect(overviewReads).toEqual([]);

  await page.getByText('昨日', { exact: true }).click();
  await expect(statistic(visits(page), '官网访问量')).toHaveText('0');
  const modes = page.getByRole('navigation', { name: '网站分析口径' });
  await modes.getByText('访客行为', { exact: true }).click();
  await expect(page).toHaveURL(`${analyticsPage}?view=sessions`);
  await expect(page.getByText('尚无采集数据', { exact: true })).toBeVisible();
  const fallbackNotice = page.getByText('历史统计只支持近 7 天或近 30 天，当前显示近 7 天。', { exact: true });
  await expect(fallbackNotice).toBeVisible();
  await page.getByText('近 7 天', { exact: true }).click();
  await expect(fallbackNotice).toHaveCount(0);
  await expect(contacts(page)).toHaveCount(0);
  await expect(visits(page)).toHaveCount(0);
  expect(reads).toEqual(['traffic', 'traffic', 'report']);
  expect(overviewReads).toEqual(['7']);
  await modes.getByText('官网流量', { exact: true }).click();
  await expect(statistic(visits(page), '官网访问量')).toHaveText('6');
  await expect(page.getByText('尚无采集数据', { exact: true })).toHaveCount(0);
  expect(reads).toEqual(['traffic', 'traffic', 'report', 'traffic']);
  expect(overviewReads).toEqual(['7']);
});
