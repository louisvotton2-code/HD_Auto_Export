import { useRef, useState } from 'react';
import { Alert, App, Button, Card, Modal, Space, Table, Tag } from 'antd';
import {
  ExternalBulkVisibilityRequestSchema, ExternalBulkVisibilityResponseSchema, ExternalListingResponseSchema,
  type ExternalBulkVisibilityRequest, type ExternalListing,
} from '@hd/contracts/admin';
import { request } from '../../shared/api/client';
import { ActionFeedback } from './action-feedback';
import { externalRoot, listingLabels, recordLabels } from './external-labels';
import { useExternalAction } from './use-external-action';

const failures = { NOT_FOUND: '挂牌不存在', VERSION_CONFLICT: '版本变化，需重新核对', EXTERNAL_RESTRICTION: '来源已撤回或不符合展示条件' };

export function BulkVisibility({ ids, onComplete }: { ids: string[]; onComplete: (failed: string[]) => void }) {
  const action = useExternalAction('POST', ExternalBulkVisibilityResponseSchema);
  const { modal, message } = App.useApp();
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ hidden: boolean; listings: ExternalListing[] }>();
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReturnType<typeof ExternalBulkVisibilityResponseSchema.parse>['data']['items']>([]);

  async function prepare(hidden: boolean) {
    if (loadingRef.current || action.busy || action.uncertain || !ids.length) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    const selected = [...ids];
    try {
      const listings: ExternalListing[] = [];
      for (let i = 0; i < selected.length; i += 5) {
        const chunk = await Promise.all(selected.slice(i, i + 5).map(async id => {
          const { data } = await request(`${externalRoot}/listings/${encodeURIComponent(id)}?locale=zh`, ExternalListingResponseSchema, { signal: AbortSignal.timeout(15_000) });
          if (data.id !== id) throw new Error('挂牌编号不匹配，请重新读取。');
          return data;
        }));
        listings.push(...chunk);
      }
      setPreview({ hidden, listings });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '无法读取所选挂牌。');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }
  async function submit(retry = false) {
    if (!preview) return;
    const payload: ExternalBulkVisibilityRequest = {
      hidden: preview.hidden,
      items: preview.listings.map(({ id, version }) => ({ id, version })),
    };
    const response = await action.execute(retry ? undefined : {
      path: `${externalRoot}/listings/bulk-visibility`, body: JSON.stringify(ExternalBulkVisibilityRequestSchema.parse(payload)),
      matches: ({ data }) => {
        const expected = new Set(payload.items.map(item => item.id));
        return data.items.length === expected.size && data.items.every(item => expected.delete(item.id));
      },
    });
    if (!response) return;
    const rows = response.data.items;
    setResult(rows);
    setPreview(undefined);
    const failed = rows.filter(item => item.status === 'failed').map(item => item.id);
    onComplete(failed);
    void message.success(`处理完成，${failed.length} 条需核对。`);
  }
  async function reconcile() {
    if (!await modal.confirm({ title: '结束本次重试？', content: '下次操作前会重新读取所选挂牌的当前版本。', okText: '结束重试', cancelText: '返回' })) return;
    action.clear();
    setPreview(undefined);
  }
  const locked = action.busy || action.uncertain;
  return <>
    <Space wrap>
      <span>本页选中 {ids.length} 条挂牌</span>
      <Button disabled={!ids.length || locked} loading={loading} onClick={() => void prepare(true)}>批量隐藏</Button>
      <Button disabled={!ids.length || locked} loading={loading} onClick={() => void prepare(false)}>批量取消隐藏</Button>
    </Space>
    {error && <Alert type="error" showIcon title={error} />}
    {result.length > 0 && <Card size="small" title="批量处理结果">
      <Table rowKey="id" size="small" scroll={{ x: 600 }} pagination={false} dataSource={result} columns={[
        { title: '挂牌编号', dataIndex: 'id' },
        { title: '结果', render: (_, item) => item.status === 'failed' ? <Tag color="red">失败</Tag> : recordLabels[item.status] },
        { title: '状态或原因', render: (_, item) => item.status === 'failed' ? failures[item.reason] : listingLabels[item.state] },
      ]} />
    </Card>}
    <Modal open={Boolean(preview)} title={preview?.hidden ? '确认批量隐藏？' : '确认批量取消隐藏？'}
      okText="确认处理" cancelText="取消" closable={!locked} keyboard={!locked} mask={{ closable: !locked }}
      confirmLoading={action.busy} okButtonProps={{ disabled: locked }} cancelButtonProps={{ disabled: locked }}
      onCancel={() => { if (!locked) { setPreview(undefined); action.clear(); } }} onOk={() => void submit()}>
      {preview && <div>
        <p>将按下列当前版本处理 {preview.listings.length} 条挂牌。来源已撤回的挂牌无法恢复展示。</p>
        <ul>{preview.listings.map(row => <li key={row.id}>{row.identity.externalId} · {listingLabels[row.state]} · 版本 {row.version}</li>)}</ul>
      </div>}
      <ActionFeedback {...action} retry={() => void submit(true)} reconcile={() => void reconcile()} />
    </Modal>
  </>;
}
