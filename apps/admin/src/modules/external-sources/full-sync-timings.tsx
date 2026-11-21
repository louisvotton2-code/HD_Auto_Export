import { Alert, Button, Descriptions, Space, Table, Typography, type TableColumnsType } from 'antd';
import type { ExternalSyncTimings } from '@hd/contracts/admin';
import { formatTime } from '../vehicles/draft-form';
import styles from './full-sync-status.module.css';

const count = new Intl.NumberFormat('zh-CN');
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const kinds = { new: '新车源', price: '改价', removed: '撤回', relisted: '重挂', unknown: '类型未记录' };
type Metric = ExternalSyncTimings['metrics'][number];

function duration(ms: number | null) {
  if (ms === null) return '无样本';
  return ms >= 60_000 ? `${number.format(ms / 60_000)} 分钟` : `${number.format(ms / 1_000)} 秒`;
}

function withAge(value: string | null, asOf: string, empty: string) {
  if (!value) return empty;
  const age = Date.parse(asOf) - Date.parse(value);
  return age >= 0 ? `${formatTime(value)} · 已过去 ${duration(age)}` : formatTime(value);
}

const columns: TableColumnsType<Metric> = [
  { title: '事件', dataIndex: 'kind', width: 100, render: (kind: Metric['kind']) => kinds[kind] },
  { title: '收到', dataIndex: 'received', align: 'right', width: 85, render: count.format },
  { title: '事件处理结束', dataIndex: 'applied', align: 'right', width: 112, render: count.format },
  { title: '详情已更新', dataIndex: 'detailUpdated', align: 'right', width: 100, render: count.format },
  { title: '公开投影生效', dataIndex: 'publicEffective', align: 'right', width: 112, render: count.format },
  { title: '无公开生效记录', dataIndex: 'incomplete', align: 'right', width: 126, render: count.format },
  { title: '失败', dataIndex: 'failed', align: 'right', width: 85, render: count.format },
  { title: '未见匹配的公开变化', dataIndex: 'notPublic', align: 'right', width: 150, render: count.format },
  { title: '被后续事件替代', dataIndex: 'superseded', align: 'right', width: 122, render: count.format },
  { title: '无公开生效记录的最早收件', key: 'oldest', width: 196, render: (_, row) => row.oldestIncompleteAt ? formatTime(row.oldestIncompleteAt) : '—' },
  { title: '收件到公开投影 P95', key: 'latency', width: 175, render: (_, row) => duration(row.p95ReceivedToPublicMs) },
];

export function FullSyncTimings({ data, loading, error, refresh, disabled }: {
  data: ExternalSyncTimings | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
  disabled: boolean;
}) {
  return <section aria-labelledby="full-sync-latency" className={styles.section}>
    <Typography.Title level={3} id="full-sync-latency" className={styles.sectionTitle}>近 24 小时公开时延</Typography.Title>
    {loading ? <Typography.Text type="secondary">正在读取同步观测…</Typography.Text>
      : error ? <Alert type="warning" showIcon title="同步观测读取失败" description={error}
        action={<Button size="small" onClick={refresh}>重试观测</Button>} />
      : data ? <>
        <Space orientation="vertical" size={4} className={styles.detail}>
          <Typography.Text>{formatTime(data.window.from)} 至 {formatTime(data.window.to)}</Typography.Text>
          <Typography.Text type="secondary">监测自 {formatTime(data.window.instrumentedSince)} 开始。缺少观测证据 {count.format(data.window.uninstrumentedEvents)} 项。</Typography.Text>
        </Space>
        {!data.window.complete && <Alert type="info" showIcon title="监测尚未覆盖完整 24 小时" />}
        <Descriptions column={{ xs: 1, md: 2 }} size="small" items={[
          { key: 'coverage', label: '观测时段', children: `${count.format(data.window.coverage.successfulSlots)} / ${count.format(data.window.coverage.expectedSlots)} 个 ${number.format(data.window.coverage.slotMs / 60_000)} 分钟时段成功` },
          { key: 'coverageGaps', label: '未成功观测', children: `${count.format(data.window.coverage.missingSlots)} 个，其中接收失败 ${count.format(data.window.coverage.failedSlots)} 个` },
          { key: 'coverageEnd', label: '观测截止', children: formatTime(data.window.coverage.through) },
          { key: 'lastReceive', label: '最近接收', children: data.window.lastReceivedAt ? formatTime(data.window.lastReceivedAt) : '尚无记录' },
          ...(!disabled ? [{ key: 'nextReceive', label: '下次接收计划', children: formatTime(data.window.nextReceiveAt) }] : []),
          { key: 'events', label: '待处理事件', children: count.format(data.backlog.pendingEvents) },
          { key: 'oldestEvent', label: '最早积压收件时间', children: withAge(data.backlog.oldestEventAt, data.asOf, data.backlog.pendingEvents ? '时间未记录' : '无待处理事件') },
          { key: 'work', label: '待处理任务', children: count.format(data.backlog.pendingWork) },
          { key: 'oldestWork', label: '最早任务入队记录', children: withAge(data.backlog.oldestWorkAt, data.asOf, data.backlog.pendingWork ? '时间未记录' : '无待处理任务') },
          { key: 'failed', label: '积压中多次失败', children: count.format(data.backlog.failedWork) },
        ]} />
        <Table<Metric> rowKey="kind" columns={columns} dataSource={data.metrics} size="small" pagination={false}
          scroll={{ x: columns.reduce((width, column) => width + Number(column.width), 0) }}
          locale={{ emptyText: data.window.complete ? '期间无同步事件' : '暂无可用事件样本' }} />
        {data.metrics.length > 0 && <details>
          <summary>查看分阶段 P95</summary>
          <Table<Metric> rowKey="kind" size="small" dataSource={data.metrics} pagination={false} scroll={{ x: 560 }} columns={[
            { title: '事件', dataIndex: 'kind', render: (kind: Metric['kind']) => kinds[kind] },
            { title: '供应商事件到本站收件', dataIndex: 'p95SourceToReceivedMs', render: duration },
            { title: '收件到事件处理结束', dataIndex: 'p95ReceivedToAppliedMs', render: duration },
            { title: '事件处理结束到详情更新', dataIndex: 'p95AppliedToDetailMs', render: duration },
          ]} />
        </details>}
        <Typography.Paragraph type="secondary" className={styles.note}>
          事件处理结束包含被跳过和受准入限制的记录。无公开生效记录包含已被替代或没有产生匹配公开变化的事件。
          历史任务的入队时间可能从监测启用时开始记录。公开生效以数据库的公开投影为准，公网传播和缓存时延需与线上采样核对。
        </Typography.Paragraph>
      </> : <Typography.Paragraph type="secondary" className={styles.detail}>暂无从收件到公开生效的监测数据。</Typography.Paragraph>}
  </section>;
}
