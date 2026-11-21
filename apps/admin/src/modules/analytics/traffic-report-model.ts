import type { AnalyticsTraffic, AnalyticsTrafficQuery } from '@hd/contracts/analytics';
import type { DateRange } from './analytics-range';
import type { TrafficViewProps } from './traffic-view';
import { reportDay } from './v2-report-model';

type ContactMetric = TrafficViewProps['ranking']['metric'];
const rankingMetrics = { contactClicks: 'total', whatsappClicks: 'whatsapp', telegramClicks: 'telegram' } as const;
const rankBy = { total: 'contactClicks', whatsapp: 'whatsappClicks', telegram: 'telegramClicks' } as const;
const coverageLabels = { not_collected: '未采集', gap: '采集中断', partial: '采集未完整', complete: undefined };

export const trafficPageSize = 20;
type TrafficQueryParams = Pick<AnalyticsTrafficQuery, 'startDate' | 'endDate' | 'granularity' | 'rankBy' | 'include'> & { page: string; pageSize: string };

export function trafficQuery(days: DateRange, metric: ContactMetric, page: number) {
  return { startDate: days.from, endDate: days.to, granularity: days.from === days.to ? 'hour' : 'day',
    rankBy: rankingMetrics[metric], page: String(page), pageSize: String(trafficPageSize),
    include: 'unique-ip-visits' } satisfies TrafficQueryParams;
}

const observed = (value: number, covered: boolean) => covered || value > 0 ? value : null;

function visitsObserved(value: number | null | undefined, coverage: AnalyticsTraffic['trend'][number]['visitCoverage']) {
  if (value === null || value === undefined) return null;
  return coverage === 'complete' || (coverage === 'partial' && value > 0) ? value : null;
}

type ViewData = Omit<TrafficViewProps, 'ranking' | 'trendMetric' | 'onTrendMetricChange'> & {
  ranking: Omit<TrafficViewProps['ranking'], 'onMetricChange' | 'onPageChange'>;
  range: AnalyticsTraffic['range'];
};

export function trafficViewData(data: AnalyticsTraffic): ViewData {
  const contacts = data.quality.contacts;
  const totals = data.totals;
  const visits = data.quality.visits;
  const visitTotal = visitsObserved(totals.uniqueIpVisits, visits?.coverage);
  const visitNotice = visits?.coverage === 'partial' && visitTotal !== null ? '所选期间采集未完整，显示已记录的访问次数。'
    : visitTotal === null && (visits?.coverage === 'gap' || visits?.coverage === 'partial') ? '所选期间缺少访问量采集记录。'
      : null;
  const contactNotice = !contacts.configured ? '联系点击当前未采集，已记录的数据仍可查看。'
    : contacts.coverage === 'not_collected' ? '所选期间未采集联系点击。'
      : contacts.coverage === 'gap' ? '所选期间采集有中断，显示已记录的点击。'
        : contacts.coverage === 'partial' ? '所选期间采集未完整，显示已记录的点击。' : null;

  return {
    range: data.range,
    visitNotice,
    contactNotice,
    contactEmptyLabel: coverageLabels[contacts.coverage] ?? '未采集',
    interval: data.granularity,
    totals: {
      uniqueIpVisits: visitTotal,
      contactClicks: observed(totals.totalContactClicks, contacts.coverage === 'complete'),
      whatsappClicks: observed(totals.whatsappClicks, contacts.coverage === 'complete'),
      telegramClicks: observed(totals.telegramClicks, contacts.coverage === 'complete'),
    },
    trend: data.trend.map(point => {
      const uniqueIpVisits = visitsObserved(point.uniqueIpVisits, point.visitCoverage);
      const visitCoverageLabel = uniqueIpVisits === null
        ? point.visitCoverage === 'gap' ? '未采集（缺报）' : point.visitCoverage === 'partial' ? '未采集（覆盖未完整）' : '未采集'
        : point.visitCoverage === 'partial' ? '采集未完整' : undefined;
      return {
        bucket: data.granularity === 'day' ? reportDay(point.start) : point.start,
        uniqueIpVisits,
        visitCoverageLabel,
        contactClicks: observed(point.totalContactClicks, point.contactCoverage === 'complete'),
        whatsappClicks: observed(point.whatsappClicks, point.contactCoverage === 'complete'),
        telegramClicks: observed(point.telegramClicks, point.contactCoverage === 'complete'),
        contactCoverageLabel: coverageLabels[point.contactCoverage],
      };
    }),
    ranking: {
      metric: rankBy[data.ranking.rankBy], page: data.ranking.page, pageSize: data.ranking.pageSize, total: data.ranking.total,
      rows: data.ranking.items.map(row => ({ vehicleId: row.vehicleId, title: row.title, stockCode: row.stockCode,
        contactClicks: row.totalContactClicks, whatsappClicks: row.whatsappClicks, telegramClicks: row.telegramClicks })),
    },
  };
}
