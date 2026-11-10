import { Alert, Card, Descriptions, Typography } from 'antd';
import { ExternalHttpsUrlSchema } from '@hd/contracts/public';
import { SourceComparison, type SourceComparisonRow } from './source-comparison';
import styles from './external-sources.module.css';

export function SourceRecordDetails({ source, identity, listingUrl, allowListingLink = true, comparisons, conflicts }: {
  source: string;
  identity: string;
  listingUrl: string | null;
  allowListingLink?: boolean;
  comparisons: readonly SourceComparisonRow[];
  conflicts: readonly { key: string; label: string; reason: string }[];
}) {
  const link = ExternalHttpsUrlSchema.safeParse(listingUrl);
  return <div className={styles.stack}>
    <Card title="来源追溯">
      <Descriptions size="small" column={1} items={[
        { key: 'source', label: '来源', children: source },
        { key: 'identity', label: '来源记录编号', children: identity },
        { key: 'link', label: '原始挂牌', children: allowListingLink && link.success
          ? <Typography.Link href={link.data} target="_blank" rel="noopener noreferrer">打开来源挂牌</Typography.Link>
          : listingUrl ? <span className={styles.reason}>未验证来源地址 {listingUrl}</span> : '无可用链接' },
      ]} />
    </Card>
    {conflicts.length > 0 && <Alert showIcon type="warning" title="待核对冲突" description={<ul>
      {conflicts.map(conflict => <li key={conflict.key}>
        <strong>{conflict.label}：</strong><span className={styles.reason}>{conflict.reason}</span>
      </li>)}
    </ul>} />}
    <SourceComparison rows={comparisons} />
  </div>;
}
