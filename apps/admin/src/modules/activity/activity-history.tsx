import { useState } from 'react';
import { Alert, Button, Collapse, Drawer, Empty, Space, Spin, Tag } from 'antd';
import { ActivityResponseSchema, type ActivityEvent } from '@hd/contracts/admin';
import { ActivityDifference } from './activity-difference';
import { activityAction, activityActor, activityField, activityTime } from './activity-labels';
import { formatActivityValue } from './activity-value';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import styles from './activity.module.css';

export type ActivityTarget = { kind: 'vehicle' | 'external'; id: string; label: string };

function EventDetails({ event }: { event: ActivityEvent }) {
  if (event.detailState === 'unknown') return <Alert type="info" showIcon title="历史差异未知" description="此记录没有可靠的字段前后值，不能还原为当时的完整资料。" />;
  if (!event.changes?.length) return <p>此操作已记录，没有字段差异。</p>;
  return <div className={styles.differences}>{event.changes.map((change, index) => <ActivityDifference key={`${change.path}:${index}`}
    field={activityField(change.path)} before={formatActivityValue(change.before, change.beforePresent)} after={formatActivityValue(change.after, change.afterPresent)} />)}</div>;
}

function HistoryContent({ target }: { target: ActivityTarget }) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [revision, setRevision] = useState(0);
  const cursor = cursors.at(-1);
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const root = target.kind === 'vehicle' ? '/api/v1/admin/vehicles' : '/api/v1/admin/external/listings';
  const resource = usePrivateResource(`${root}/${encodeURIComponent(target.id)}/activity?${query}`, ActivityResponseSchema, revision);
  function refresh() { setCursors([null]); setRevision(value => value + 1); resource.resume(); }
  return <div className={styles.history}>
    <p className={styles.identity}>{target.label}<br />档案 ID：{target.id}</p>
    <p>只读记录。姓名保留操作时的快照，系统同步与人工修改分别记录。</p>
    <Space wrap><Button onClick={refresh} loading={resource.loading}>刷新操作记录</Button><span>第 {cursors.length} 页 · 每页最多 20 条</span></Space>
    {resource.loading ? <Spin tip="读取操作记录"><div className={styles.loading} /></Spin>
      : resource.error ? <Alert showIcon type="error" title="操作记录未能读取" description={resource.error} action={<Button onClick={refresh}>重新读取</Button>} />
      : resource.data && (resource.data.data.items.length ? <Collapse key={JSON.stringify([cursor, revision])} items={resource.data.data.items.map(event => ({
        key: event.id,
        label: <div className={styles.eventHeading} data-testid={`activity-event-${event.id}`}><strong>{activityAction(event.action)}</strong><span>{activityActor(event.actor)}</span>
          <time dateTime={event.at}>{activityTime(event.at)}</time><span className={styles.utc}>UTC：{event.at}</span>
          <span><Tag>版本 {event.oldVersion ?? '未记录'} → {event.newVersion ?? '未记录'}</Tag></span></div>,
        children: <EventDetails event={event} />,
      }))} /> : <Empty description="暂无可读取的操作记录；这不代表过去没有操作。" />)}
    <Space wrap className={styles.pagination}>
      <Button disabled={resource.loading || cursors.length <= 1} onClick={() => setCursors(values => values.slice(0, -1))}>上一页记录</Button>
      <Button disabled={resource.loading || !resource.data?.data.nextCursor} onClick={() => { if (resource.data?.data.nextCursor) setCursors(values => [...values, resource.data!.data.nextCursor]); }}>下一页记录</Button>
    </Space>
  </div>;
}

export function ActivityHistory({ target, onClose }: { target: ActivityTarget | null; onClose: () => void }) {
  return <Drawer title="车辆操作记录" open={target !== null} onClose={onClose} size="large" className={styles.drawer}>
    {target && <HistoryContent key={`${target.kind}:${target.id}`} target={target} />}
  </Drawer>;
}
