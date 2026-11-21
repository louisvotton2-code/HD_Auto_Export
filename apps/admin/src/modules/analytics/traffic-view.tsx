import { Card, Empty, Select, Statistic, Table, Typography, type TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import { AnalyticsChart, type AnalyticsChartOption } from './analytics-chart';
import { AnalyticsTrend } from './analytics-trend';
import sectionStyles from './site-analytics.module.css';
import styles from './traffic-view.module.css';

type ContactMetric = 'contactClicks' | 'whatsappClicks' | 'telegramClicks';
export type TrafficMetric = 'uniqueIpVisits' | ContactMetric;
type TrafficCounts = Record<TrafficMetric, number | null>;
type TrafficBucket = TrafficCounts & { bucket: string; visitCoverageLabel?: string; contactCoverageLabel?: string };
type TrafficVehicle = Record<ContactMetric, number> & { vehicleId: string; title: string | null; stockCode: string | null };

export type TrafficViewProps = {
  totals: TrafficCounts;
  trend: readonly TrafficBucket[];
  interval: 'day' | 'hour';
  trendMetric: TrafficMetric;
  onTrendMetricChange: (metric: TrafficMetric) => void;
  visitNotice: string | null;
  contactNotice: string | null;
  contactEmptyLabel: string;
  ranking: {
    rows: readonly TrafficVehicle[];
    metric: ContactMetric;
    page: number;
    pageSize: number;
    total: number;
    onMetricChange: (metric: ContactMetric) => void;
    onPageChange: (page: number) => void;
  };
};

const metricLabels: Record<TrafficMetric, string> = {
  uniqueIpVisits: '官网访问量',
  contactClicks: '联系点击总数',
  whatsappClicks: 'WhatsApp 点击',
  telegramClicks: 'Telegram 点击',
};
const contactMetrics: readonly ContactMetric[] = ['contactClicks', 'whatsappClicks', 'telegramClicks'];
const contactOptions = contactMetrics.map(value => ({ value, label: metricLabels[value] }));
const trendOptions = (['uniqueIpVisits', ...contactMetrics] as const)
  .map(value => ({ value, label: metricLabels[value] }));
const countFormat = new Intl.NumberFormat('zh-CN');
const hourFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai',
});

function VehicleIdentity({ vehicleId, title, stockCode }: TrafficVehicle) {
  const path = vehicleId.startsWith('ext-') ? '/external-sources/listings' : '/vehicles';
  const name = title?.trim();
  const code = stockCode?.trim();
  return <div className={sectionStyles.identity}>
    <Link to={`${path}/${encodeURIComponent(vehicleId)}`}>{name || code || vehicleId}</Link>
    <div><Typography.Text type="secondary">{name ? code || `站内 ID ${vehicleId}` : '车型未识别'}</Typography.Text></div>
  </div>;
}

function TrafficRanking({ ranking, uncollected }: { ranking: TrafficViewProps['ranking']; uncollected: boolean }) {
  const { rows, metric, page, pageSize, total, onMetricChange, onPageChange } = ranking;
  const columns: TableColumnsType<TrafficVehicle> = [
    { title: '名次', key: 'rank', width: 60, align: 'right', render: (_, __, index) => countFormat.format((page - 1) * pageSize + index + 1) },
    { title: '车源 / 车号', key: 'vehicle', width: 190, render: (_, vehicle) => <VehicleIdentity {...vehicle} /> },
    ...contactMetrics.map((value): TableColumnsType<TrafficVehicle>[number] => ({
      title: value === 'contactClicks' ? '联系点击' : metricLabels[value],
      dataIndex: value,
      width: 125,
      align: 'right',
      onHeaderCell: () => ({ 'aria-sort': value === metric ? 'descending' : undefined }),
      render: (count: number) => <Typography.Text strong={value === metric}>{countFormat.format(count)}</Typography.Text>,
    })),
  ];
  return <Card className={`${sectionStyles.section} ${styles.ranking}`} title="热门车辆" extra={
    <Select<ContactMetric> aria-label="车源排行指标" className={sectionStyles.metricSelect} size="small" value={metric}
      options={contactOptions} onChange={onMetricChange} />
  }>
    <Table<TrafficVehicle> columns={columns} dataSource={rows} rowKey="vehicleId" size="small"
      scroll={{ x: 625 }} locale={{ emptyText: uncollected ? '所选期间未采集此项车辆联系数据' : '所选期间暂无车辆联系点击' }}
      pagination={{ current: page, pageSize, total, onChange: onPageChange, showSizeChanger: false,
        showTotal: count => `共 ${countFormat.format(count)} 辆` }} />
  </Card>;
}

function ContactChannels({ totals, emptyLabel }: { totals: TrafficCounts; emptyLabel: string }) {
  const channels = [
    { name: 'WhatsApp', value: totals.whatsappClicks, itemStyle: { color: '#228369' } },
    { name: 'Telegram', value: totals.telegramClicks, itemStyle: { color: '#347a9f' } },
  ];
  const hasClicks = channels.some(channel => (channel.value ?? 0) > 0);
  const pieData = channels.flatMap(({ value, ...channel }) => value === null ? [] : [{ ...channel, value }]);
  const complete = pieData.length === channels.length;
  const option: AnalyticsChartOption = complete ? {
    animation: false,
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, formatter: '{b}：{c} 次' },
    series: [{ type: 'pie', radius: ['54%', '81%'], center: ['50%', '50%'],
      label: { show: false }, labelLine: { show: false }, data: pieData }],
  } : {
    animation: false,
    grid: { left: 82, right: 24, top: 24, bottom: 26 },
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#ede8dd' } } },
    yAxis: { type: 'category', inverse: true, data: channels.map(channel => channel.name), axisTick: { show: false } },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, formatter: '{b}：{c} 次' },
    series: [{ type: 'bar', barMaxWidth: 22, data: channels.map(channel => ({ value: channel.value, itemStyle: channel.itemStyle })) }],
  };

  return <Card className={`${sectionStyles.section} ${styles.channelCard}`} title="联系渠道">
    {hasClicks ? <AnalyticsChart label="联系渠道对比" option={option} />
      : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={complete ? '所选期间没有联系点击' : '所选期间暂无可用的渠道数据'} />}
    <dl className={styles.channelCounts}>{channels.map(channel => <div key={channel.name}>
      <dt><span style={{ backgroundColor: channel.itemStyle.color }} aria-hidden="true" />{channel.name}</dt>
      <dd>{channel.value === null ? emptyLabel : `${countFormat.format(channel.value)} 次`}</dd>
    </div>)}</dl>
  </Card>;
}

export function TrafficView({ totals, trend, interval, trendMetric, onTrendMetricChange, visitNotice, contactNotice, ranking,
  contactEmptyLabel }: TrafficViewProps) {
  const points = trend.map(point => ({
    day: point.bucket,
    label: interval === 'hour' ? hourFormat.format(new Date(point.bucket)) : undefined,
    value: point[trendMetric],
    coverageLabel: trendMetric === 'uniqueIpVisits' ? point.visitCoverageLabel : point.contactCoverageLabel,
  }));

  return <div className={styles.view}>
    <div className={styles.metrics}>
      <section aria-label="官网访问量概览">
        <Card className={`${sectionStyles.count} ${styles.visits}`} size="small">
          <Statistic title={metricLabels.uniqueIpVisits} value={totals.uniqueIpVisits ?? '未采集'} />
          <Typography.Text type="secondary">同一 IP 自上次计入起满 60 分钟后可再计一次，跨页面和语言合并。单位为访问次数。</Typography.Text>
          {visitNotice && <Typography.Text type="secondary" className={styles.visitNotice}>{visitNotice}</Typography.Text>}
        </Card>
      </section>
      <section className={styles.contactTotals} aria-label="联系点击概览">
        {contactMetrics.map(value => <Card key={value} className={sectionStyles.count} size="small">
          <Statistic title={metricLabels[value]} value={totals[value] ?? contactEmptyLabel} />
        </Card>)}
      </section>
    </div>
    <Typography.Paragraph className={`${sectionStyles.hint} ${styles.channelHint}`}>
      联系点击记录访客点击 WhatsApp 或 Telegram 入口的次数。收到的询盘由客服确认。
      {contactNotice && <><br />{contactNotice}</>}
    </Typography.Paragraph>

    <Card className={`${sectionStyles.section} ${styles.trendCard}`} title="访问和联系趋势" extra={
      <Select<TrafficMetric> aria-label="趋势指标" className={sectionStyles.metricSelect} size="small" value={trendMetric}
        options={trendOptions} onChange={onTrendMetricChange} />
    }>
      {points.length ? <AnalyticsTrend points={points} metric={metricLabels[trendMetric]} interval={interval} />
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选期间暂无可用趋势" />}
    </Card>

    <ContactChannels totals={totals} emptyLabel={contactEmptyLabel} />
    <TrafficRanking ranking={ranking} uncollected={totals[ranking.metric] === null} />
  </div>;
}
