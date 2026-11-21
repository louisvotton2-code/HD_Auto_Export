import type { AnalyticsReport, AnalyticsReportQuery } from '@hd/contracts/analytics';
import type { MarketBreakdown, MarketDimension } from './v2-market-view';
import type { OverviewData, CollectionQuality, MetricCounts } from './v2-overview-view';
import type { ConversionBreakdown } from './v2-conversion-view';
import type { V2VehicleMetric, V2VehicleRow } from './v2-vehicle-view';

export const marketDimensions: readonly MarketDimension[] = ['country', 'locale', 'device', 'entryPage', 'source', 'channel', 'utmCampaign'];
export const vehicleMetrics: readonly V2VehicleMetric[] = ['detailViews', 'vehicleClicks', 'contactClicks', 'detailContactRate'];
export const rankingMetric = (metric: V2VehicleMetric): AnalyticsReportQuery['metric'] =>
  metric === 'detailContactRate' ? 'contactRate' : metric === 'vehicleClicks' || metric === 'contactClicks' ? metric : 'detailViews';

const dates = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
const times = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' });
const regions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['zh-CN'], { type: 'region', fallback: 'none' }) : null;

export function reportDay(timestamp: string) {
  const parts = dates.formatToParts(new Date(timestamp));
  const date = (name: string) => parts.find(part => part.type === name)?.value;
  return `${date('year')}-${date('month')}-${date('day')}`;
}

export const reportTime = (timestamp: string) => times.format(new Date(timestamp));

type Counts = Pick<AnalyticsReport['totals'], 'pageViews' | 'detailViews' | 'vehicleClicks' | 'contactClicks'>;
type Coverage = AnalyticsReport['coverage'];
const covered = (count: number, coverage: Coverage) => coverage === 'complete' || count > 0 ? count : null;

function counts(row: Counts, coverage: Coverage, sessions?: number): MetricCounts {
  const count = (value: number) => covered(value, coverage);
  return {
    pageViews: count(row.pageViews), detailViews: count(row.detailViews),
    vehicleClicks: count(row.vehicleClicks), contactClicks: count(row.contactClicks),
    sessions: sessions === undefined ? null : covered(sessions, coverage),
  };
}

export function overviewData(report: AnalyticsReport, showDailyComparison: boolean): OverviewData {
  const comparison = report.comparison;
  const todayComparisonMatches = reportDay(comparison.today.start) === reportDay(report.range.start);
  return {
    counts: counts(report.totals, report.coverage, report.sessions),
    comparison: showDailyComparison && todayComparisonMatches ? {
      label: `今日截至 ${reportTime(comparison.today.end)}，昨日 ${reportTime(comparison.yesterday.start)} 至 ${reportTime(comparison.yesterday.end)}（与今日同一时段）`,
      current: counts(comparison.current, comparison.todayCoverage),
      counts: counts(comparison.previous, comparison.yesterdayCoverage),
      comparable: comparison.todayCoverage === 'complete' && comparison.yesterdayCoverage === 'complete',
    } : null,
    interval: report.granularity,
    buckets: report.trend.map(bucket => ({
      start: report.granularity === 'day' ? reportDay(bucket.start) : bucket.start,
      state: ({ complete: 'collected', partial: 'partial', gap: 'interrupted', not_collected: 'not_collected' } as const)[bucket.coverage],
      metrics: counts(bucket, bucket.coverage),
    })),
    dailyIpEstimates: report.dailyUniqueIpEstimates,
    activeSessions: covered(report.activeSessions, report.coverage),
  };
}

const labels: Record<string, string> = {
  unknown: '未知', direct: '直接访问', search: '自然搜索', meta: 'Meta', social: '社交媒体', referral: '外部推荐', paid: '付费推广',
  mobile: '手机', tablet: '平板', desktop: '电脑', zh: '简体中文', en: '英语', ru: '俄语',
  home: '首页', catalog: '车源目录', vehicle: '车辆详情', calculator: '费用计算', parts: '配件', guide: '指南', about: '关于', other: '其他',
  whatsapp: 'WhatsApp', telegram: 'Telegram', wechat: '微信', phone: '电话', email: '电子邮件', form: '表单',
  none: '无登记活动', brand: '品牌推广', retargeting: '再营销',
};

export function marketData(report: AnalyticsReport, dimension: MarketDimension): MarketBreakdown | null {
  const market = report.markets;
  const groups = {
    country: market.countries.map(row => [row.country, row] as const),
    locale: market.languages.map(row => [row.locale, row] as const),
    device: market.devices.map(row => [row.device, row] as const),
    entryPage: market.entries.map(row => [row.entry, row] as const),
    source: market.sources.map(row => [row.source, row] as const),
    channel: market.channels.map(row => [row.channel, row] as const),
    utmCampaign: market.campaigns.map(row => [row.campaign, row] as const),
    utmSource: [], utmMedium: [],
  };
  if (report.coverage === 'not_collected') return null;
  return { rows: groups[dimension].map(([key, row]) => {
    const contactClicks = covered(row.contactClicks, report.coverage);
    const label = dimension === 'country' ? (key === 'ZZ' ? '未知国家或地区' : regions?.of(key) ?? key)
      : dimension === 'utmCampaign' && key === 'catalog' ? '车源目录推广' : labels[key] ?? '未知';
    return {
      key, label, contactClicks,
      sessions: 'sessions' in row ? covered(row.sessions, report.coverage) : null,
      pageViews: 'pageViews' in row ? covered(row.pageViews, report.coverage) : null,
      detailViews: 'detailViews' in row ? covered(row.detailViews, report.coverage) : null,
      detailContactRate: { numerator: null, denominator: null },
    };
  }) };
}

export function vehicleRows(report: AnalyticsReport): V2VehicleRow[] {
  const measuredSessions = report.coverage === 'complete' || report.coverage === 'partial';
  return report.ranking.items.map(row => ({
    vehicleId: row.vehicleId, modelName: row.title, stockCode: row.stockCode, sourceLabel: row.source === 'supplier' ? '第三方车源' : '员工录入',
    cardImpressions: null, whatsappClicks: covered(row.whatsappClicks, report.coverage), telegramClicks: covered(row.telegramClicks, report.coverage),
    vehicleClicks: covered(row.vehicleClicks, report.coverage), detailViews: covered(row.detailViews, report.coverage),
    contactClicks: covered(row.contactClicks, report.coverage),
    detailContactNumerator: measuredSessions || row.detailSessions > 0 ? row.contactAfterDetailSessions : null,
    detailContactDenominator: measuredSessions || row.detailSessions > 0 ? row.detailSessions : null,
  }));
}

export function conversionData(report: AnalyticsReport): ConversionBreakdown | null {
  if (report.coverage === 'not_collected') return null;
  const { catalog, direct } = report.funnels;
  const count = (value: number) => covered(value, report.coverage);
  return {
    catalogFunnel: { catalogSessions: count(catalog.catalog), vehicleClickSessions: count(catalog.vehicleClick),
      detailSessions: count(catalog.detail), contactSessions: count(catalog.contact) },
    directDetail: { detailSessions: count(direct.detail), contactSessions: count(direct.contact) },
    search: { filterSubmissions: count(report.totals.filterSubmits), zeroResults: count(report.totals.searchZeroResults),
      calculatorCompletions: count(report.totals.calculatorCompletions) },
  };
}

export function collectionQuality(report: AnalyticsReport): CollectionQuality {
  const unknown = report.markets.countries.find(row => row.country === 'ZZ');
  const missing = new Map<string, 'not_collected' | 'interrupted' | 'partial'>();
  for (const bucket of report.trend) {
    const date = reportDay(bucket.start);
    if (bucket.coverage === 'complete') continue;
    const state = bucket.coverage === 'gap' ? 'interrupted' : bucket.coverage === 'partial' ? 'partial' : 'not_collected';
    const existing = missing.get(date);
    missing.set(date, existing !== undefined && existing !== state ? 'partial' : state);
  }
  if (report.granularity === 'hour') {
    for (const bucket of report.trend) if (bucket.coverage === 'complete' && missing.has(reportDay(bucket.start))) {
      missing.set(reportDay(bucket.start), 'partial');
    }
  }
  return {
    collectionStartedAt: report.collectionStartedAt,
    lastReceivedAt: null, aggregatedAt: null, latencyMs: null,
    received: covered(report.quality.received, report.coverage), accepted: covered(report.quality.accepted, report.coverage),
    unknownDimension: covered(unknown?.sessions ?? 0, report.coverage),
    deduplicated: covered(report.quality.duplicates, report.coverage),
    rateLimited: report.runtimeQuality.rateLimitedBatches,
    runtimeSince: report.runtimeQuality.since,
    discarded: covered(report.quality.dropped, report.coverage),
    missingDates: [...missing].map(([date, state]) => ({ date, state })),
  };
}
