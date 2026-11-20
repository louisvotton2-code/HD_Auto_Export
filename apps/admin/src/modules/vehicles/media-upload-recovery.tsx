import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import { MediaAssetSchema, RequestMetaSchema, type MediaAsset } from '@hd/contracts/admin';
import { formatTime } from './draft-form';
import { MAX_MEDIA_COUNT } from './media-upload';
import styles from './media-editor.module.css';

const uploadItemsSchema = MediaAssetSchema.array();

export const recoverableUploadsResponse = {
  parse(response: unknown) {
    if (!response || typeof response !== 'object' || !('data' in response) || !('meta' in response)) {
      throw new Error('Expected an upload list response');
    }
    const { data, meta } = response;
    if (!data || typeof data !== 'object' || !('items' in data) || !('used' in data) || !('limit' in data)
      || typeof data.used !== 'number' || !Number.isSafeInteger(data.used) || data.used < 0 || data.limit !== MAX_MEDIA_COUNT) {
      throw new Error('Invalid upload quota');
    }
    return { data: { items: uploadItemsSchema.parse(data.items), used: data.used, limit: data.limit }, meta: RequestMetaSchema.parse(meta) };
  },
};

const statusText = { pending: '待上传文件', uploaded: '已上传，待处理', ready: '已处理，待加入草稿', failed: '处理失败', deleted: '已回收' };

export function MediaUploadRecovery({ items, disabled, onRestore, onRecycle }: {
  items: MediaAsset[];
  disabled: boolean;
  onRestore: (asset: MediaAsset) => void;
  onRecycle: (id: string) => void;
}) {
  return <Card size="small" title="待处理上传任务" className={styles.tasksCollapse}>
    <Alert className={styles.recoveryHint} type="info" showIcon title="回收不需要的任务可释放图片名额。未上传的文件请回收后重新选择。" />
    <ul className={`${styles.tasks} ${styles.recoveryList}`} aria-label="待处理上传任务">{items.map(asset => <li key={asset.id}>
      <div className={styles.taskHeading}>
        <Typography.Text>创建于 {formatTime(asset.createdAt)} <span title={asset.id}>· {asset.id.slice(-8)}</span></Typography.Text>
        <Tag color={asset.status === 'failed' ? 'error' : 'default'}>{statusText[asset.status]}</Tag>
      </div>
      <Space wrap>
        {asset.status === 'ready' && <Button size="small" type="link" href={`/api/v1/admin/media/${encodeURIComponent(asset.id)}/preview`} target="_blank" rel="noreferrer">查看图片</Button>}
        {(asset.status === 'uploaded' || asset.status === 'ready') && <Button size="small" disabled={disabled} onClick={() => onRestore(asset)}>
          {asset.status === 'uploaded' ? '处理并加入草稿' : '加入草稿'}
        </Button>}
        <Button size="small" danger disabled={disabled} onClick={() => onRecycle(asset.id)}>回收上传任务</Button>
      </Space>
    </li>)}</ul>
  </Card>;
}
