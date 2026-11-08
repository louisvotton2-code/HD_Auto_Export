import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { AdminVehicleResponseSchema, BulkVehicleMutationRequestSchema, BulkVehicleMutationResponseSchema, type AdminVehicle, type Availability, type BulkVehicleMutationResponse } from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { availabilityLabels, publicationLabels } from './draft-form';

type Operation = 'availability' | 'archive';
type Intent = { key: string; body: string; rows: AdminVehicle[]; operation: Operation; availability: Availability; startedAt: number };
type Props = { selected: AdminVehicle[]; onSelectionChange: (rows: AdminVehicle[]) => void; onRefresh: () => void; onBusyChange: (busy: boolean) => void };
const failureLabels = { VERSION_CONFLICT: '版本已变化，请核对后重试', NOT_FOUND: '记录不存在，请移出选择', DEMO_RESTRICTION: '展示样例不能改为实际库存', EXTERNAL_RESTRICTION: '外部挂牌需保留库存未知' };

export function BulkVehicleActions({ selected, onSelectionChange, onRefresh, onBusyChange }: Props) {
  const { modal, message } = App.useApp();
  const [setup, setSetup] = useState<Operation | null>(null);
  const [target, setTarget] = useState<Availability>('available');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BulkVehicleMutationResponse['data'] | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [participants, setParticipants] = useState<AdminVehicle[]>([]);
  const [reconciled, setReconciled] = useState<Record<string, number>>({});
  const intent = useRef<Intent | null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  const reconcileDialog = useRef<{ destroy: () => void } | null>(null);
  const parentBusy = useRef(onBusyChange); parentBusy.current = onBusyChange;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reconcileDialog.current?.destroy(); parentBusy.current(false); }; }, []);
  useEffect(() => {
    onBusyChange(busy || uncertain);
  }, [busy, uncertain, onBusyChange]);

  async function execute(original = false) {
    if (active.current) return;
    if (!original) {
      if (!setup || !selected.length || (setup === 'availability' && !verified)) return;
      const payload = BulkVehicleMutationRequestSchema.parse(setup === 'archive'
        ? { operation: setup, items: selected.map(row => ({ id: row.id, expectedVersion: row.version })) }
        : { operation: setup, availability: target, checkedAt: new Date().toISOString(), items: selected.map(row => ({ id: row.id, expectedVersion: row.version })) });
      intent.current = { key: crypto.randomUUID(), body: JSON.stringify(payload), rows: [...selected], operation: setup, availability: target, startedAt: Date.now() };
      setParticipants([...selected]); setReconciled({}); setResult(null);
    }
    const attempt = intent.current;
    if (!attempt) return;
    if (Date.now() - attempt.startedAt >= 24 * 60 * 60 * 1000) { setError('请求已超过幂等保留期，请先逐项核对当前记录，不可直接重试。'); setUncertain(true); return; }
    const wasUncertain = uncertain;
    active.current = true; setBusy(true); setError('');
    try {
      const response = await request('/api/v1/admin/vehicles/bulk', BulkVehicleMutationResponseSchema, { method: 'POST', body: attempt.body, headers: { 'Idempotency-Key': attempt.key } });
      if (!mounted.current) return;
      const expected = new Set(attempt.rows.map(row => row.id));
      if (response.data.operation !== attempt.operation || response.data.results.length !== expected.size || response.data.results.some(item => !expected.delete(item.id)) || expected.size) throw new ApiClientError(0, 'INVALID_RESPONSE');
      setResult(response.data); setReportOpen(true); setUncertain(false); setSetup(null); intent.current = null;
      const failed = new Set(response.data.results.filter(item => item.status === 'failed').map(item => item.id));
      onSelectionChange(attempt.rows.filter(row => failed.has(row.id))); onRefresh();
      void message.success(`已完成：成功 ${response.data.summary.succeeded} 辆，失败 ${response.data.summary.failed} 辆`);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof Error ? failure.message : '批量操作未完成，请保留页面核对。');
      if (wasUncertain || !(failure instanceof ApiClientError) || ![400, 401, 403, 404, 413, 422, 429].includes(failure.status)) { setUncertain(true); setSetup(null); }
      else { intent.current = null; setUncertain(false); }
    } finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  async function reconcile(id: string) {
    if (active.current) return;
    active.current = true; setBusy(true);
    try {
      const current = (await request(`/api/v1/admin/vehicles/${encodeURIComponent(id)}`, AdminVehicleResponseSchema)).data;
      if (!mounted.current) return;
      const old = selected.find(row => row.id === id);
      const dialog = modal.confirm({ title: '核对当前版本后再重试', content: <div><p>{current.stockCode} · 版本 {old?.version ?? '未知'} → {current.version}</p><p>当前{publicationLabels[current.publicationState]}，{current.draft.source.kind === 'demo' ? '展示样例，非实际库存' : availabilityLabels[current.availability]}。</p><p>确认采用这个版本继续？此操作只更新本地选择，不立即执行批量修改。</p></div>, okText: '采用当前版本', cancelText: '保留原选择' });
      reconcileDialog.current = dialog;
      const accepted = await dialog;
      reconcileDialog.current = null;
      if (!accepted) return;
      if (!mounted.current) return;
      onSelectionChange(selected.map(row => row.id === id ? current : row)); setReconciled(previous => ({ ...previous, [id]: current.version }));
    } catch (failure) { void message.error(failure instanceof Error ? failure.message : '读取当前版本失败'); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  const resultRows = result?.results.map(item => ({ ...item, row: participants.find(row => row.id === item.id) })) ?? [];
  return <>
    {selected.length > 0 && <div className="bulk-strip"><Space wrap><strong>已选择 {selected.length} 辆</strong><Typography.Text type="secondary">跨页保留选择 · 最多50辆</Typography.Text><Button size="small" type="link" disabled={busy || uncertain} onClick={() => onSelectionChange([])}>清空选择</Button></Space><Space wrap><Button disabled={busy || uncertain} onClick={() => { setSetup('availability'); setVerified(false); setError(''); }}>批量更新库存</Button><Button danger disabled={busy || uncertain} onClick={() => { setSetup('archive'); setVerified(false); setError(''); }}>批量下架</Button></Space></div>}
    {error && <Alert type="error" showIcon title={error} style={{ margin: 16 }} />}
    {uncertain && <Alert style={{ margin: 16 }} type="warning" showIcon title="批量操作结果尚未确认" description="请求可能已执行。选择已锁定，重试会复用原请求、版本和幂等标识，不会自动换成新版本覆盖。" action={<Button loading={busy} onClick={() => void execute(true)}>重试原批量请求</Button>} />}
    {result && <div style={{ padding: '10px 22px' }}><Space wrap><Tag color={result.summary.failed ? 'orange' : 'green'}>成功 {result.summary.succeeded} / 失败 {result.summary.failed}</Tag><Button type="link" size="small" onClick={() => setReportOpen(true)}>查看逐条结果</Button>{result.summary.failed > 0 && <Typography.Text type="secondary">失败项保留在选择中，可核对版本后再次操作。</Typography.Text>}</Space></div>}
    <Modal open={setup !== null} title={setup === 'archive' ? `确认下架 ${selected.length} 辆车辆？` : `更新 ${selected.length} 辆车辆的库存`} okText="确认批量操作" cancelText="取消" confirmLoading={busy} maskClosable={!busy} closable={!busy} keyboard={!busy} onCancel={() => !busy && setSetup(null)} onOk={() => void execute()} okButtonProps={{ danger: setup === 'archive', disabled: !selected.length || (setup === 'availability' && !verified) }}>
      <Alert type="warning" showIcon title={setup === 'archive' ? '成功下架的车辆将立即退出公开列表、详情和首页。' : '库存状态会立即影响公开展示；保存草稿与发布内容不受此操作代替。'} />
      <div style={{ margin: '18px 0' }}>{setup === 'availability' && <><label className="filter-label" htmlFor="bulk-target">目标库存状态</label><Select id="bulk-target" aria-label="目标库存状态" value={target} onChange={setTarget} style={{ width: '100%' }} options={Object.entries(availabilityLabels).map(([value, label]) => ({ value, label }))} /><Checkbox style={{ marginTop: 16 }} checked={verified} onChange={event => setVerified(event.target.checked)}>我已实际核验所选真实车辆的库存状态</Checkbox></>}</div>
      {selected.some(row => row.draft.source.kind === 'demo') && setup === 'availability' && <Alert type="info" title="包含展示样例：服务端会拒绝将它们修改为实际库存，并单独报告失败。" />}
      <Typography.Paragraph type="secondary" style={{ marginTop: 14 }}>每辆车使用选择时的版本，成功和失败分别报告；版本冲突不会覆盖同事的更新。</Typography.Paragraph>
    </Modal>
    <Modal open={reportOpen} title="批量操作结果" width={780} closable={!busy && !uncertain} maskClosable={!busy && !uncertain} keyboard={!busy && !uncertain} footer={<Button type="primary" disabled={busy || uncertain} onClick={() => setReportOpen(false)}>完成</Button>} onCancel={() => { if (!busy && !uncertain) setReportOpen(false); }}>
      <Table rowKey="id" size="small" dataSource={resultRows} pagination={false} scroll={{ x: 580 }} columns={[
        { title: '车辆', render: (_, item) => <div>{item.row?.stockCode ?? item.id}<div style={{ color: '#8b9799', fontSize: 11 }}>{item.row?.draft.facts.make?.name} {item.row?.draft.facts.model?.name}</div></div> },
        { title: '结果', render: (_, item) => item.status === 'succeeded' ? <Tag color="green">成功 · 版本 {item.version}</Tag> : <Space direction="vertical" size={3}><Tag color="red">失败</Tag><span>{failureLabels[item.error.code]}</span>{reconciled[item.id] && <Tag color="blue">已核对版本 {reconciled[item.id]}</Tag>}</Space> },
        { title: '处理', render: (_, item) => item.status === 'failed' && item.error.code === 'VERSION_CONFLICT' ? <Button size="small" disabled={busy || uncertain} onClick={() => void reconcile(item.id)}>读取最新版本</Button> : item.status === 'failed' ? <Button size="small" disabled={busy || uncertain} onClick={() => onSelectionChange(selected.filter(row => row.id !== item.id))}>移出选择</Button> : '—' },
      ]} />
    </Modal>
  </>;
}
