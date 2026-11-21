import { Card, Select, Table, Typography, type TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import styles from './site-analytics.module.css';

const metricLabels = {
  cardImpressions: '卡片展示',
  vehicleClicks: '卡片点击',
  detailViews: '详情浏览',
  contactClicks: '联系点击',
  whatsappClicks: 'WhatsApp 点击',
  telegramClicks: 'Telegram 点击',
  detailContactRate: '详情联系率',
} as const;

export type V2VehicleMetric = keyof typeof metricLabels;
type VehicleCountMetric = Exclude<V2VehicleMetric, 'detailContactRate'>;

export type V2VehicleRow = Record<VehicleCountMetric, number | null> & {
  vehicleId: string;
  modelName: string | null;
  stockCode: string | null;
  sourceLabel: string | null;
  detailContactNumerator: number | null;
  detailContactDenominator: number | null;
};

export type V2VehicleViewProps = {
  rows: readonly V2VehicleRow[];
  metric: V2VehicleMetric;
  availableMetrics: readonly V2VehicleMetric[];
  onMetricChange: (metric: V2VehicleMetric) => void;
  page: number;
  pageSize: number;
  total: number | null;
  onPageChange: (page: number) => void;
  loading?: boolean;
  emptyText?: string;
};

const countMetrics: VehicleCountMetric[] = [
  'cardImpressions', 'vehicleClicks', 'detailViews', 'contactClicks', 'whatsappClicks', 'telegramClicks',
];
const countFormat = new Intl.NumberFormat('zh-CN');
const percentFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 });
const { Text } = Typography;

function VehicleIdentity({ vehicleId, modelName, stockCode }: Pick<V2VehicleRow, 'vehicleId' | 'modelName' | 'stockCode'>) {
  const path = vehicleId.startsWith('ext-') ? '/external-sources/listings' : '/vehicles';
  const name = modelName?.trim();
  const code = stockCode?.trim();
  return <div className={styles.identity}>
    <Link to={`${path}/${encodeURIComponent(vehicleId)}`}>{name || code || vehicleId}</Link>
    <div><Text type="secondary">{name ? code || `站内 ID ${vehicleId}` : '车型未识别'}</Text></div>
  </div>;
}

function DetailContactRate({ numerator, denominator, selected }: {
  numerator: number | null;
  denominator: number | null;
  selected: boolean;
}) {
  const count = numerator === null ? '—' : countFormat.format(numerator);
  const base = denominator === null ? '—' : countFormat.format(denominator);
  let value: string;
  if (denominator === null) value = '缺少详情会话数';
  else if (denominator === 0) value = '无可比值';
  else if (numerator === null) value = '缺少联系会话数';
  else {
    const rate = numerator / denominator;
    value = rate > 0 && rate < 0.0001 ? '<0.01%' : percentFormat.format(rate);
  }

  return <>
    <Text strong={selected}>{value}</Text>
    <div><Text type="secondary">{count} / {base}</Text></div>
  </>;
}

export function V2VehicleView({
  rows, metric, availableMetrics, onMetricChange, page, pageSize, total, onPageChange,
  loading, emptyText = '此期间暂无车辆数据',
}: V2VehicleViewProps) {
  const selectedMetric = availableMetrics.includes(metric) ? metric : undefined;
  const columns: TableColumnsType<V2VehicleRow> = [
    { title: '名次', key: 'rank', align: 'right', width: 72, render: (_, __, index) => countFormat.format((page - 1) * pageSize + index + 1) },
    { title: '车源 / 车号', key: 'vehicle', width: 220, render: (_, vehicle) => <VehicleIdentity {...vehicle} /> },
    { title: '来源', dataIndex: 'sourceLabel', width: 112, render: (source: V2VehicleRow['sourceLabel']) => (
      <span className={styles.identity}>{source?.trim() || '来源未知'}</span>
    ) },
    ...countMetrics.map((key): TableColumnsType<V2VehicleRow>[number] => ({
      title: metricLabels[key], dataIndex: key, align: 'right', width: key === 'whatsappClicks' || key === 'telegramClicks' ? 123 : 96,
      onHeaderCell: () => ({ 'aria-sort': key === selectedMetric ? 'descending' : undefined }),
      render: (value: V2VehicleRow[VehicleCountMetric]) => value === null ? <Text type="secondary">未采集</Text>
        : <Text strong={key === selectedMetric}>{countFormat.format(value)}</Text>,
    })),
    {
      title: metricLabels.detailContactRate, key: 'detailContactRate', align: 'right', width: 140,
      onHeaderCell: () => ({ 'aria-sort': selectedMetric === 'detailContactRate' ? 'descending' : undefined }),
      render: (_, row) => <DetailContactRate numerator={row.detailContactNumerator} denominator={row.detailContactDenominator}
        selected={selectedMetric === 'detailContactRate'} />,
    },
  ];

  return <Card className={styles.section} title="车源排行" extra={availableMetrics.length > 0 && (
    <label>排行指标 <Select<V2VehicleMetric> aria-label="车源排行指标" className={styles.metricSelect} size="small" value={selectedMetric}
      placeholder="请选择指标" options={availableMetrics.map(value => ({ value, label: metricLabels[value] }))} onChange={onMetricChange} /></label>
  )}>
    <Table<V2VehicleRow> rowKey="vehicleId" columns={columns} dataSource={rows} size="small" loading={loading} scroll={{ x: 1150 }}
      locale={{ emptyText: loading ? null : emptyText }} pagination={total === null ? false : {
        current: page, pageSize, total, showSizeChanger: false, disabled: loading, onChange: onPageChange,
        showTotal: count => `共 ${countFormat.format(count)} 辆`,
      }} />
    <Typography.Paragraph className={styles.hint}>
      联系点击统计点击联系入口的次数。详情联系率表示浏览该车详情后，同一次浏览中又点击该车联系入口的比例。
    </Typography.Paragraph>
  </Card>;
}
