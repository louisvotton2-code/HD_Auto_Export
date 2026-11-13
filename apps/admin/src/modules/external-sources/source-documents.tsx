import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Space, Spin, Table, Typography } from 'antd';
import { ExternalSourceDocumentResponseSchema, ExternalSourceDocumentsResponseSchema, type ExternalSourceDocumentSummary } from '@hd/contracts/admin';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { formatTime } from '../vehicles/draft-form';
import { externalRoot } from './external-labels';
import styles from './source-documents.module.css';

const kinds = { csv: 'CSV来源记录', detail: '车辆详情', specs: '车辆规格', report: '报告资料', event: '增量事件' };
const languages = { zh: '中文', en: '英文', ru: '俄文', und: '语言未标明' };

export function SourceDocuments({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const root = `${externalRoot}/listings/${encodeURIComponent(listingId)}/source-documents`;
  const query = new URLSearchParams({ limit: '20' });
  const cursor = cursors.at(-1);
  if (cursor) query.set('cursor', cursor);
  const list = usePrivateResource(open ? `${root}?${query}` : null, ExternalSourceDocumentsResponseSchema, revision);
  const detail = usePrivateResource(open && selected ? `${root}/${encodeURIComponent(selected)}` : null, ExternalSourceDocumentResponseSchema, detailRevision);
  function refresh() {
    setOpen(true); setSelected(null); setCursors([null]); setRevision(value => value + 1); list.resume(); detail.resume();
  }
  const document = detail.data?.data;
  return <Card title="供应商原档与历史" extra={<Button onClick={refresh} loading={list.loading}>{open ? '刷新供应商原档' : '查看供应商原档'}</Button>}>
    <Typography.Paragraph type="secondary">按需读取当前车源的完整来源文档及历史版本。资料保留供应商原文，不代表事实或报告内容已经核验。</Typography.Paragraph>
    {open && <div className={styles.stack}>
      {list.loading ? <Spin description="读取原档目录" /> : list.error ? <Alert type="error" showIcon title={list.error} action={<Button onClick={refresh}>重新读取原档</Button>} />
        : list.data && <>
          <Table<ExternalSourceDocumentSummary> size="small" rowKey="id" pagination={false} scroll={{ x: 760 }} dataSource={list.data.data.items} locale={{ emptyText: <Empty description="暂无可读取的正式来源文档" /> }} columns={[
            { title: '文档', render: (_, item) => <Space orientation="vertical" size={2}><span>{kinds[item.kind]} · {languages[item.locale]}</span><Typography.Text className={styles.hash}>{item.hash}</Typography.Text></Space> },
            { title: '首次观察', width: 150, render: (_, item) => formatTime(item.firstObservedAt) },
            { title: '最近观察', width: 150, render: (_, item) => formatTime(item.lastObservedAt) },
            { title: '来源更新时间', width: 150, render: (_, item) => formatTime(item.sourceUpdatedAt) },
            { title: '操作', width: 85, render: (_, item) => <Button size="small" onClick={() => { setSelected(item.id); setDetailRevision(value => value + 1); detail.resume(); }}>读取正文</Button> },
          ]} />
          <Space wrap><Button disabled={cursors.length <= 1} onClick={() => { setSelected(null); setCursors(values => values.slice(0, -1)); }}>上一页原档</Button>
            <span>第 {cursors.length} 页 · 每页最多 20 条</span><Button disabled={!list.data.data.nextCursor} onClick={() => { const next = list.data?.data.nextCursor; if (next) { setSelected(null); setCursors(values => [...values, next]); } }}>下一页原档</Button></Space>
        </>}
      {selected && <section className={styles.stack} aria-label="供应商文档正文">
        {detail.loading ? <Spin description="读取文档正文" /> : detail.error ? <Alert type="error" showIcon title={detail.error} />
          : document && (document.id !== selected ? <Alert type="error" title="文档编号与当前选择不一致，未展示正文。" /> : <>
            <Descriptions column={1} size="small" items={[
              { key: 'type', label: '文档类型', children: `${kinds[document.kind]} · ${languages[document.locale]}` },
              { key: 'hash', label: '文档摘要', children: <span className={styles.hash}>{document.hash}</span> },
            ]} />
            {document.response && <Alert type="info" showIcon title="共享批量响应仅显示归档摘要" description={<span>批量响应包含其他车辆，此处只展示当前车辆文档，不能将其视为完整批量原文。归档摘要：<span className={styles.hash}>{document.response.hash}</span></span>} />}
            <div><Typography.Title level={5}>该车结构化文档</Typography.Title><pre className={styles.payload}>{JSON.stringify(document.payload, null, 2)}</pre></div>
            <div><Typography.Title level={5}>该车原文</Typography.Title>{document.rawText === null ? <p>没有保存独立的单车原文字串；上方结构化文档仍可查看。</p> : <pre className={styles.payload}>{document.rawText === '' ? '""（空原文）' : document.rawText}</pre>}</div>
          </>)}
      </section>}
    </div>}
  </Card>;
}
