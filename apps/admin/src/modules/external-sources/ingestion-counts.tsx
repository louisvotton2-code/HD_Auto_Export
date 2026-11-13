import { Statistic, Typography } from 'antd';
import styles from './external-sources.module.css';

/** Presentation values supplied by the caller's validated server response; no inferred totals. */
type CountItem = { key: string; label: string; value: number | null; hint?: string };

export function IngestionCounts({ items }: { items: readonly CountItem[] }) {
  return <div className={styles.stats} style={{ marginTop: 16 }} aria-label="正式导入数量">
    {items.map(item => <div key={item.key}>
      <Statistic title={item.label} value={item.value ?? '—'} />
      {item.hint && <Typography.Text type="secondary">{item.hint}</Typography.Text>}
    </div>)}
  </div>;
}
