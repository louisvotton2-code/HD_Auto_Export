import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { Alert, App, Badge, Button, Card, Empty, Image, Input, Modal, Pagination, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  AdminHomeSectionsResponseSchema, AdminVehicleListSchema, AdminVehicleResponseSchema, SaveHomeSectionsRequestSchema,
  ExternalListingListResponseSchema, ExternalListingResponseSchema,
  type AdminHomeSection, type AdminHomeSections, type AdminVehicle,
} from '@hd/contracts/admin';
import { ExternalListingIdSchema, PublicHomeSectionsSchema, type Locale, type PublicHomeSections } from '@hd/contracts/public';
import { ApiClientError, request } from '../../shared/api/client';
import { externalRoot, platformName } from '../external-sources/external-labels';
import { availabilityLabels } from '../vehicles/draft-form';
import styles from './home-sections.module.css';
import { addHomeVehicleId, isHomeEligible, reorderHomeVehicleId, type HomeVehicle } from './home-sections-model';
import { HomeVehicleOrder } from './home-vehicle-order';

const { Title, Text, Paragraph } = Typography;
const localeLabels = { zh: '中文', en: '英文', ru: '俄文' };
const sourceLabels = { staff: '添加精品车辆', supplier: '添加三方车辆' };
type PickerSource = keyof typeof sourceLabels;
const candidatePageSize = 12;
const isDemo = (vehicle: AdminVehicle) => String(vehicle.draft.source.kind) === 'demo';
const vehicleName = (vehicle: AdminVehicle) => [vehicle.draft.facts.make?.name, vehicle.draft.facts.model?.name].filter(Boolean).join(' ') || vehicle.draft.content.title.sourceText || '车辆资料待补充';
function inventoryTag(availability: AdminVehicle['availability']) {
  return <Tag color={availability === 'available' ? 'success' : availability === 'reserved' ? 'warning' : 'default'}>{availabilityLabels[availability]}</Tag>;
}
const thumbnail = (vehicle: AdminVehicle) => {
  const image = vehicle.draft.media.find(item => item.isCover) ?? vehicle.draft.media[0];
  return image ? `/api/v1/admin/media/${encodeURIComponent(image.id)}/preview` : undefined;
};

async function readHomeVehicle(id: string, signal?: AbortSignal): Promise<HomeVehicle> {
  if (!ExternalListingIdSchema.safeParse(id).success) {
    return (await request(`/api/v1/admin/vehicles/${encodeURIComponent(id)}`, AdminVehicleResponseSchema, { signal })).data;
  }
  const { data } = await request(`${externalRoot}/listings/${encodeURIComponent(id)}?locale=zh`, ExternalListingResponseSchema, { signal });
  if (data.id !== id) throw new Error('返回的三方车源与所选编号不一致，请重新搜索。');
  return {
    id: data.id, stockCode: data.inquiryCode ?? data.id,
    title: data.vehicle?.content.title.text || data.source?.copy.title?.original.text || data.identity.externalId,
    platform: platformName(data.identity.platformId),
    eligible: data.state === 'published' && data.vehicle?.id === id,
  };
}

async function readHomeCandidates(source: PickerSource, page: number, keyword: string, signal: AbortSignal) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(candidatePageSize) });
  if (keyword) query.set('q', keyword);
  if (source === 'staff') {
    query.set('publicationState', 'published');
    const { data } = await request(`/api/v1/admin/vehicles?${query}`, AdminVehicleListSchema, { signal });
    return { items: data.items, total: data.total };
  }
  query.set('state', 'published'); query.set('locale', 'zh');
  const { data } = await request(`${externalRoot}/listings?${query}`, ExternalListingListResponseSchema, { signal });
  return { total: data.total, items: data.items.map(listing => ({
    id: listing.id, stockCode: listing.inquiryCode ?? listing.id,
    title: listing.title ?? listing.facts?.model?.name ?? listing.externalId,
    platform: platformName(listing.platformId), eligible: listing.state === 'published',
  })) };
}

export function HomeSectionsPage() {
  const { modal, message } = App.useApp();
  const [base, setBase] = useState<AdminHomeSections | null>(null);
  const [draft, setDraft] = useState<AdminHomeSections | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ordering, setOrdering] = useState<number | null>(null);
  const orderingRef = useRef<number | null>(null);
  const editingLocked = saving || ordering !== null;
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [ineligibleIds, setIneligibleIds] = useState<Set<string>>(() => new Set());
  const [latest, setLatest] = useState<AdminHomeSections | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [vehicleCache, setVehicleCache] = useState<Record<string, HomeVehicle | null>>({});
  const [referenceErrors, setReferenceErrors] = useState<Record<string, string>>({});
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referenceRefresh, setReferenceRefresh] = useState(0);
  const [selecting, setSelecting] = useState<{ index: number; source: PickerSource } | null>(null);
  const [candidatePage, setCandidatePage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidates, setCandidates] = useState<{ items: HomeVehicle[]; total: number } | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [checkingCandidate, setCheckingCandidate] = useState<string | null>(null);
  const pickerCheck = useRef<AbortController | null>(null);
  const [candidateError, setCandidateError] = useState('');
  const [publicLocale, setPublicLocale] = useState<Locale>('zh');
  const [publicResult, setPublicResult] = useState<PublicHomeSections['data'] | null>(null);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicError, setPublicError] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const cacheRef = useRef(vehicleCache);
  cacheRef.current = vehicleCache;
  const dirty = Boolean(base && draft && JSON.stringify(base) !== JSON.stringify(draft));
  const protectedRef = useRef(false);
  protectedRef.current = dirty || saving;
  const blocker = useBlocker(() => protectedRef.current || inFlight.current);
  const leaving = useRef(false);
  const publicSequence = useRef(0);
  const reloadConfirming = useRef(false);
  const reloadDialog = useRef<{ destroy: () => void } | null>(null);
  const selectedIds = [...new Set(draft?.sections.flatMap(section => section.vehicleIds) ?? [])];
  const selectedKey = selectedIds.slice().sort().join(',');

  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; reloadDialog.current?.destroy(); pickerCheck.current?.abort();
  }; }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('admin:dirty', { detail: dirty || saving }));
    const beforeUnload = (event: BeforeUnloadEvent) => { if (protectedRef.current || inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.dispatchEvent(new CustomEvent('admin:dirty', { detail: false })); };
  }, [dirty, saving]);
  useEffect(() => {
    if (blocker.state !== 'blocked' || leaving.current) return;
    leaving.current = true;
    modal.confirm({
      title: '离开首页配置？', content: '未保存的区块标题、车辆选择和排序将丢失。', okText: '放弃修改并离开', cancelText: '继续编辑',
      onOk: () => { leaving.current = false; blocker.proceed?.(); },
      onCancel: () => { leaving.current = false; blocker.reset?.(); },
    });
  }, [blocker, modal]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    request('/api/v1/admin/home/vehicle-sections', AdminHomeSectionsResponseSchema, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) { setBase(response.data); setDraft(response.data); setLatest(null); setIneligibleIds(new Set()); } })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '首页配置读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadVersion]);
  useEffect(() => {
    const ids = selectedKey ? selectedKey.split(',') : [];
    const pending = ids.filter(id => !(id in cacheRef.current) || referenceRefresh > 0);
    if (!pending.length) { setReferencesLoading(false); return; }
    const controller = new AbortController();
    setReferencesLoading(true);
    Promise.all(pending.map(async id => {
      try {
        return { id, vehicle: await readHomeVehicle(id, controller.signal), error: '' };
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 404) return { id, vehicle: null, error: '' };
        return { id, vehicle: undefined, error: failure instanceof Error ? failure.message : '车辆状态读取失败。' };
      }
    })).then(values => {
      if (controller.signal.aborted) return;
      setVehicleCache(current => { const next = { ...current }; for (const value of values) if (value.vehicle !== undefined) next[value.id] = value.vehicle; return next; });
      setReferenceErrors(current => { const next = { ...current }; for (const value of values) { if (value.error) next[value.id] = value.error; else delete next[value.id]; } return next; });
    }).finally(() => { if (!controller.signal.aborted) setReferencesLoading(false); });
    return () => controller.abort();
  }, [selectedKey, referenceRefresh]);
  useEffect(() => {
    if (selecting === null) return;
    const controller = new AbortController();
    setCandidateLoading(true); setCandidateError(''); setCandidates(null);
    readHomeCandidates(selecting.source, candidatePage, candidateQuery, controller.signal)
      .then(result => { if (!controller.signal.aborted) setCandidates(result); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setCandidateError(failure instanceof Error ? failure.message : '候选车辆读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setCandidateLoading(false); });
    return () => controller.abort();
  }, [selecting, candidatePage, candidateQuery]);
  useEffect(() => { publicSequence.current += 1; setPublicResult(null); setPublicError(''); setPublicLoading(false); }, [publicLocale, base?.version]);

  function updateSection(index: number, update: (section: AdminHomeSection) => AdminHomeSection) {
    if (inFlight.current || orderingRef.current !== null) return;
    setDraft(current => current ? { ...current, sections: current.sections.map((section, position) => position === index ? update(section) : section) } : current);
    setFieldErrors([]);
  }
  function openPicker(index: number, source: PickerSource) {
    setSelecting({ index, source }); setCandidatePage(1); setSearchText(''); setCandidateQuery(''); setCandidates(null);
  }
  function closePicker() {
    pickerCheck.current?.abort(); pickerCheck.current = null;
    setCheckingCandidate(null); setSelecting(null);
  }
  function addVehicle(index: number, vehicle: HomeVehicle, placement: 'start' | 'end' = 'end') {
    const section = draft?.sections[index];
    if (saving || inFlight.current || orderingRef.current !== null || !section || !isHomeEligible(vehicle) || section.vehicleIds.includes(vehicle.id) || section.vehicleIds.length >= 30) return;
    setVehicleCache(current => ({ ...current, [vehicle.id]: vehicle }));
    updateSection(index, current => ({ ...current, vehicleIds: addHomeVehicleId(current.vehicleIds, vehicle, placement) }));
    void message.success(`${vehicle.stockCode} 已加入区块 ${index + 1}${placement === 'start' ? '顶部' : '末尾'}，保存后生效。`);
  }
  async function chooseVehicle(vehicle: HomeVehicle, placement: 'start' | 'end') {
    if (!selecting || pickerCheck.current || !isHomeEligible(vehicle)) return;
    if ('draft' in vehicle) { addVehicle(selecting.index, vehicle, placement); return; }
    const controller = new AbortController();
    pickerCheck.current = controller; setCheckingCandidate(vehicle.id);
    try {
      const latest = await readHomeVehicle(vehicle.id, controller.signal);
      if (controller.signal.aborted) return;
      if (!isHomeEligible(latest)) {
        setCandidates(current => current && { ...current, items: current.items.map(item => item.id === latest.id ? latest : item) });
        void message.warning('该三方车源当前无法公开展示，暂不能加入首页。');
        return;
      }
      addVehicle(selecting.index, latest, placement);
    } catch (failure) {
      if (!controller.signal.aborted) void message.error(failure instanceof Error ? failure.message : '三方车源核对失败，请重试。');
    } finally {
      if (pickerCheck.current === controller) { pickerCheck.current = null; setCheckingCandidate(null); }
    }
  }
  function move(index: number, id: string, target: number) {
    updateSection(index, section => ({ ...section, vehicleIds: reorderHomeVehicleId(section.vehicleIds, id, target) }));
  }
  async function save() {
    if (!draft || inFlight.current || orderingRef.current !== null) return;
    setError(''); setFieldErrors([]); setIneligibleIds(new Set());
    const parsed = SaveHomeSectionsRequestSchema.safeParse(draft);
    if (!parsed.success) {
      const labels = parsed.error.issues.map(issue => {
        const index = typeof issue.path[1] === 'number' ? issue.path[1] + 1 : null;
        const language = typeof issue.path[3] === 'string' ? localeLabels[issue.path[3] as keyof typeof localeLabels] : null;
        return index ? `区块 ${index}${language ? `的${language}标题` : '的车辆选择'}：请检查内容、数量和是否重复。` : '请检查首页配置内容。';
      });
      setFieldErrors([...new Set(labels)]); setError('请补齐中英俄区块标题，并检查车辆选择。'); return;
    }
    inFlight.current = true; setSaving(true);
    try {
      const ids = [...new Set(parsed.data.sections.flatMap(section => section.vehicleIds))];
      const currentVehicles = await Promise.all(ids.map(async id => {
        try { return await readHomeVehicle(id); }
        catch (failure) { if (failure instanceof ApiClientError && failure.status === 404) return null; throw failure; }
      }));
      if (!mounted.current) return;
      setVehicleCache(current => ({ ...current, ...Object.fromEntries(ids.map((id, index) => [id, currentVehicles[index] ?? null])) }));
      if (currentVehicles.some(vehicle => !vehicle || !isHomeEligible(vehicle))) {
        setError('部分已选车辆已下架、删除或不符合公开展示条件，请先移除标记项。'); return;
      }
      const response = await request('/api/v1/admin/home/vehicle-sections', AdminHomeSectionsResponseSchema, { method: 'PUT', body: JSON.stringify(parsed.data) });
      if (!mounted.current) return;
      setBase(response.data); setDraft(response.data); setLatest(null); setError('');
      void message.success('首页区块已保存。可在下方读取公开数据核对展示内容。');
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof Error ? failure.message : '保存未完成，请保留当前编辑并核对服务端状态。');
      if (failure instanceof ApiClientError && failure.status === 422 && failure.code === 'PUBLISH_VALIDATION_FAILED') {
        const matches = failure.fields.flatMap(field => {
          if (field.code !== 'HOME_VEHICLE_NOT_ELIGIBLE') return [];
          const path = /^sections\.(\d+)\.vehicleIds\.(\d+)$/.exec(field.path);
          if (!path) return [];
          const section = Number(path[1]);
          const position = Number(path[2]);
          const id = parsed.data.sections[section]?.vehicleIds[position];
          if (!id) return [];
          const label = cacheRef.current[id]?.stockCode ?? id;
          return [{ id, label: `区块 ${section + 1} 第 ${position + 1} 辆（${label}）` }];
        });
        if (matches.length) {
          setIneligibleIds(new Set(matches.map(match => match.id)));
          setFieldErrors([...new Set(matches.map(match => match.label))]);
          setError('保存时发现部分车辆已不符合首页展示条件，当前选择和顺序已保留。请移除标记的车辆后重试。');
        }
      }
      if (failure instanceof ApiClientError && failure.status === 409) {
        try { setLatest((await request('/api/v1/admin/home/vehicle-sections', AdminHomeSectionsResponseSchema)).data); }
        catch { /* The local draft stays intact; explicit retry remains available. */ }
      }
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  async function reloadLatest() {
    if (inFlight.current || reloadConfirming.current || orderingRef.current !== null) return;
    reloadConfirming.current = true;
    const dialog = modal.confirm({
      title: '放弃本地修改并载入最新配置？', content: '当前未保存的区块标题、车辆选择和顺序会被服务端最新配置替换。', okText: '载入最新配置', cancelText: '继续编辑',
    });
    reloadDialog.current = dialog;
    const accepted = await dialog;
    reloadConfirming.current = false; reloadDialog.current = null;
    if (!accepted || !mounted.current) return;
    // Confirmation is complete before reading. Lock edits until the replacement is known.
    inFlight.current = true; setSaving(true);
    try {
      const current = (await request('/api/v1/admin/home/vehicle-sections', AdminHomeSectionsResponseSchema)).data;
      if (!mounted.current) return;
      setBase(current); setDraft(current); setLatest(null); setError(''); setFieldErrors([]); setIneligibleIds(new Set()); setReferenceRefresh(value => value + 1);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '读取最新配置失败，当前编辑已保留。');
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  async function readPublic() {
    const sequence = ++publicSequence.current;
    setPublicLoading(true); setPublicError(''); setPublicResult(null);
    try {
      const response = await request(`/api/v1/home/vehicles?locale=${publicLocale}&view=localized`, PublicHomeSectionsSchema);
      if (mounted.current && sequence === publicSequence.current) setPublicResult(response.data);
    } catch (failure) { if (mounted.current && sequence === publicSequence.current) setPublicError(failure instanceof Error ? failure.message : '公开首页读取失败。'); }
    finally { if (mounted.current && sequence === publicSequence.current) setPublicLoading(false); }
  }
  function vehicleCell(id: string, showInventory = true, vehicle = vehicleCache[id]) {
    if (!vehicle) return <Space orientation="vertical" size={2}><Text strong>{id in vehicleCache ? '车辆不存在，请移除' : referenceErrors[id] ? '车辆状态读取失败，请重试' : '正在读取车辆资料…'}</Text><Text type="secondary">保留的配置记录</Text></Space>;
    const eligible = isHomeEligible(vehicle) && (!showInventory || !ineligibleIds.has(id));
    if (!('draft' in vehicle)) return <Space orientation="vertical" size={2}>
      <Text strong>{vehicle.title}</Text><Text type="secondary">{vehicle.stockCode}</Text>
      {!showInventory && vehicle.stockCode !== vehicle.id && <Text type="secondary">{vehicle.id}</Text>}
      {showInventory && <Tag color="blue">三方车源 · {vehicle.platform}</Tag>}
      {!eligible && <Tag color="error">{showInventory ? '不符合推荐条件，请移除' : '暂不能公开展示'}</Tag>}
    </Space>;
    const image = thumbnail(vehicle);
    return <Space align="start"><div className={styles.thumbnail}>{image ? <Image src={image} alt="车辆封面" width={68} height={48} preview={false} /> : <span>暂无图片</span>}</div><Space orientation="vertical" size={2}><Text strong>{vehicleName(vehicle)}</Text><Text type="secondary">{vehicle.stockCode}</Text>{isDemo(vehicle) && <Tag color="gold">展示样例，非实际库存</Tag>}{showInventory && vehicle.draft.source.kind === 'manual' && inventoryTag(vehicle.availability)}{!eligible && <Tag color="error">不符合推荐条件，请移除</Tag>}</Space></Space>;
  }

  if (loading) return <Card><Spin tip="正在读取首页配置…"><div style={{ minHeight: 160 }} /></Spin></Card>;
  if (!draft) return <Alert type="error" title="首页配置读取失败" description={error} action={<Button onClick={() => setReloadVersion(value => value + 1)}>重试</Button>} />;
  return <div className={styles.page}>
    <div className={styles.pageHeader}><div><Text className={styles.eyebrow}>CONTENT / HOME</Text><Title level={2}>首页车源配置</Title><Paragraph type="secondary">设置两个车源区块的标题、车辆与顺序。保存后，再读取公开首页数据核对。</Paragraph></div><Tag color={dirty ? 'processing' : 'default'}>{dirty ? '有未保存的修改' : `当前配置版本 ${draft.version}`}</Tag></div>
    <Alert type="info" showIcon title="推荐范围" description="从精品车辆或三方车源选择。精品车可保留已预订和已售状态，三方车源须符合公开展示条件。" />
    {error && <Alert type="error" showIcon title={error} description={fieldErrors.length ? <ul>{fieldErrors.map(field => <li key={field}>{field}</li>)}</ul> : undefined} action={latest ? <Button onClick={() => void reloadLatest()}>比较后载入最新配置</Button> : undefined} />}
    {latest && <Alert type="warning" showIcon title={`服务端已有配置版本 ${latest.version}，当前编辑已保留`} description={<Space orientation="vertical" size={6}>{latest.sections.map((section, index) => <Text key={section.id}>最新区块 {index + 1}：{section.title.zh} / {section.title.en} / {section.title.ru} · {section.vehicleIds.length} 辆</Text>)}</Space>} action={<Button onClick={() => void reloadLatest()}>放弃本地修改并载入最新</Button>} />}
    {Object.keys(referenceErrors).length > 0 && <Alert type="warning" title="部分车辆资料未能读取" action={<Button onClick={() => setReferenceRefresh(value => value + 1)} loading={referencesLoading}>重新核对</Button>} />}
    {draft.sections.map((section, index) => <Card key={section.id} title={<Space wrap style={{ maxWidth: '100%' }}><Badge count={index + 1} color="#315b50" /><span>车源区块 {index + 1}</span><Tag>{section.vehicleIds.length} / 30 辆</Tag></Space>} extra={<Space wrap>
      <Button icon={<PlusOutlined />} disabled={editingLocked || section.vehicleIds.length >= 30} onClick={() => openPicker(index, 'staff')}>{sourceLabels.staff}</Button>
      <Button icon={<PlusOutlined />} disabled={editingLocked || section.vehicleIds.length >= 30} onClick={() => openPicker(index, 'supplier')}>{sourceLabels.supplier}</Button>
    </Space>}>
      <div className={styles.titles}>{(['zh', 'en', 'ru'] as const).map(locale => <label key={locale}><Text strong>{localeLabels[locale]}标题 <Text type="danger">*</Text></Text><Input aria-label={`区块 ${index + 1}${localeLabels[locale]}标题`} value={section.title[locale]} maxLength={120} disabled={editingLocked} placeholder={`输入${localeLabels[locale]}区块标题`} onChange={event => updateSection(index, current => ({ ...current, title: { ...current.title, [locale]: event.target.value } }))} /></label>)}</div>
      {section.vehicleIds.length ? <HomeVehicleOrder sectionNumber={index + 1} ids={section.vehicleIds}
        disabled={saving || (ordering !== null && ordering !== index)} renderVehicle={id => vehicleCell(id)}
        vehicleLabel={id => vehicleCache[id]?.stockCode ?? id}
        onMove={(id, target) => move(index, id, target)}
        onRemove={id => updateSection(index, current => ({ ...current, vehicleIds: current.vehicleIds.filter(value => value !== id) }))}
        onBusyChange={active => { orderingRef.current = active ? index : null; setOrdering(active ? index : null); }}
      /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未添加车辆" />}
    </Card>)}
    <div className={styles.saveBar}><Space><Badge status={dirty ? 'processing' : 'default'} /><Text>{dirty ? '修改尚未保存' : '配置已与服务端同步'}</Text></Space><Space wrap><Button onClick={() => void reloadLatest()} disabled={editingLocked || !dirty}>放弃本地修改</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty || editingLocked || Boolean(latest)} onClick={() => void save()}>保存首页配置</Button></Space></div>
    <Card title="核对公开首页数据" extra={<Space wrap><Select aria-label="首页公开语言" value={publicLocale} style={{ width: 100 }} onChange={setPublicLocale} options={Object.entries(localeLabels).map(([value, label]) => ({ value, label }))} /><Button icon={<ReloadOutlined />} loading={publicLoading} onClick={() => void readPublic()}>读取公开首页</Button></Space>}>
      <Paragraph type="secondary">这里显示公共接口的实际返回。空区块不会出现在公开数据中。</Paragraph>
      {publicError && <Alert type="error" title={publicError} />}
      {publicResult && (publicResult.sections.length ? <div className={styles.publicSections}>{publicResult.sections.map(section => <Card size="small" key={section.id} title={section.title}><Space orientation="vertical">{section.vehicles.map(vehicle => <Space key={vehicle.id} wrap><Text strong>{vehicle.content.title.text}</Text><Text type="secondary">{vehicle.stockCode}</Text>{String(vehicle.source.kind) === 'demo' && <Tag color="gold">展示样例，非实际库存</Tag>}{vehicle.source.kind === 'external' && <Tag color="blue">外部挂牌 · {vehicle.source.platform.name}</Tag>}{vehicle.source.kind === 'manual' && inventoryTag(vehicle.availability)}</Space>)}</Space></Card>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可公开的首页区块" />)}
    </Card>
    <Modal title={selecting && sourceLabels[selecting.source]} open={selecting !== null} width={900} footer={<Button onClick={closePicker}>完成选择</Button>} onCancel={closePicker} destroyOnHidden>
      <Input.Search aria-label={selecting?.source === 'supplier' ? '搜索三方车辆' : '搜索精品车辆'}
        placeholder={selecting?.source === 'supplier' ? '输入车源 ID、询价编号、车型或标题' : '输入车号、品牌、车型或标题'}
        maxLength={selecting?.source === 'supplier' ? 2048 : 100} value={searchText} disabled={checkingCandidate !== null} onChange={event => setSearchText(event.target.value)}
        onSearch={value => { setCandidateQuery(value.replaceAll('\0', '').trim()); setCandidatePage(1); }} enterButton="搜索" allowClear />
      {candidateError && <Alert type="error" title={candidateError} />}
      <Table<HomeVehicle> rowKey="id" size="small" loading={candidateLoading} pagination={false} scroll={{ x: 610 }} dataSource={candidates?.items ?? []} locale={{ emptyText: candidateError ? '读取失败，请重新搜索' : '没有符合条件的车辆' }} columns={[
        { title: '车辆', render: (_, vehicle) => vehicleCell(vehicle.id, false, vehicle) },
        { title: selecting?.source === 'supplier' ? '来源平台' : '库存状态', width: 130, render: (_, vehicle) => !('draft' in vehicle)
          ? <Tag color="blue">{vehicle.platform}</Tag>
          : isDemo(vehicle) ? <Tag color="gold">展示样例</Tag>
          : vehicle.draft.source.kind === 'external' ? <Tag color="blue">外部挂牌 · 库存未知</Tag> : inventoryTag(vehicle.availability) },
        { title: '选择', width: 130, render: (_, vehicle) => {
          const section = selecting && draft.sections[selecting.index];
          const chosen = section?.vehicleIds.includes(vehicle.id);
          const cannotAdd = !section || chosen || editingLocked || checkingCandidate !== null || !isHomeEligible(vehicle) || section.vehicleIds.length >= 30;
          return <Space orientation="vertical" size={4}><Button size="small" type={chosen ? 'default' : 'primary'} disabled={cannotAdd} onClick={() => void chooseVehicle(vehicle, 'end')}>{chosen ? '已加入区块' : checkingCandidate === vehicle.id ? '正在核对…' : '加入此区块'}</Button>
            {!chosen && <Button size="small" disabled={cannotAdd} onClick={() => void chooseVehicle(vehicle, 'start')}>加入顶部</Button>}</Space>;
        } },
      ]} />
      <div className={styles.candidatePagination}><Text type="secondary">共 {candidates?.total ?? 0} 辆匹配车辆</Text><Pagination current={candidatePage} pageSize={candidatePageSize} total={candidates?.total ?? 0} showSizeChanger={false} disabled={checkingCandidate !== null} onChange={setCandidatePage} /></div>
    </Modal>
  </div>;
}
