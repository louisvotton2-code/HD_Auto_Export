import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd';
import {
  ExternalBatchListResponseSchema, ExternalBatchRecordResponseSchema, ExternalBatchRecordsResponseSchema,
  ExternalBatchResponseSchema, ExternalRawRecordResponseSchema, ExternalStatusResponseSchema,
  type ExternalBatch, type StaffMe,
} from '@hd/contracts/admin';
import { BatchTrial } from './batch-trial';
import { BulkVisibility } from './bulk-visibility';
import { ExternalImport } from './external-import';
import { SourceRecordDetails } from './source-record-details';
import { batchLabels, externalRoot, fieldLabels, issueLabels, languageLabels, pageSize, reasonLabels, recordLabels } from './external-labels';
import { ResourceContent } from './resource-content';
import { useExternalResource } from './use-external-resource';
import styles from './external-sources.module.css';

const { Title } = Typography;
const listingPath = (id: string) => `/external-sources/listings/${encodeURIComponent(id)}`;
const batchPath = (id: string) => `/external-sources/batches/${encodeURIComponent(id)}`;
const copyFields = ['title', 'model', 'description'] as const;
const locales = ['zh', 'en', 'ru'] as const;

function DateText({ value }: { value: string }) {
  return <time dateTime={value}>{new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
  }).format(new Date(value))}</time>;
}

function BatchCounts({ counts }: Pick<ExternalBatch, 'counts'>) {
  return <Space wrap>
    <Tag>共 {counts.total} 条</Tag>
    <Tag color="green">已应用 {counts.applied}</Tag>
    <Tag>无变化 {counts.unchanged}</Tag>
    <Tag>已忽略 {counts.ignored}</Tag>
    <Tag color={counts.rejected ? 'orange' : undefined}>已拒绝 {counts.rejected}</Tag>
  </Space>;
}

export function ExternalBatchHistoryPage() {
  const staff = useOutletContext<StaffMe>();
  const [page, setPage] = useState(1);
  const status = useExternalResource(`${externalRoot}/status`, ExternalStatusResponseSchema);
  const batches = useExternalResource(`${externalRoot}/batches?page=${page}&pageSize=${pageSize}`, ExternalBatchListResponseSchema);
  const refresh = () => { status.reload(); batches.reload(); };
  return <section className={styles.stack}>
    <header className={styles.heading}>
      <div>
        <Title level={2}>历史导入批次</Title>
        <Space wrap><Link to="/external-sources">三方 API 状态</Link><Link to="/vehicles">返回车辆管理</Link></Space>
      </div>
      <Button onClick={refresh}>重新读取</Button>
    </header>
    <Card title="同步与试译状态">
      <ResourceContent {...status} retry={status.reload}>{status.data && <Descriptions column={{ xs: 1, md: 2 }} items={[
        { key: 'sync', label: '同步方式', children: '手动导入' },
        { key: 'translation', label: '翻译方式', children: '试译用量测算' },
        { key: 'limit', label: '单批字符上限', children: status.data.data.batchCharacterLimit.toLocaleString('zh-CN') },
        { key: 'quota', label: '账号剩余免费额度', children: '待核实' },
        { key: 'latest', label: '最近导入', children: status.data.data.lastBatch ? <DateText value={status.data.data.lastBatch.importedAt} /> : '暂无批次' },
      ]} />}</ResourceContent>
    </Card>
    {staff.role === 'admin' && status.data && <ExternalImport onImported={() => { setPage(1); refresh(); }} />}
    <Card title="导入批次">
      <ResourceContent {...batches} retry={batches.reload}>{batches.data && <Table
        rowKey="id" scroll={{ x: 720 }} dataSource={batches.data.data.items}
        pagination={{ current: page, pageSize, total: batches.data.data.total, showSizeChanger: false, onChange: setPage }}
        locale={{ emptyText: '暂无导入批次' }}
        columns={[
          { title: '来源', dataIndex: 'provider' },
          { title: '导入时间', render: (_, batch) => <DateText value={batch.importedAt} /> },
          { title: '状态', render: (_, batch) => <Tag>{batchLabels[batch.state]}</Tag> },
          { title: '处理进度', render: (_, batch) => <BatchCounts counts={batch.counts} /> },
          { title: '操作', render: (_, batch) => <Link to={batchPath(batch.id)}>查看批次</Link> },
        ]}
      />}</ResourceContent>
    </Card>
  </section>;
}

function BatchPage({ id }: { id: string }) {
  const staff = useOutletContext<StaffMe>();
  const [page, setPage] = useState(1);
  const path = `${externalRoot}/batches/${encodeURIComponent(id)}`;
  const [selected, setSelected] = useState<string[]>([]);
  const batch = useExternalResource(path, ExternalBatchResponseSchema);
  const records = useExternalResource(`${path}/records?page=${page}&pageSize=${pageSize}`, ExternalBatchRecordsResponseSchema);
  return <section className={styles.stack}>
    <Link to="/external-sources/batches">返回批次列表</Link>
    <Title level={2}>导入批次详情</Title>
    <ResourceContent {...batch} retry={batch.reload}>{batch.data && <>
      <Card title={batch.data.data.provider}>
        <Space orientation="vertical" align="start">
          <Space wrap><Tag>{batchLabels[batch.data.data.state]}</Tag><DateText value={batch.data.data.importedAt} /></Space>
          <BatchCounts counts={batch.data.data.counts} />
        </Space>
      </Card>
      <BatchTrial batchId={id} canPlan={staff.role === 'admin'} />
      {staff.permissions.includes('vehicles:write') && <BulkVisibility ids={selected} onComplete={setSelected} />}
      <Card title="来源记录">
        <ResourceContent {...records} retry={records.reload}>{records.data && <Table
          rowKey="row" scroll={{ x: 690 }} dataSource={records.data.data.items}
          rowSelection={staff.permissions.includes('vehicles:write') ? {
            selectedRowKeys: records.data.data.items.filter(item => item.listingId && selected.includes(item.listingId)).map(item => item.row),
            getCheckboxProps: item => ({ disabled: !item.listingId }),
            onChange: (_, rows) => setSelected([...new Set(rows.flatMap(row => row.listingId ? [row.listingId] : []))]),
          } : undefined}
          pagination={{ current: page, pageSize, total: records.data.data.total, showSizeChanger: false, onChange: next => { setSelected([]); setPage(next); } }}
          columns={[
            { title: '行号', dataIndex: 'row' },
            { title: '导入结果', render: (_, row) => <Tag>{recordLabels[row.status]}</Tag> },
            { title: '原因', render: (_, row) => row.reason ? reasonLabels[row.reason] : '—' },
            { title: '资料异常', render: (_, row) => row.issues.length ? `${row.issues.length} 项` : '—' },
            { title: '操作', render: (_, row) => <Space wrap>
              <Link to={`${batchPath(id)}/records/${row.row}`}>查看来源</Link>
              {row.listingId && <Link to={listingPath(row.listingId)}>查看当前挂牌</Link>}
            </Space> },
          ]}
        />}</ResourceContent>
      </Card>
    </>}</ResourceContent>
  </section>;
}

export function ExternalBatchPage() {
  const { batchId = '' } = useParams();
  return <BatchPage key={batchId} id={batchId} />;
}

function RawRecord({ path }: { path: string }) {
  const raw = useExternalResource(`${path}/raw`, ExternalRawRecordResponseSchema);
  return <Card title="受保护原档">
    <ResourceContent {...raw} retry={raw.reload}>{raw.data && <pre className={styles.sourceText}>{raw.data.data.raw}</pre>}</ResourceContent>
  </Card>;
}

export function ExternalBatchRecordPage() {
  const { batchId = '', row = '' } = useParams();
  const staff = useOutletContext<StaffMe>();
  const path = `${externalRoot}/batches/${encodeURIComponent(batchId)}/records/${encodeURIComponent(row)}`;
  const record = useExternalResource(path, ExternalBatchRecordResponseSchema);
  const [rawPath, setRawPath] = useState<string>();
  const item = record.data?.data;
  const candidate = item?.candidate;
  const upsert = candidate?.operation === 'upsert' ? candidate : null;
  return <section className={styles.stack}>
    <Link to={batchPath(batchId)}>返回批次</Link>
    <Title level={2}>来源记录</Title>
    <ResourceContent {...record} retry={record.reload}>{item && <>
      <Card title={`第 ${item.row} 行`}>
        <Space wrap>
          <Tag>{recordLabels[item.status]}</Tag>
          {item.reason && <span>{reasonLabels[item.reason]}</span>}
          {item.listingId && <Link to={listingPath(item.listingId)}>查看当前挂牌</Link>}
        </Space>
      </Card>
      <SourceRecordDetails
        source={candidate?.platformId ?? '待确认'}
        identity={candidate?.externalId ?? '待确认'}
        listingUrl={upsert?.listingUrl ?? null}
        allowListingLink={item.status === 'applied' || item.status === 'unchanged'}
        comparisons={copyFields.map(field => ({
          key: field, label: fieldLabels[field], original: upsert?.copy[field]?.original.text ?? null,
          translations: locales.map(locale => ({
            language: languageLabels[locale], text: upsert?.copy[field]?.translations[locale]?.text ?? null,
            status: upsert?.copy[field]?.translations[locale] ? '供应商译文' : undefined,
          })),
        }))}
        conflicts={item.issues.map((issue, index) => ({
          key: `${issue.field}:${index}`, label: fieldLabels[issue.field], reason: issueLabels[issue.code],
        }))}
      />
      {staff.role === 'admin' && (rawPath === path
        ? <RawRecord path={path} />
        : <div><Button onClick={() => setRawPath(path)}>读取受保护原档</Button></div>)}
    </>}</ResourceContent>
  </section>;
}
