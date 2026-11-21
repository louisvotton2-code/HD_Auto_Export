import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  AnalyticsReportQuerySchema, AnalyticsReportResponseSchema,
  type AnalyticsReport, type AnalyticsReportQuery,
} from '@hd/contracts/analytics';
import { envelope, error, installApi, reply, staff } from './api-fixture';
import { select, tab } from './ui-helpers';

const reportPath = '/api/v1/admin/analytics/report';
const analyticsPage = '/admin/analytics?view=sessions';
const yesterday = '2026-11-20';
const today = '2026-11-21';
const now = '2026-11-21T03:30:00.000Z';
const dayMs = 86_400_000;
const hourMs = 3_600_000;
const iso = (timestamp: number) => new Date(timestamp).toISOString();
const midnight = (date: string) => Date.parse(`${date}T00:00:00+08:00`);
const atHour = (date: string, hour: number) => midnight(date) + hour * hourMs;
const yesterdayStart = iso(midnight(yesterday));
const todayStart = iso(midnight(today));
const counts = (pageViews = 0, detailViews = 0, vehicleClicks = 0, contactClicks = 0) => ({
  pageViews, detailViews, vehicleClicks, contactClicks, filterSubmits: 0, searchZeroResults: 0, calculatorCompletions: 0,
});
const yesterdayCounts = counts(1, 0, 1, 0);
const todayCounts = counts(5, 4, 1, 4);

// Synthetic fixture from the PM's 11-21 cross-midnight example. The browser checks display and requests.
const hourlyCounts = new Map([
  [atHour(yesterday, 23), yesterdayCounts],
  [atHour(today, 0), counts(1, 1, 0, 1)],
  [atHour(today, 9), counts(1, 1, 0, 1)],
  [atHour(today, 10), counts(2, 1, 1, 2)],
  [atHour(today, 11), counts(1, 1, 0, 0)],
]);
const vehicleId = '10000000-0000-4000-8000-000000000301';
const supplierId = 'ext-10000000-0000-4000-8000-000000000302';
type RankRow = AnalyticsReport['ranking']['items'][number];
const vehicleX: RankRow = {
  vehicleId, title: '合成车辆 X', stockCode: 'SYNTH-X', source: 'staff',
  detailViews: 3, vehicleClicks: 2, contactClicks: 2, whatsappClicks: 2, telegramClicks: 0,
  detailSessions: 2, contactAfterDetailSessions: 1, contactRate: 0.5,
};
const vehicleY: RankRow = {
  vehicleId: supplierId, title: '合成车辆 Y', stockCode: 'SYNTH-Y', source: 'supplier',
  detailViews: 1, vehicleClicks: 0, contactClicks: 2, whatsappClicks: 0, telegramClicks: 2,
  detailSessions: 1, contactAfterDetailSessions: 1, contactRate: 1,
};

const noCatalog = { catalog: 0, vehicleClick: 0, detail: 0, contact: 0 };
const noDirect = { detail: 0, contact: 0 };

function sampleReport(query: AnalyticsReportQuery, { gap = false, rankings = [vehicleX, vehicleY], snapshotAt = Date.parse(now) }:
  { gap?: boolean; rankings?: RankRow[]; snapshotAt?: number } = {}) {
  const { startDate, endDate, granularity, metric, page, pageSize } = query;
  if (!startDate || !endDate) throw new Error('The v2 browser must send explicit Shanghai calendar dates');
  const first = midnight(startDate);
  const until = endDate === today ? snapshotAt : midnight(endDate) + dayMs;
  const includeYesterday = startDate <= yesterday && endDate >= yesterday;
  const includeToday = startDate <= today && endDate >= today && until > midnight(today);
  const coverage = gap ? 'gap' : 'complete';
  const width = granularity === 'hour' ? hourMs : dayMs;
  const trend = Array.from({ length: Math.ceil((until - first) / width) }, (_, index) => {
    const time = first + index * width;
    const dayTotals = time === midnight(yesterday) ? yesterdayCounts : time === midnight(today) ? todayCounts : counts();
    const totals = granularity === 'hour' ? hourlyCounts.get(time) ?? counts() : dayTotals;
    return { ...totals, start: iso(time), coverage: gap && !totals.pageViews ? 'gap' : 'complete' };
  });
  const rankingScore = (row: RankRow) => metric === 'contactRate' ? row.contactRate ?? -1 : row[metric];
  const ordered = includeToday && !gap
    ? [...rankings].sort((left, right) => rankingScore(right) - rankingScore(left) || left.vehicleId.localeCompare(right.vehicleId)) : [];
  const markets = includeToday && !gap ? {
    countries: [{ country: 'ZZ', sessions: 1, ...counts(2, 1, 1, 2) }, { country: 'RU', sessions: 2, ...counts(4, 3, 1, 2) }],
    sources: [{ source: 'unknown', sessions: 1, ...counts(2, 1, 1, 2) }, { source: 'referral', sessions: 1, ...counts(1, 1, 0, 1) }],
    channels: [{ channel: 'whatsapp', contactClicks: 2 }, { channel: 'telegram', contactClicks: 2 }],
  } : { countries: [], sources: [], channels: [] };
  return AnalyticsReportResponseSchema.parse(envelope({
    timeZone: 'Asia/Shanghai', range: { start: iso(first), end: iso(until) }, granularity,
    collectionStartedAt: yesterdayStart, legacyCollectionStartedAt: null, coverage,
    totals: includeToday && includeYesterday ? counts(6, 4, 2, 4) : includeToday ? todayCounts : includeYesterday ? yesterdayCounts : counts(),
    sessions: includeYesterday && includeToday ? 3 : includeToday ? 2 : includeYesterday ? 1 : 0,
    activeSessions: includeToday ? 1 : 0,
    trend,
    comparison: {
      today: { start: todayStart, end: iso(snapshotAt) }, yesterday: { start: yesterdayStart, end: iso(snapshotAt - dayMs) },
      current: todayCounts, previous: counts(), todayCoverage: coverage, yesterdayCoverage: 'complete',
    },
    markets: { ...markets, languages: [], devices: [], entries: [], campaigns: [] },
    dailyUniqueIpEstimates: [
      ...(includeYesterday ? [{ date: yesterday, estimate: 1 }] : []),
      ...(includeToday ? [{ date: today, estimate: 3 }] : []),
    ],
    ranking: { metric, page, pageSize, total: ordered.length, items: ordered.slice((page - 1) * pageSize, page * pageSize) },
    funnels: {
      catalog: includeYesterday && includeToday ? { catalog: 2, vehicleClick: 2, detail: 2, contact: 1 } : noCatalog,
      direct: includeToday ? { detail: 1, contact: 1 } : noDirect,
    },
    quality: { received: 16, accepted: 12, duplicates: 4, dropped: 0 },
    runtimeQuality: { acceptedBatches: 4, rejectedBatches: 0, rateLimitedBatches: 0, unavailableBatches: 0, since: yesterdayStart },
  }));
}

async function installReport(page: Page, options?: Parameters<typeof sampleReport>[1]) {
  await page.clock.setFixedTime(new Date(options?.snapshotAt ?? now));
  await installApi(page, { role: 'admin', permissions: [...staff.permissions, 'staff:manage'] });
  const reads: AnalyticsReportQuery[] = [];
  await page.route(`**${reportPath}?*`, route => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    const query = AnalyticsReportQuerySchema.parse(Object.fromEntries(new URL(request.url()).searchParams));
    reads.push(query);
    return reply(route, sampleReport(query, options));
  });
  return reads;
}

const region = (page: Page) => page.getByRole('region', { name: '统计概览' });
const figure = (page: Page, name: string) => page.getByRole('figure', { name, exact: true });
const statistic = (scope: Page | Locator, title: string) => scope.locator('.ant-statistic').filter({ hasText: title }).locator('.ant-statistic-content');
const readDate = (page: Page, date: string) => page.getByText(`统计范围　${date} 至 ${date}（北京时间）`, { exact: true });

async function verifyCounters(page: Page, expected: ReturnType<typeof counts>) {
  await expect(statistic(region(page), '页面浏览（PV）')).toHaveText(String(expected.pageViews));
  await expect(statistic(region(page), '车辆详情浏览')).toHaveText(String(expected.detailViews));
  await expect(statistic(region(page), '车辆卡片点击')).toHaveText(String(expected.vehicleClicks));
  await expect(statistic(region(page), '主动联系点击')).toHaveText(String(expected.contactClicks));
}

test.describe('v2 website analytics in a non-Shanghai browser', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('uses Shanghai today, yesterday and a custom short interval', async ({ page }) => {
    const reads = await installReport(page);
    await page.goto(analyticsPage);
    await tab(page, '历史总览');
    await expect(region(page)).toBeVisible();
    await page.getByText('昨日', { exact: true }).click();
    await expect(readDate(page, yesterday)).toBeVisible();
    await verifyCounters(page, yesterdayCounts);
    await expect(figure(page, '页面浏览（PV）逐小时趋势').getByTitle('23:00 · 1')).toHaveCount(1);

    await page.getByText('今日', { exact: true }).click();
    await expect(readDate(page, today)).toBeVisible();
    await verifyCounters(page, todayCounts);
    await expect(page.getByText(/与今日同一时段/)).toContainText(/00:00.*11:30/);
    await expect(page.getByText('上期 0 · 无可比比例', { exact: true })).toHaveCount(4);
    await expect(figure(page, '页面浏览（PV）逐小时趋势').getByTitle('00:00 · 1')).toHaveCount(1);

    await page.getByText('自选日期', { exact: true }).click();
    await page.getByLabel('开始日期', { exact: true }).click();
    await page.locator(`.ant-picker-dropdown:visible td[title="${yesterday}"]`).click();
    await page.getByRole('button', { name: /查询日期$/ }).click();
    await expect(page.getByText(`统计范围　${yesterday} 至 ${today}（北京时间）`, { exact: true })).toBeVisible();
    await verifyCounters(page, counts(6, 4, 2, 4));
    await expect(statistic(region(page), '匿名会话')).toHaveText('3');
    const trend = figure(page, '页面浏览（PV）每日趋势');
    await expect(trend.getByTitle(`${yesterday} · 1`)).toHaveCount(1);
    await expect(trend.getByTitle(`${today} · 5`)).toHaveCount(1);
    await page.getByText('查看逐日估算', { exact: true }).click();
    const daily = page.locator('details').filter({ hasText: '查看逐日估算' });
    await expect(daily.locator('dt')).toHaveText([yesterday, today]);
    await expect(daily.locator('dd')).toHaveText(['1', '3']);
    expect(reads.slice(1).map(({ startDate, endDate, granularity }) => [startDate, endDate, granularity]))
      .toEqual([[yesterday, yesterday, 'hour'], [today, today, 'hour'], [yesterday, today, 'day']]);
  });
});

test('v2 website analytics distinguishes an interrupted hour from a collected zero', async ({ page }) => {
  await installReport(page, { gap: true });
  await page.goto(analyticsPage);
  await tab(page, '历史总览');
  await expect(region(page)).toBeVisible();
  await page.getByText('今日', { exact: true }).click();
  await expect(readDate(page, today)).toBeVisible();
  await expect(page.getByText(/所选区间有采集停顿/)).toBeVisible();
  await select(page, '趋势指标', '主动联系点击');
  await page.getByText('查看逐小时数据', { exact: true }).click();
  const daily = page.locator('details').filter({ hasText: '查看逐小时数据' });
  await expect(daily.locator('dl > div').filter({ hasText: '01:00' }).locator('dd')).toHaveText('采集停顿');
  await expect(daily.locator('dl > div').filter({ hasText: '11:00' }).locator('dd')).toHaveText('0');
  await expect(statistic(region(page), '主动联系点击')).toHaveText('4');
});

test('v2 website analytics shows a month-long report generated at the selected final day midnight', async ({ page }) => {
  const reads = await installReport(page, { snapshotAt: midnight(today) });
  await page.goto(analyticsPage);
  await tab(page, '历史总览');
  await expect(page.getByText('统计范围　2026-10-23 至 2026-11-21（北京时间）', { exact: true })).toBeVisible();
  await expect(page.getByText(/统计截止.*00:00/)).toBeVisible();
  await verifyCounters(page, yesterdayCounts);
  expect(reads[0]).toMatchObject({ startDate: '2026-10-23', endDate: today, granularity: 'day' });
});

test('v2 website analytics keeps all four views on a 390 px screen and shows unknown markets and ordered conversion', async ({ page }) => {
  const reads = await installReport(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(analyticsPage);
  const checkWidth = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.getByRole('tab')).toHaveText(['从浏览到联系', '市场来源', '车型排行', '历史总览']);
  await expect(page.getByRole('tab', { name: '从浏览到联系', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: '从浏览到联系', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '目录到联系的访客路径', exact: true }).locator('svg')).toBeVisible();
  await checkWidth();

  await tab(page, '市场来源');
  const attribution = page.getByRole('link', { name: 'IP Geolocation by DB-IP', exact: true });
  const unknownRegion = page.getByRole('row').filter({ hasText: '未知国家或地区' });
  await expect(unknownRegion).toBeVisible();
  await expect(attribution).toBeVisible();
  await expect(attribution).toHaveAttribute('href', 'https://db-ip.com/');
  await expect(attribution).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('img', { name: '按国家或地区的浏览过程次数', exact: true }).locator('svg')).toBeVisible();
  await expect(unknownRegion.getByRole('cell').first()).toHaveText('1');
  await select(page, '统计维度', '访问来源');
  await expect(page.getByRole('table').getByText('未知', { exact: true })).toBeVisible();
  await expect(attribution).toHaveCount(0);
  await checkWidth();

  await tab(page, '车型排行');
  await expect(page.getByRole('link', { name: '合成车辆 X', exact: true })).toHaveAttribute('href', `/admin/vehicles/${vehicleId}`);
  await expect(page.getByRole('link', { name: '合成车辆 Y', exact: true })).toHaveAttribute('href', `/admin/external-sources/listings/${supplierId}`);
  const supplier = page.getByRole('row').filter({ hasText: 'SYNTH-Y' });
  await expect(supplier.getByText('第三方车源', { exact: true })).toBeVisible();
  await expect(supplier.getByText('1 / 1', { exact: true })).toBeVisible();
  await checkWidth();

  await tab(page, '从浏览到联系');
  await page.getByText('查看各步骤次数', { exact: true }).click();
  const steps = page.getByRole('list').filter({ hasText: '浏览车辆目录' }).getByRole('listitem');
  await expect(steps).toHaveText([
    /浏览车辆目录\s*2 次/, /点击车辆卡片\s*2 次/, /浏览同一车辆详情\s*2 次/, /主动联系同一车辆\s*1 次/,
  ]);
  await expect(statistic(page, '从站外直达详情')).toHaveText('1');
  await expect(statistic(page, '零结果次数')).toHaveText('0');
  await checkWidth();
  await tab(page, '历史总览');
  await expect(region(page)).toBeVisible();
  await expect(page.getByText('国家未知的会话', { exact: true })).toBeVisible();
  await expect(attribution).toBeVisible();
  await expect(figure(page, '页面浏览（PV）每日趋势').getByRole('img').locator('svg')).toBeVisible();
  await checkWidth();
  expect(reads).toHaveLength(1);
});

test('v2 website analytics keeps historical gaps and uncollected country data distinct from measured values', async ({ page }) => {
  await installReport(page);
  await page.route(`**${reportPath}?*`, route => {
    const query = AnalyticsReportQuerySchema.parse(Object.fromEntries(new URL(route.request().url()).searchParams));
    const report = sampleReport(query);
    return reply(route, AnalyticsReportResponseSchema.parse({
      ...report,
      data: {
        ...report.data,
        coverage: 'not_collected',
        legacyCollectionStartedAt: iso(midnight('2026-10-01')),
        totals: { ...report.data.totals, contactClicks: 0 },
        trend: report.data.trend.map(bucket => ({ ...bucket, coverage: 'not_collected' })),
        markets: { ...report.data.markets, countries: [] },
      },
    }));
  });
  const attribution = page.getByRole('link', { name: 'IP Geolocation by DB-IP', exact: true });
  await page.goto(analyticsPage);
  await tab(page, '市场来源');
  await expect(page.getByText('所选期间暂无可用的市场来源数据', { exact: true })).toBeVisible();
  await expect(attribution).toHaveCount(0);
  await tab(page, '历史总览');
  await expect(page.getByText('国家未知的会话', { exact: true }).locator('..')).toContainText('未采集');
  await expect(statistic(region(page), '页面浏览（PV）')).toHaveText('6');
  await expect(statistic(region(page), '主动联系点击')).toHaveText('—');
  await page.getByText('查看每日数据', { exact: true }).click();
  const daily = page.locator('details').filter({ hasText: '查看每日数据' });
  await expect(daily.locator('dl > div').filter({ hasText: '2026-11-19' }).locator('dd')).toHaveText('未采集');
  await expect(daily.locator('dl > div').filter({ hasText: '2026-11-20' }).locator('dd')).toHaveText('1');
  await expect(attribution).toHaveCount(0);
});

test('v2 website analytics requests ranked pages from the entire result for each selected metric', async ({ page }) => {
  const rankings: RankRow[] = [vehicleX, ...Array.from({ length: 19 }, (_, index): RankRow => ({
    ...vehicleX, vehicleId: `10000000-0000-4000-8000-${String(401 + index).padStart(12, '0')}`,
    title: `合成排行车 ${index + 1}`, stockCode: `SYNTH-R${index + 1}`, detailViews: 2,
    detailSessions: 0, contactAfterDetailSessions: 0, contactRate: null,
  })), vehicleY];
  const reads = await installReport(page, { rankings });
  await page.goto(analyticsPage);
  await tab(page, '车型排行');
  const supplier = page.getByRole('row').filter({ hasText: 'SYNTH-Y' });
  const firstRank = page.getByRole('row').filter({ hasText: 'SYNTH-X' });
  await expect(page.getByText('共 21 辆', { exact: true })).toBeVisible();
  await expect(firstRank.getByRole('cell').first()).toHaveText('1');
  await expect(supplier).toHaveCount(0);
  await page.locator('.ant-pagination-next button').click();
  await expect(supplier.getByRole('cell').first()).toHaveText('21');
  await expect(firstRank).toHaveCount(0);

  await select(page, '车源排行指标', '详情联系率');
  await expect(page.getByRole('columnheader', { name: '详情联系率', exact: true })).toHaveAttribute('aria-sort', 'descending');
  await expect(supplier.getByRole('cell').first()).toHaveText('1');
  await expect(supplier.getByText('100%', { exact: true })).toBeVisible();
  await expect(firstRank.getByRole('cell').first()).toHaveText('2');
  await expect(page.getByText('无可比值', { exact: true }).first()).toBeVisible();
  await page.locator('.ant-pagination-next button').click();
  await expect(page.getByRole('row').filter({ hasText: 'SYNTH-R19' }).getByRole('cell').first()).toHaveText('21');
  expect(reads.map(({ metric, page, pageSize }) => [metric, page, pageSize]))
    .toEqual([['detailViews', 1, 20], ['detailViews', 2, 20], ['contactRate', 1, 20], ['contactRate', 2, 20]]);
  expect(reads.every(({ source, country, device, entry, locale }) => [source, country, device, entry, locale].every(value => value === undefined))).toBe(true);
});

for (const [status, code, message] of [
  [401, 'UNAUTHENTICATED', '重新登录'],
  [403, 'FORBIDDEN', '没有访问权限'],
  [503, 'SERVICE_UNAVAILABLE', '网站分析读取失败'],
] as const) {
  test(`v2 website analytics clears the report on ${status} without falling back`, async ({ page }) => {
    await installReport(page);
    let legacyReads = 0;
    await page.route('**/api/v1/admin/analytics/overview?*', route => {
      legacyReads++;
      return reply(route, error('NOT_FOUND'), 404);
    });
    await page.goto(analyticsPage);
    await expect(page.getByRole('region', { name: '从浏览到联系', exact: true })).toBeVisible();
    await page.route('**/api/v1/admin/analytics/report?*', route => reply(route, error(code), status));
    await page.getByRole('button', { name: /刷新$/ }).click();
    await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: '从浏览到联系', exact: true })).toHaveCount(0);
    await expect(region(page)).toHaveCount(0);
    expect(legacyReads).toBe(0);
  });
}

test('an unauthorized editor makes zero requests to either website analytics endpoint', async ({ page }) => {
  await installApi(page);
  const reads: string[] = [];
  await page.route('**/api/v1/admin/analytics/**', route => {
    reads.push(route.request().url());
    return reply(route, error('FORBIDDEN'), 403);
  });
  await page.goto(analyticsPage);
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '网站分析', exact: true })).toHaveCount(0);
  expect(reads).toEqual([]);
});
