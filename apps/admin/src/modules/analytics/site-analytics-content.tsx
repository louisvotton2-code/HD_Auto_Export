import { Card, Empty, Select, Statistic, Table, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { AnalyticsOverview } from '@hd/contracts/analytics';
import { AnalyticsTrend } from './analytics-trend';
import styles from './site-analytics.module.css';

const metricLabels = {
  pageViews: '页面浏览（PV）',
  detailViews: '车辆详情浏览',
  vehicleClicks: '车辆卡片点击',
  contactClicks: '主动联系点击',
} as const;
export type AnalyticsMetric = keyof typeof metricLabels;
const metrics = Object.keys(metricLabels) as AnalyticsMetric[];
const metricOptions = metrics.map(key => ({ label: metricLabels[key], value: key }));

type RankedVehicle = AnalyticsOverview['topVehicles'][number];

const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short',
});
const dayFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
const countFormat = new Intl.NumberFormat('zh-CN');

function calendarDay(date: Date) {
  const { year, month, day } = Object.fromEntries(dayFormat.formatToParts(date).map(part => [part.type, part.value]));
  return `${year}-${month}-${day}`;
}

const rankingColumns = [
  { title: '车辆编号', dataIndex: 'vehicleId', width: '40%', render: (id: string) => (
    <Link className={styles.identity} to={id.startsWith('ext-')
      ? `/external-sources/listings/${encodeURIComponent(id)}`
      : `/vehicles/${encodeURIComponent(id)}`}>{id}</Link>
  ) },
  ...(['detailViews', 'vehicleClicks', 'contactClicks'] as const).map(metric => ({
    title: metricLabels[metric], dataIndex: metric, align: 'right' as const, width: '20%',
    sorter: (left: RankedVehicle, right: RankedVehicle) => left[metric] - right[metric],
    render: (count: number) => countFormat.format(count),
  })),
];

export function SiteAnalyticsContent({ data, metric, onMetricChange }: {
  data: AnalyticsOverview;
  metric: AnalyticsMetric;
  onMetricChange: (metric: AnalyticsMetric) => void;
}) {
  const collectedAt = data.collectionStartedAt ? new Date(data.collectionStartedAt) : null;
  const firstDay = collectedAt ? calendarDay(collectedAt) : null;
  const hasCollectedDays = firstDay !== null && data.endDate >= firstDay;
  const shownDays = data.trend.map(row => ({
    day: row.date,
    value: firstDay && row.date < firstDay ? null : row[metric],
  }));

  return <>
    <div className={styles.period}>
      <Typography.Text>统计范围　{data.startDate} 至 {data.endDate}（北京时间）</Typography.Text>
      <Typography.Text type="secondary">采集开始　{collectedAt ? dateTimeFormat.format(collectedAt) : '尚无采集记录'}</Typography.Text>
    </div>
    <section className={styles.counts} aria-label="统计概览">
      {metrics.map(key => <Card key={key} size="small" className={styles.count}>
        <Statistic title={metricLabels[key]} value={data.hasData || hasCollectedDays ? data.totals[key] : '—'} />
      </Card>)}
    </section>
    <Card className={styles.section} title="每日趋势" extra={data.hasData &&
      <Select<AnalyticsMetric> className={styles.metricSelect} size="small" value={metric} onChange={onMetricChange}
        aria-label="趋势指标" options={metricOptions} />}>
      {data.hasData ? <AnalyticsTrend points={shownDays} metric={metricLabels[metric]} />
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={collectedAt ? '此期间暂无访问数据' : '尚无采集数据'} />}
    </Card>
    <Card className={styles.section} title="热门车辆（综合前 20）">
      <Table<RankedVehicle> rowKey="vehicleId" columns={rankingColumns} dataSource={data.topVehicles} size="small"
        scroll={{ x: 560 }} pagination={false} locale={{ emptyText: '此期间暂无车辆数据' }} />
      <Typography.Paragraph className={styles.hint}>主动联系点击表示联系意向。目前官网接入 WhatsApp 和 Telegram。</Typography.Paragraph>
    </Card>
  </>;
}
