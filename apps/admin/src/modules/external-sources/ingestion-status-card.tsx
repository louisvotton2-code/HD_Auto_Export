import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { ExternalIngestionStatusResponseSchema, type ExternalIngestionStatus } from '@hd/contracts/admin';
import { externalRoot } from './external-labels';
import { ResourceContent } from './resource-content';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { formatTime } from '../vehicles/draft-form';
import { IngestionCounts } from './ingestion-counts';

const states: Record<NonNullable<ExternalIngestionStatus['latestJob']>['state'], string> = {
  awaiting_snapshot: '等待来源快照', ready: '准备导入或追平', complete: '一次导入已完成', paused: '已暂停，待处理',
};

export function IngestionStatusCard() {
  const [revision, setRevision] = useState(0);
  const resource = usePrivateResource(`${externalRoot}/ingestion-status`, ExternalIngestionStatusResponseSchema, revision);
  const reload = () => { setRevision(value => value + 1); resource.resume(); };
  const status = resource.data?.data;
  const job = status?.latestJob;
  return <Card title="历史固定名单导入任务" extra={<Button onClick={reload} loading={resource.loading}>刷新正式导入状态</Button>}>
    <ResourceContent {...resource} retry={reload}>{status && <>
      <Space wrap><Tag>固定名单一次导入</Tag><Tag color="gold">持续调度关闭</Tag>{job && <Tag color={job.state === 'complete' ? 'success' : job.state === 'paused' ? 'warning' : undefined}>{states[job.state]}</Tag>}</Space>
      {!job ? <Alert showIcon type="info" title="暂无正式导入任务" description="历史手动样本批次与正式固定名单任务分别记录，不能由样本数推断正式导入数量。" style={{ marginTop: 16 }} /> : <>
        <IngestionCounts items={[
          { key: 'raw', label: '原始来源身份', value: job.rawIdentityCount },
          { key: 'canonical', label: '去重车辆', value: job.canonicalVehicleCount },
          { key: 'public', label: '当前公开车辆', value: job.publicVehicleCount },
        ]} />
        <Typography.Paragraph type="secondary">同一辆车可关联多条来源记录。公开数量是当前公开代表车辆数，不代表三种语言分别完成审核。</Typography.Paragraph>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" items={[
          { key: 'id', label: '任务编号', children: <Typography.Text style={{ overflowWrap: 'anywhere' }}>{job.id}</Typography.Text> },
          { key: 'actor', label: '人工触发员工 ID', children: <Typography.Text style={{ overflowWrap: 'anywhere' }}>{job.triggeredByStaffId}</Typography.Text> },
          { key: 'created', label: '任务创建', children: formatTime(job.createdAt) },
          { key: 'snapshot', label: '来源快照时间', children: formatTime(job.generatedAt) },
          { key: 'completed', label: '完成时间', children: job.completedAt ? formatTime(job.completedAt) : '尚未完成' },
          { key: 'received', label: '已接收增量事件', children: job.receivedEvents.toLocaleString('zh-CN') },
          { key: 'applied', label: '已应用增量事件', children: job.appliedEvents.toLocaleString('zh-CN') },
          { key: 'requests', label: '供应商请求次数', children: job.networkRequests.toLocaleString('zh-CN') },
          { key: 'failures', label: '失败次数', children: job.failures.toLocaleString('zh-CN') },
          { key: 'recovery', label: '恢复次数', children: job.recoveryCount.toLocaleString('zh-CN') },
        ]} />
      </>}
    </>}</ResourceContent>
  </Card>;
}
