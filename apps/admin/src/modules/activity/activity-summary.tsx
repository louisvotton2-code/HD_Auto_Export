import type { AdminActivitySummary } from '@hd/contracts/admin';
import { activityActor, activityTime } from './activity-labels';
import styles from './activity.module.css';

export function ActivitySummary({ activity, external = false, showCreated = true }: { activity?: AdminActivitySummary; external?: boolean; showCreated?: boolean }) {
  const entry = (value: AdminActivitySummary['created']) => value
    ? <><span>{activityActor(value.actor)}</span><time dateTime={value.at} title={value.at}>{activityTime(value.at)}</time></>
    : <span>未知（历史未记录）</span>;
  return <dl className={styles.summary} aria-label="员工与系统操作摘要">
    {showCreated && <div><dt>创建</dt><dd>{entry(activity?.created ?? null)}</dd></div>}
    {external && <div><dt>首次系统导入</dt><dd>{activity?.firstImported
      ? <><time dateTime={activity.firstImported.at} title={activity.firstImported.at}>{activityTime(activity.firstImported.at)}</time><span>批次：{activity.firstImported.batchId ?? '未记录'}</span></>
      : '未知（历史未记录）'}</dd></div>}
    <div><dt>最近人工修改</dt><dd>{entry(activity?.lastModified ?? null)}</dd></div>
    {external && <div><dt>最近系统同步</dt><dd>{activity?.lastSyncedAt
      ? <time dateTime={activity.lastSyncedAt} title={activity.lastSyncedAt}>{activityTime(activity.lastSyncedAt)}</time>
      : '未知（历史未记录）'}</dd></div>}
  </dl>;
}
