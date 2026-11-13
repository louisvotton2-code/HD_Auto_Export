import type { AdminActivitySummary } from '@hd/contracts/admin';
import { Tooltip } from 'antd';
import { activityActor, activityTime } from './activity-labels';
import styles from './activity.module.css';

const compactTimeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function ActivityTimestamp({ at, compact = false }: { at: string; compact?: boolean }) {
  const formatted = activityTime(at);
  const full = `${formatted} · UTC：${at}`;
  const text = compact ? compactTimeFormat.format(new Date(at)) : formatted;
  return <time dateTime={at} title={full} aria-label={full}>{text}</time>;
}

export function ActivitySummary({ activity, external = false, showCreated = true, compact = false }: { activity?: AdminActivitySummary; external?: boolean; showCreated?: boolean; compact?: boolean }) {
  function entry(value: AdminActivitySummary['created']) {
    if (!value) return <span>未知（历史未记录）</span>;
    const actor = activityActor(value.actor);
    if (!compact) return <><span>{actor}</span><ActivityTimestamp at={value.at} /></>;
    const fullTime = activityTime(value.at);
    return <Tooltip trigger={['hover', 'focus']} title={<>{actor}<br />{fullTime}<br />UTC：{value.at}</>}>
      <span className={styles.compactEntry} tabIndex={0} aria-label={`${actor}，${fullTime}，UTC：${value.at}`}>
        <span>{value.actor.kind === 'staff' ? value.actor.name?.trim() || '员工姓名未记录' : actor}</span>
        <ActivityTimestamp at={value.at} compact />
      </span>
    </Tooltip>;
  }
  return <dl className={`${styles.summary}${compact ? ` ${styles.compact}` : ''}`} aria-label="员工与系统操作摘要">
    {showCreated && <div><dt>创建</dt><dd>{entry(activity?.created ?? null)}</dd></div>}
    {external && <div><dt>首次系统导入</dt><dd>{activity?.firstImported
      ? <><ActivityTimestamp at={activity.firstImported.at} compact={compact} /><span>批次：{activity.firstImported.batchId ?? '未记录'}</span></>
      : '未知（历史未记录）'}</dd></div>}
    <div><dt>最近人工修改</dt><dd>{entry(activity?.lastModified ?? null)}</dd></div>
    {external && <div><dt>最近系统同步</dt><dd>{activity?.lastSyncedAt
      ? <ActivityTimestamp at={activity.lastSyncedAt} compact={compact} />
      : '未知（历史未记录）'}</dd></div>}
  </dl>;
}
