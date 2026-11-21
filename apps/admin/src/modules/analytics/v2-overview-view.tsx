import { Card, Descriptions, Empty, Select, Statistic, Typography } from 'antd';
import { AnalyticsTrend } from './analytics-trend';
import { CountryInferenceSource } from './country-inference-source';
import styles from './site-analytics.module.css';

export const overviewMetrics = {
  pageViews: '页面浏览（PV）',
  detailViews: '车辆详情浏览',
  vehicleClicks: '车辆卡片点击',
  contactClicks: '主动联系点击',
  sessions: '匿名会话',
} as const;

export type OverviewMetric = keyof typeof overviewMetrics;
export type MetricCounts = Record<OverviewMetric, number | null>;
type CollectionState = 'collected' | 'not_collected' | 'interrupted' | 'partial';
type Bucket = { start: string; label?: string; state: CollectionState; metrics: MetricCounts };

export type OverviewData = {
  counts: MetricCounts;
  comparison: { label: string; current: MetricCounts; counts: MetricCounts; comparable: boolean } | null;
  interval: 'day' | 'hour';
  buckets: Bucket[];
  dailyIpEstimates: { date: string; estimate: number | null }[];
  activeSessions: number | null;
};

const formatter = new Intl.NumberFormat('zh-CN');
const percentage = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const time = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' });
const hourLabel = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' });

function comparisonText(value: number | null, previous: number | null) {
  if (value === null || previous === null) return '缺少可比数据';
  if (previous === 0) return `上期 ${formatter.format(previous)} · 无可比比例`;
  return `上期 ${formatter.format(previous)} · ${percentage.format((value - previous) / previous)}`;
}

export function OverviewView({ data, metric, onMetricChange }: {
  data: OverviewData;
  metric: OverviewMetric;
  onMetricChange: (metric: OverviewMetric) => void;
}) {
  const metrics = Object.keys(overviewMetrics) as OverviewMetric[];
  const trendMetrics = metrics.filter(key => key !== 'sessions');
  const points = data.buckets.map(bucket => ({
    day: bucket.start,
    label: bucket.label ?? (data.interval === 'hour' ? hourLabel.format(new Date(bucket.start)) : undefined),
    value: bucket.metrics[metric],
    missingLabel: bucket.state === 'interrupted' ? '采集停顿' : bucket.state === 'partial' ? '采集不完整' : '未采集',
  }));

  return <>
    {data.comparison && <Typography.Text type="secondary">对比范围　{data.comparison.label}</Typography.Text>}
    <section className={styles.counts} aria-label="统计概览">
      {metrics.map(key => <Card key={key} size="small" className={styles.count}>
        <Statistic title={overviewMetrics[key]} value={data.counts[key] ?? '—'} />
        {data.comparison && key !== 'sessions' && <Typography.Text type="secondary">{data.comparison.comparable
          ? comparisonText(data.comparison.current[key], data.comparison.counts[key]) : '缺少完整同期数据'}</Typography.Text>}
      </Card>)}
    </section>
    <Card className={styles.section} title={data.interval === 'hour' ? '逐小时趋势' : '每日趋势'} extra={points.length > 0 &&
      <Select<OverviewMetric> className={styles.metricSelect} size="small" value={metric} aria-label="趋势指标"
        onChange={onMetricChange} options={trendMetrics.map(key => ({ label: overviewMetrics[key], value: key }))} />}>
      {points.length > 0 ? <AnalyticsTrend points={points} metric={overviewMetrics[metric]} interval={data.interval} />
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此期间暂无可用趋势" />}
    </Card>
    {data.activeSessions !== null && <Typography.Text type="secondary">仍在进行的会话　{formatter.format(data.activeSessions)}</Typography.Text>}
    {data.dailyIpEstimates.some(day => day.estimate !== null) && <Card size="small" className={styles.section} title="每日独立 IP 估算">
      <Typography.Text type="secondary">按北京时间逐日估算。同一访客可能使用多个 IP，多日不合计。</Typography.Text>
      {data.dailyIpEstimates.length === 1
        ? <Statistic value={data.dailyIpEstimates[0]!.estimate ?? '—'} />
        : <details className={styles.daily}>
          <summary>查看逐日估算</summary>
          <dl>{data.dailyIpEstimates.map(day => <div key={day.date}>
            <dt><time dateTime={day.date}>{day.date}</time></dt><dd>{formatCount(day.estimate)}</dd>
          </div>)}</dl>
        </details>}
    </Card>}
  </>;
}

export type CollectionQuality = {
  collectionStartedAt: string | null;
  lastReceivedAt: string | null;
  aggregatedAt: string | null;
  latencyMs: number | null;
  received: number | null;
  accepted: number | null;
  deduplicated: number | null;
  rateLimited: number | null;
  runtimeSince: string | null;
  discarded: number | null;
  unknownDimension: number | null;
  missingDates: { date: string; state: Exclude<CollectionState, 'collected'> }[];
};

const formatTime = (value: string | null) => value ? time.format(new Date(value)) : '未记录';
const formatCount = (value: number | null) => value === null ? '未采集' : formatter.format(value);

export function AnalyticsCollectionQuality({ quality }: { quality: CollectionQuality | null }) {
  return <Card className={styles.section} title="采集质量" size="small">
    {quality ? <>
      <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small" items={[
        { key: 'started', label: '采集开始', children: formatTime(quality.collectionStartedAt) },
        { key: 'received', label: '最新收到', children: formatTime(quality.lastReceivedAt) },
        { key: 'aggregated', label: '最近汇总', children: formatTime(quality.aggregatedAt) },
        { key: 'latency', label: '汇总时延', children: quality.latencyMs === null ? '未记录' : `${formatter.format(quality.latencyMs)} ms` },
        { key: 'ingested', label: '收到事件', children: formatCount(quality.received) },
        { key: 'accepted', label: '接受事件', children: formatCount(quality.accepted) },
        { key: 'duplicates', label: '去重', children: formatCount(quality.deduplicated) },
        { key: 'rateLimited', label: '当前进程限流批次', children: formatCount(quality.rateLimited) },
        { key: 'discarded', label: '丢弃', children: formatCount(quality.discarded) },
        { key: 'unknown', label: '国家未知的会话', children: formatCount(quality.unknownDimension) },
      ]} />
      {quality.unknownDimension !== null && <CountryInferenceSource />}
      {quality.runtimeSince && <Typography.Text type="secondary">限流批次自进程启动计数（{formatTime(quality.runtimeSince)} 起）。</Typography.Text>}
      {quality.missingDates.length > 0 && <details className={styles.daily}>
        <summary>缺失日期（{formatter.format(quality.missingDates.length)} 天）</summary>
        <dl>{quality.missingDates.map(({ date, state }) => <div key={date}>
          <dt><time dateTime={date}>{date}</time></dt><dd>{state === 'interrupted' ? '采集停顿' : state === 'partial' ? '采集不完整' : '未采集'}</dd>
        </div>)}</dl>
      </details>}
    </> : <Typography.Text type="secondary">所选范围暂无采集质量记录。</Typography.Text>}
  </Card>;
}
