import { Card, Empty, Flex, Select, Table, Typography, type TableColumnsType } from 'antd';
import { AnalyticsChart, type AnalyticsChartOption } from './analytics-chart';
import { CountryInferenceSource } from './country-inference-source';
import styles from './site-analytics.module.css';

const dimensionLabels = {
  country: '国家或地区',
  locale: '页面语言',
  device: '设备类型',
  entryPage: '首次打开的页面',
  source: '访问来源',
  channel: '联系渠道',
  utmSource: 'UTM 来源',
  utmMedium: 'UTM 媒介',
  utmCampaign: '推广活动',
} as const;

export type MarketDimension = keyof typeof dimensionLabels;

type MarketRow = {
  key: string;
  label: string;
  sessions: number | null;
  pageViews: number | null;
  detailViews: number | null;
  contactClicks: number | null;
  detailContactRate: { numerator: number | null; denominator: number | null };
};

export type MarketBreakdown = { rows: MarketRow[] };

const allDimensions = Object.keys(dimensionLabels) as MarketDimension[];
const countFormat = new Intl.NumberFormat('zh-CN');
const rateFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 });
const countColumns = [
  { key: 'sessions', label: '浏览过程', width: 96 },
  { key: 'pageViews', label: '页面浏览', width: 108 },
  { key: 'detailViews', label: '车辆详情浏览', width: 106 },
  { key: 'contactClicks', label: '联系点击', width: 106 },
] as const;

function Count({ value }: { value: number | null }) {
  return value === null ? <Typography.Text type="secondary">未提供</Typography.Text> : countFormat.format(value);
}

function DetailContactRate({ numerator, denominator }: MarketRow['detailContactRate']) {
  const rate = numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;
  let label = '未提供';
  if (denominator === 0) label = '无可比值';
  if (rate !== null) label = rate > 0 && rate < 0.0001 ? '<0.01%' : rateFormat.format(rate);
  return <Flex vertical align="end">
    <span>{label}</span>
    {(numerator !== null || denominator !== null) && <Typography.Text type="secondary">
      <Count value={numerator} /> / <Count value={denominator} />
    </Typography.Text>}
  </Flex>;
}

function MarketChart({ rows, dimension }: { rows: readonly MarketRow[]; dimension: MarketDimension }) {
  const metric = dimension === 'channel' || dimension === 'utmCampaign' ? 'contactClicks' : 'sessions';
  const unit = metric === 'contactClicks' ? '联系点击' : '浏览过程次数';
  const measured = rows.flatMap(row => row[metric] === null ? [] : [{ label: row.label, count: row[metric] }]);
  const chartLimit = 6;
  const top = measured.sort((a, b) => b.count - a.count).slice(0, chartLimit);
  if (top.length === 0) return null;
  const title = `按${dimensionLabels[dimension]}的${unit}${measured.length > chartLimit ? '（前 6 项）' : ''}`;
  const option: AnalyticsChartOption = {
    animation: false,
    grid: { left: 116, right: 54, top: 8, bottom: 24 },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, valueFormatter: value => typeof value === 'number' ? countFormat.format(value) : '未采集' },
    xAxis: { type: 'value', minInterval: 1, splitNumber: 4, splitLine: { lineStyle: { color: '#eee6d9' } } },
    yAxis: { type: 'category', inverse: true, data: top.map(row => row.label), axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#473e2d', fontSize: 12, width: 102, overflow: 'truncate' } },
    series: [{ type: 'bar', name: unit, barMaxWidth: 24, data: top.map(row => row.count), itemStyle: { color: '#94671d' },
      label: { show: true, position: 'right', color: '#473e2d', formatter: ({ value }) => typeof value === 'number' ? countFormat.format(value) : '' } }],
  };
  return <div>
    <Typography.Text strong>{title}</Typography.Text>
    <AnalyticsChart label={title} option={option} />
  </div>;
}

export function MarketView({ data, dimension, dimensions = allDimensions, onDimensionChange }: {
  data: MarketBreakdown | null;
  dimension: MarketDimension;
  dimensions?: readonly MarketDimension[];
  onDimensionChange: (dimension: MarketDimension) => void;
}) {
  const marketColumns = dimension === 'channel' || dimension === 'utmCampaign'
    ? countColumns.filter(column => column.key === 'contactClicks' || (dimension === 'utmCampaign' && column.key !== 'sessions'))
    : countColumns;
  const hasRate = data?.rows.some(row => row.detailContactRate.numerator !== null || row.detailContactRate.denominator !== null);
  const columns: TableColumnsType<MarketRow> = [
    {
      title: dimensionLabels[dimension], dataIndex: 'label', rowScope: 'row', width: 155,
      render: (label: string) => <span className={styles.identity}>{label}</span>,
    },
    ...marketColumns.map(({ key, label, width }) => ({
      title: label, dataIndex: key, align: 'right' as const, width,
      render: (value: number | null) => <Count value={value} />,
    })),
    ...(hasRate ? [{
      title: '详情联系率', dataIndex: 'detailContactRate', align: 'right' as const, width: 120,
      render: (rate: MarketRow['detailContactRate']) => <DetailContactRate {...rate} />,
    }] : []),
  ];

  return <Card className={styles.section} title="访问与联系">
    <Flex vertical gap={12}>
      <Flex wrap align="center" gap={8}>
        <Typography.Text>统计维度</Typography.Text>
        <Select<MarketDimension>
          aria-label="统计维度"
          className={styles.metricSelect}
          value={dimension}
          options={dimensions.map(value => ({ label: dimensionLabels[value], value }))}
          onChange={onDimensionChange}
        />
      </Flex>
      {dimension === 'country' && !!data?.rows.length && <CountryInferenceSource />}
      {data ? <>
        <MarketChart rows={data.rows} dimension={dimension} />
        <Table<MarketRow> rowKey="key" columns={columns} dataSource={data.rows} size="small"
          scroll={{ x: columns.reduce((width, column) => width + Number(column.width), 0) }} pagination={false}
          locale={{ emptyText: '所选期间没有此维度的访问或联系记录' }} />
      </>
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选期间暂无可用的市场来源数据" />}
      <Typography.Paragraph className={styles.hint}>
        {hasRate && '详情联系率是浏览详情后又点击联系的浏览过程，占该组所有车辆详情浏览过程的比例。'}
        实际收到的询盘以客服记录为准。
      </Typography.Paragraph>
    </Flex>
  </Card>;
}
