import styles from './activity-difference.module.css';

/** Presentation only: callers supply labels and values derived from the authoritative activity DTO. */
export function ActivityDifference({ field, before, after }: { field: string; before: string; after: string }) {
  return <section className={styles.change} aria-label={`${field}的变更`}>
    <div className={styles.field}>{field}</div>
    <dl className={styles.values}>
      <div><dt>变更前</dt><dd><pre>{before}</pre></dd></div>
      <div><dt>变更后</dt><dd><pre>{after}</pre></dd></div>
    </dl>
  </section>;
}
