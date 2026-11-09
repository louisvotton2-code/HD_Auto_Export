import { useEffect, useState } from 'react';
import { Link, useBlocker, useOutletContext, useSearchParams } from 'react-router-dom';
import { Alert, App, Button, Card, Dropdown, Empty, Image, Input, Modal, Pagination, Select, Space, Table, Tag, Typography } from 'antd';
import { CarOutlined, CheckCircleOutlined, FileTextOutlined, MoreOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { AdminVehicleListSchema, AvailabilitySchema, PublicationStateSchema, PowertrainSchema, type AdminVehicle, type AdminVehicleList, type StaffMe } from '@hd/contracts/admin';
import { request } from '../../shared/api/client';
import { useVehicleDictionary } from '../../shared/api/vehicle-dictionary';
import { availabilityLabels, formatTime, publicationLabels, powertrainLabels } from './draft-form';
import { BulkVehicleActions } from './bulk-vehicle-actions';
import { VehicleDeletionActions } from './vehicle-deletion-actions';

export function VehiclesPage({ deleted = false }: { deleted?: boolean }) {
  const staff = useOutletContext<StaffMe>();
  const { message } = App.useApp();
  const canWrite = staff.permissions.includes('vehicles:write');
  const dictionary = useVehicleDictionary();
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<AdminVehicleList['data'] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<AdminVehicle[]>([]);
  const [batchBusy, setBulkBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<AdminVehicle | null>(null);
  const [lifecycleConflict, setLifecycleConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const bulkBusy = batchBusy || lifecycleBusy;
  const blocker = useBlocker(bulkBusy);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('admin:dirty', { detail: bulkBusy }));
    const beforeUnload = (event: BeforeUnloadEvent) => { if (bulkBusy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [bulkBusy]);
  useEffect(() => () => { window.dispatchEvent(new CustomEvent('admin:dirty', { detail: false })); }, []);
  const q = params.get('q') ?? '';
  const make = params.get('make') ?? '';
  const model = make ? params.get('model') ?? '' : '';
  const rawPowertrain = PowertrainSchema.safeParse(params.get('powertrain'));
  const powertrain = rawPowertrain.success ? rawPowertrain.data : '';
  const [searchText, setSearchText] = useState(q);
  useEffect(() => setSearchText(q), [q]);
  const rawPage = Number(params.get('page') ?? '1');
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1_000_000 ? rawPage : 1;
  const rawSize = Number(params.get('pageSize') ?? '12');
  const pageSize = [12, 24, 48].includes(rawSize) ? rawSize : 12;
  const publicationValue = PublicationStateSchema.safeParse(params.get('publicationState'));
  const inventoryValue = AvailabilitySchema.safeParse(params.get('availability'));
  const publication = publicationValue.success ? publicationValue.data : '';
  const inventory = inventoryValue.success ? inventoryValue.data : '';
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), deleted: deleted ? 'only' : 'exclude' });
    for (const [key, value] of Object.entries({ publicationState: publication, availability: inventory, q, make, model, powertrain })) if (value) query.set(key, value);
    setLoading(true); setError('');
    request(`/api/v1/admin/vehicles?${query}`, AdminVehicleListSchema, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setResult(response.data); })
      .catch(failure => { if (!controller.signal.aborted) { setResult(null); setError(failure instanceof Error ? failure.message : '车辆读取失败'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, pageSize, publication, inventory, q, make, model, powertrain, refresh, deleted]);
  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    if (name !== 'page') next.delete('page');
    if (name === 'make') next.delete('model');
    setParams(next);
  }
  function changePage(nextPage: number, nextSize: number) {
    const next = new URLSearchParams(params); next.set('page', String(nextSize !== pageSize ? 1 : nextPage)); next.set('pageSize', String(nextSize)); setParams(next);
  }
  const pageItems = result?.items ?? [];
  const isFiltered = Boolean(q || make || model || powertrain || publication || inventory);
  const publicationColor = { draft: 'default', published: 'green', archived: 'default' };
  const inventoryColor = { available: 'green', reserved: 'blue', sold: 'red', unknown: 'default' };
  function finishedLifecycle(record: AdminVehicle) {
    setNotice(record.deletedAt ? '车辆已移入回收站，公开展示与首页引用已撤销。' : '车辆当前未删除，已读取最新状态。恢复的车辆需重新核验并发布，不会自动加回首页。');
    setSelected(rows => rows.filter(row => row.id !== record.id));
    setLifecycleTarget(null); setRefresh(value => value + 1); dictionary.reload();
  }
  return <section>
    <div className="page-heading"><div><div className="page-eyebrow">VEHICLE OPERATIONS</div><h1>{deleted ? '车辆回收站' : '车辆管理'}</h1><p>{deleted ? '保留已删除车辆的资料与历史，恢复后重新核验并发布。' : '整理车源、核对内容，把每辆车的状态看清楚。'}</p></div><Space wrap><Button icon={<ReloadOutlined />} loading={loading} disabled={bulkBusy} onClick={() => { setRefresh(value => value + 1); dictionary.reload(); }}>刷新列表</Button><Link to={deleted ? '/vehicles' : '/recycle-bin'}><Button>{deleted ? '返回车辆管理' : '查看回收站'}</Button></Link>{canWrite && !deleted && <Link to="/vehicles/new"><Button type="primary" icon={<PlusOutlined />}>新建车辆</Button></Link>}</Space></div>
    {notice && <Alert showIcon type="success" title={notice} closable onClose={() => setNotice('')} style={{ marginBottom: 20 }} />}
    {deleted && <Alert showIcon type="info" title="恢复不会自动公开" description="删除会撤销公开访问并移除首页引用，图片和发布历史仍保留。恢复后为未发布草稿、库存待核验，不会自动加回首页。" style={{ marginBottom: 20 }} />}
    <div className="stats-row">
      <div className="stat-card"><span className="stat-icon"><CarOutlined /></span><div><div className="stat-value">{error ? '—' : result?.total ?? '—'}</div><div className="stat-caption">{isFiltered ? '符合筛选的车辆' : deleted ? '回收站车辆档案' : '全部车辆档案'}</div></div></div>
      {!deleted && <><div className="stat-card"><span className="stat-icon"><CheckCircleOutlined /></span><div><div className="stat-value">{pageItems.filter(row => row.publicationState === 'published').length}</div><div className="stat-caption">本页已发布</div></div></div>
      <div className="stat-card"><span className="stat-icon"><FileTextOutlined /></span><div><div className="stat-value">{pageItems.filter(row => row.publicationState === 'draft').length}</div><div className="stat-caption">本页草稿</div></div></div></>}
    </div>
    <Card className="workspace-card" styles={{ body: { padding: 22 } }}>
      <div className="filter-grid">
        <div><label className="filter-label" htmlFor="vehicle-search">搜索车辆</label><Input.Search id="vehicle-search" aria-label="关键词搜索" prefix={<SearchOutlined />} placeholder="车号、品牌、车型或原文标题" maxLength={100} value={searchText} onChange={event => setSearchText(event.target.value)} onSearch={value => update('q', value.trim())} disabled={bulkBusy} allowClear enterButton="搜索" /></div>
        <div><label className="filter-label" htmlFor="make-filter">品牌</label><Select id="make-filter" aria-label="品牌筛选" placeholder="全部品牌" value={make || undefined} showSearch optionFilterProp="label" allowClear onChange={value => update('make', value ?? '')} disabled={bulkBusy || dictionary.loading} options={dictionary.data?.makes.map(item => ({ value: item.id, label: item.name }))} /></div>
        <div><label className="filter-label" htmlFor="model-filter">车型</label><Select id="model-filter" aria-label="车型筛选" placeholder={make ? '全部车型' : '先选择品牌'} value={model || undefined} showSearch optionFilterProp="label" allowClear onChange={value => update('model', value ?? '')} disabled={bulkBusy || !make || dictionary.loading} options={dictionary.data?.models.filter(item => item.makeId === make).map(item => ({ value: item.id, label: item.name }))} /></div>
        <div><label className="filter-label" htmlFor="powertrain-filter">动力</label><Select id="powertrain-filter" aria-label="动力分类" value={powertrain || undefined} placeholder="全部动力" allowClear onChange={value => update('powertrain', value ?? '')} disabled={bulkBusy} options={Object.entries(powertrainLabels).map(([value, label]) => ({ value, label }))} /></div>
      </div>
      <div className="toolbar-bottom"><Space wrap><Select aria-label="发布状态" style={{ width: 140 }} value={publication || undefined} placeholder="全部发布状态" allowClear onChange={value => update('publicationState', value ?? '')} disabled={bulkBusy} options={Object.entries(publicationLabels).map(([value, label]) => ({ value, label }))} /><Select aria-label="库存状态" style={{ width: 140 }} value={inventory || undefined} placeholder="全部库存状态" allowClear onChange={value => update('availability', value ?? '')} disabled={bulkBusy} options={Object.entries(availabilityLabels).map(([value, label]) => ({ value, label }))} /></Space><Button type="link" disabled={bulkBusy} onClick={() => { setSearchText(''); setParams({}); }}>清空筛选</Button></div>
      {dictionary.error && <Alert type="warning" title="品牌车型选项暂时不可用" description={dictionary.error} action={<Button size="small" onClick={dictionary.reload}>重试字典</Button>} style={{ marginTop: 16 }} />}
    </Card>
    <Card className="workspace-card list-card">
      <div className="list-topline"><Space><Typography.Text strong>车辆档案</Typography.Text><Tag>{result?.total ?? 0} 辆</Tag></Space><Typography.Text type="secondary" style={{ fontSize: 11 }}>库存与发布分别管理 · 已选版本受保护</Typography.Text></div>
      {canWrite && !deleted && <BulkVehicleActions selected={selected} onSelectionChange={setSelected} onRefresh={() => { setRefresh(value => value + 1); dictionary.reload(); }} onBusyChange={setBulkBusy} />}
      {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setRefresh(value => value + 1)}>重新读取</Button>} style={{ margin: 20 }} /> : <div className="table-region"><Table<AdminVehicle> rowKey="id" size="middle" loading={loading} dataSource={pageItems} pagination={false} scroll={{ x: 850 }} locale={{ emptyText: <Empty description={isFiltered ? '当前条件下暂无车辆' : '暂无车辆，从新建一份档案开始'} /> }}
        rowSelection={canWrite && !deleted ? { selectedRowKeys: selected.map(row => row.id), preserveSelectedRowKeys: true, getCheckboxProps: row => ({ disabled: bulkBusy || (selected.length >= 50 && !selected.some(item => item.id === row.id)), 'aria-label': `选择车辆 ${row.stockCode}` }), onChange: (keys, rows) => { if (keys.length > 50) { void message.warning('一次最多选择50辆'); return; } const known = new Map([...rows.filter(Boolean), ...selected].map(row => [row.id, row])); setSelected(keys.flatMap(key => known.has(String(key)) ? [known.get(String(key))!] : [])); } } : undefined}
        columns={[
          { title: '车辆信息', key: 'vehicle', width: 260, render: (_, row) => { const media = row.draft.media.find(item => item.isCover) ?? row.draft.media[0]; const name = [row.draft.facts.make?.name, row.draft.facts.model?.name].filter(Boolean).join(' ') || row.draft.content.title.sourceText || '待补充车辆'; return <div className="vehicle-cell">{media && !deleted ? <Image width={84} height={60} src={`/api/v1/admin/media/${encodeURIComponent(media.id)}/preview`} alt={media.alt || name} style={{ objectFit: 'cover', borderRadius: 8 }} /> : <span className="vehicle-thumb-placeholder"><CarOutlined /></span>}<div>{canWrite ? <Link className="vehicle-name" to={`/vehicles/${row.id}`}>{name}</Link> : <span className="vehicle-name">{name}</span>}<div className="vehicle-stock">{row.stockCode}</div><div className="vehicle-spec">{row.draft.facts.modelYear ? `${row.draft.facts.modelYear}款 · ` : ''}{powertrainLabels[row.draft.facts.powertrain]}</div>{row.draft.source.kind === 'external' && <Tag color="blue" style={{ marginTop: 5 }}>外部挂牌 · 库存未知</Tag>}{row.draft.source.kind === 'demo' && <Tag className="demo-tag" color="gold" style={{ marginTop: 5 }}>展示样例，非实际库存</Tag>}</div></div>; } },
          { title: '展示价格', width: 125, render: (_, row) => <div className="vehicle-price">{row.draft.price.money ? `${row.draft.price.money.amount} ${row.draft.price.money.currency}` : '待询价'}<small>{row.draft.price.kind === 'reference' ? '参考价格' : row.draft.price.kind === 'asking' ? '公开报价' : '暂无公开报价'}</small></div> },
          { title: '库存 / 发布', width: 120, render: (_, row) => deleted ? <Tag>已删除</Tag> : <Space direction="vertical" size={5}><Tag color={row.draft.source.kind === 'demo' ? 'gold' : inventoryColor[row.availability]}>{row.draft.source.kind === 'demo' ? '非实际库存' : row.draft.source.kind === 'external' ? '外部挂牌 · 库存未知' : availabilityLabels[row.availability]}</Tag><Tag color={publicationColor[row.publicationState]}>{publicationLabels[row.publicationState]}</Tag></Space> },
          { title: deleted ? '删除时间' : '更新时间', width: 145, render: (_, row) => <div style={{ color: '#607278', fontSize: 11 }}>{formatTime(deleted ? row.deletedAt : row.updatedAt)}<div style={{ marginTop: 7 }}>核验：{row.draft.source.kind !== 'manual' ? '不适用' : formatTime(row.availabilityCheckedAt)}</div></div> },
          { title: '操作', key: 'actions', width: 166, render: (_, row) => <Space wrap>{canWrite && <Link to={`/vehicles/${row.id}`}>{deleted ? '查看详情' : '编辑'}</Link>}{canWrite && <Button type="link" size="small" danger={!deleted} disabled={bulkBusy} onClick={() => { setLifecycleTarget(row); setLifecycleConflict(false); }}>{deleted ? '恢复车辆' : '删除车辆'}</Button>}<Dropdown menu={{ items: [{ key: 'copy', label: '复制车号', onClick: () => { void navigator.clipboard.writeText(row.stockCode).then(() => message.success('车号已复制')).catch(() => message.error('复制失败，请手动复制车号')); } }, { key: 'public', disabled: !!row.deletedAt || row.publicationState !== 'published', label: row.deletedAt || row.publicationState !== 'published' ? '未公开' : <a href={`/api/v1/vehicles/${encodeURIComponent(row.id)}?locale=zh&view=localized`} target="_blank" rel="noreferrer">查看公开接口</a> }] }}><Button type="text" size="small" aria-label={`更多操作 ${row.stockCode}`} icon={<MoreOutlined />} /></Dropdown></Space> },
        ]} /></div>}
      {result && <div className="table-pagination"><Pagination current={page} pageSize={pageSize} total={result.total} onChange={changePage} showSizeChanger pageSizeOptions={[12, 24, 48]} showTotal={total => `共 ${total} 辆`} size="small" responsive disabled={bulkBusy} /></div>}
    </Card>
    <Modal open={lifecycleTarget !== null} title={deleted ? '恢复车辆' : '删除车辆'} closable={!lifecycleBusy} keyboard={!lifecycleBusy} maskClosable={!lifecycleBusy} destroyOnHidden footer={<Button disabled={lifecycleBusy} onClick={() => setLifecycleTarget(null)}>关闭</Button>} onCancel={() => !lifecycleBusy && setLifecycleTarget(null)}>
      {lifecycleTarget && <><Typography.Paragraph strong>{lifecycleTarget.stockCode} · {lifecycleTarget.draft.content.title.sourceText || '车辆档案'}</Typography.Paragraph>
        {lifecycleConflict && <Alert showIcon type="warning" title="版本已变化" description="本次操作未覆盖新版本。请关闭窗口并刷新列表，核对资料后重新操作。" style={{ marginBottom: 16 }} />}
        <VehicleDeletionActions key={lifecycleTarget.id} vehicle={lifecycleTarget} isDeleted={deleted} disabled={batchBusy} onBusyChange={setLifecycleBusy} onDeleted={finishedLifecycle} onRestored={finishedLifecycle} onConflict={() => setLifecycleConflict(true)} />
      </>}
    </Modal>
    <Modal open={blocker.state === 'blocked'} title="车辆操作仍在处理中" okText="离开并自行核对" cancelText="留在当前页面" onCancel={() => blocker.state === 'blocked' && blocker.reset()} onOk={() => blocker.state === 'blocked' && blocker.proceed()}><p>操作仍在执行或结果不明，离开会丢失当前恢复入口。建议留在页面确认结果。</p></Modal>
  </section>;
}
