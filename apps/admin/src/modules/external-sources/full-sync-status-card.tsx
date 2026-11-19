import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { ExternalFullSyncStatusResponseSchema, type ExternalFullSyncStatus, type StaffMe } from '@hd/contracts/admin';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { formatTime } from '../vehicles/draft-form';
import { externalRoot } from './external-labels';
import { FullSyncControls } from './full-sync-controls';
import { IngestionCounts } from './ingestion-counts';
import { ResourceContent } from './resource-content';
import styles from './full-sync-status.module.css';

const states: Record<ExternalFullSyncStatus['state'], string> = {
  disabled: '正式同步未启用', idle: '等待下次同步', snapshot: '接收与校验来源快照', syncing: '正在同步与补齐',
  paused: '重任务已暂停', error: '同步发生错误', complete: '当前同步阶段完成',
};

export function FullSyncStatusCard() {
  const staff = useOutletContext<StaffMe>();
  const [revision, setRevision] = useState(0);
  const [controlBusy, setControlBusy] = useState(false);
  const resource = usePrivateResource(`${externalRoot}/sync-status`, ExternalFullSyncStatusResponseSchema, revision);
  const status = resource.data?.data;
  const reload = () => { setRevision(value => value + 1); resource.resume(); };
  return <Card className={styles.card} title="全量与持续同步" extra={<Button disabled={controlBusy} loading={resource.loading} onClick={reload}>刷新同步进度</Button>}>
    <ResourceContent {...resource} failureTitle="同步进度读取失败" retry={reload}>{status && <>
      <Space wrap><Tag>{status.mode === 'continuous' ? '正式持续同步' : '正式全量同步'}</Tag>
        <Tag color={status.state === 'error' ? 'error' : status.state === 'complete' ? 'success' : undefined}>{states[status.state]}</Tag>
        <Tag color={status.paused ? 'warning' : undefined}>{status.paused ? '重任务暂停中' : '重任务未暂停'}</Tag>
      </Space>
      <Descriptions column={{ xs: 1, md: 2 }} size="small" className={styles.overview} items={[
        { key: 'lastSuccess', label: '最后成功同步', children: status.lastSuccessAt ? <time dateTime={status.lastSuccessAt}>{formatTime(status.lastSuccessAt)}</time> : '尚无成功记录' },
        { key: 'asOf', label: '数据时点', children: formatTime(status.asOf) },
      ]} />
      {status.lastError && <Alert type="error" showIcon title={`最近错误：${status.lastError.code || '未分类错误'}`} description={<div className={styles.long}>{status.lastError.message}<div>{formatTime(status.lastError.at)}</div></div>} />}
      <section aria-labelledby="full-sync-initial" className={styles.section}>
        <Typography.Title level={3} id="full-sync-initial" className={styles.sectionTitle}>首次入库与全量快照</Typography.Title>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" items={[
          { key: 'initial', label: '首次入库进度', children: '暂无独立记录' },
          { key: 'snapshot', label: '最新来源快照', children: status.snapshot
            ? <span className={styles.long}>{status.snapshot.id} · {status.snapshot.complete ? '快照处理完成' : '快照处理尚未完成'}</span>
            : '暂无快照' },
          ...(status.snapshot ? [
            { key: 'generated', label: '快照生成时间', children: formatTime(status.snapshot.generatedAt) },
            { key: 'rows', label: '快照行数', children: status.snapshot.complete || status.snapshot.rows > 0
              ? status.snapshot.rows.toLocaleString('zh-CN') : '待核定' },
            { key: 'staged', label: '已暂存行数', children: status.snapshot.staged.toLocaleString('zh-CN') },
          ] : []),
        ]} />
        <IngestionCounts items={[
          { key: 'raw', label: '同步已登记来源记录', value: status.counts.raw },
          { key: 'canonical', label: '去重车辆', value: status.counts.canonical },
          { key: 'public', label: '当前公开车辆', value: status.counts.public },
        ]} />
        <Typography.Paragraph type="secondary" className={styles.note}>一辆车可关联多条来源记录。公开车辆的详情、语言或报告仍可能待补齐。</Typography.Paragraph>
      </section>
      <section aria-labelledby="full-sync-delta" className={styles.section}>
        <Typography.Title level={3} id="full-sync-delta" className={styles.sectionTitle}>增量同步</Typography.Title>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" items={[
          { key: 'received', label: '已接收事件', children: status.receivedEvents.toLocaleString('zh-CN') },
          { key: 'applied', label: '已处理事件', children: status.appliedEvents.toLocaleString('zh-CN') },
          { key: 'next', label: '下次增量计划时间', children: status.nextRunAt ? formatTime(status.nextRunAt) : '暂无计划时点' },
        ]} />
      </section>
      <section aria-labelledby="full-sync-changes" className={styles.section}>
        <Typography.Title level={3} id="full-sync-changes" className={styles.sectionTitle}>撤回与改价</Typography.Title>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" items={[
          { key: 'withdrawn', label: '当前已撤回来源记录', children: status.counts.withdrawn.toLocaleString('zh-CN') },
          { key: 'price', label: '改价事件', children: '暂无独立统计' },
        ]} />
      </section>
      <section aria-labelledby="full-sync-pending" className={styles.section}>
        <Typography.Title level={3} id="full-sync-pending" className={styles.sectionTitle}>待补齐资料</Typography.Title>
        <IngestionCounts items={[
          { key: 'details', label: '待补详情', value: status.counts.pendingDetails },
          { key: 'locales', label: '待补语言项', value: status.counts.pendingLocales },
          { key: 'reports', label: '待补报告', value: status.counts.pendingReports },
          { key: 'failed', label: '失败记录', value: status.counts.failed },
        ]} />
        <Typography.Paragraph type="secondary" className={styles.note}>这些分类可能重叠，且统计单位不同。</Typography.Paragraph>
      </section>
    </>}</ResourceContent>
    {/* Keep original intent alive across safe reads, errors and same-account reauthentication. */}
    {staff.role === 'admin' && <FullSyncControls status={status ?? null} disabled={resource.loading || !!resource.error} onRefresh={reload} onBusyChange={setControlBusy} />}
  </Card>;
}
