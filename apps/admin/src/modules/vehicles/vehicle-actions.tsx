import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Alert, App, Button, Card, Descriptions, Divider, Form, Image, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloudUploadOutlined, EyeOutlined, LinkOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import { AdminVehicleResponseSchema, type AdminVehicle, type Availability, type StaffMe } from '@hd/contracts/admin';
import { PublicVehicleResponseSchema, type Locale, type PublicVehicle } from '@hd/contracts/public';
import { ApiClientError, request } from '../../shared/api/client';
import { readVehicleLifecycle } from '../../shared/api/vehicle-lifecycle';
import { availabilityLabels, formatTime, publicationLabels } from './draft-form';
import { keepPublishIntent, makePublishIntent, publicationAttemptExpired, publicationControlState, publicationFeedback, publicationIssueLabel, type PublishIntent } from './vehicle-actions-model';
import styles from './vehicle-actions.module.css';

type Props = {
  vehicle: AdminVehicle;
  hasUnsavedChanges: boolean;
  disabled?: boolean;
  onUpdated: (vehicle: AdminVehicle) => void;
  onConflict?: () => void;
  onLocalizationIssue?: () => void;
  onBusyChange?: (busy: boolean) => void;
};

type Operation = 'availability' | 'publish' | 'archive';
const operationLabels = { availability: '库存核验', publish: '发布', archive: '下架' };
const localeLabels = { zh: '中文', en: '英文', ru: '俄文' };

function proposedAvailability(vehicle: AdminVehicle): Availability {
  return vehicle.publicationState === 'draft' && vehicle.availability === 'unknown' && vehicle.availabilityCheckedAt === null ? 'available' : vehicle.availability;
}

export function VehicleActions({ vehicle, hasUnsavedChanges, disabled = false, onUpdated, onConflict, onLocalizationIssue, onBusyChange }: Props) {
  const staff = useOutletContext<StaffMe>();
  const { modal, message: toast } = App.useApp();
  const canWrite = staff.permissions.includes('vehicles:write');
  const canPublish = staff.permissions.includes('vehicles:publish');
  const [availability, setAvailability] = useState<Availability>(() => proposedAvailability(vehicle));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [activeOperation, setActiveOperation] = useState<Operation | 'reconcile' | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [success, setSuccess] = useState('');
  const [latest, setLatest] = useState<AdminVehicle | null>(null);
  const [locale, setLocale] = useState<Locale>('zh');
  const [publicVehicle, setPublicVehicle] = useState<PublicVehicle | null>(null);
  const [publicError, setPublicError] = useState('');
  const [publicLoading, setPublicLoading] = useState(false);
  const inFlight = useRef(false);
  const actionGuard = useRef(false);
  const publicInFlight = useRef(false);
  const mounted = useRef(true);
  const publishIntent = useRef<PublishIntent | null>(null);
  const parentBusy = useRef(onBusyChange);
  parentBusy.current = onBusyChange;
  const publicRequest = useRef(0);
  const confirmation = useRef<{ cancel(): void } | null>(null);
  const isDemo = String(vehicle.draft.source.kind) === 'demo';
  const isExternal = vehicle.draft.source.kind === 'external';
  const allowsPending = isDemo || isExternal;
  const locked = unconfirmed !== null;
  const unavailable = disabled || hasUnsavedChanges || busy || confirming || locked;
  const publicationStatus = publicationControlState(vehicle);
  const canReadPublic = vehicle.publicationState === 'published';
  const publicUrl = `/api/v1/vehicles/${encodeURIComponent(vehicle.id)}?locale=${locale}&view=localized`;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; confirmation.current?.cancel(); parentBusy.current?.(false); }; }, []);
  useEffect(() => { parentBusy.current?.(busy || confirming || locked); }, [busy, confirming, locked]);
  useEffect(() => { setAvailability(proposedAvailability(vehicle)); }, [vehicle.id, vehicle.availability, vehicle.availabilityCheckedAt, vehicle.publicationState, vehicle.version]);
  useEffect(() => {
    publicRequest.current += 1; publicInFlight.current = false;
    setPublicVehicle(null); setPublicError(''); setPublicLoading(false);
  }, [vehicle.id, vehicle.version, locale]);

  async function confirmAction(title: string, content: string, danger = false): Promise<boolean> {
    if (confirmation.current || !mounted.current) return false;
    setConfirming(true); parentBusy.current?.(true);
    return new Promise<boolean>(resolve => {
      let settled = false;
      const settle = (accepted: boolean) => {
        if (settled) return;
        settled = true; confirmation.current = null;
        if (mounted.current) setConfirming(false);
        resolve(accepted);
      };
      const instance = modal.confirm({ title, content, okText: '确认操作', cancelText: '取消', okButtonProps: { danger }, onOk: () => settle(true), onCancel: () => settle(false), afterClose: () => settle(false) });
      confirmation.current = { cancel: () => { instance.destroy(); settle(false); } };
    });
  }

  function start(operation: Operation | 'reconcile') {
    setActiveOperation(operation);
    inFlight.current = true; setBusy(true); setError(''); setIssues([]); setSuccess(''); setLatest(null);
    parentBusy.current?.(true);
  }
  function stop() { inFlight.current = false; if (mounted.current) { setBusy(false); setActiveOperation(null); } }
  function accept(next: AdminVehicle) {
    publishIntent.current = null; setUnconfirmed(null); setLatest(null); onUpdated(next);
  }

  async function perform(operation: Operation) {
    // This synchronous latch covers confirmation as well as the subsequent HTTP request.
    if (actionGuard.current) return;
    actionGuard.current = true;
    try { await performMutation(operation); }
    finally { actionGuard.current = false; }
  }

  async function performMutation(operation: Operation) {
    if (inFlight.current || confirmation.current || confirming || disabled || hasUnsavedChanges || (operation === 'availability' && allowsPending) || (locked && operation !== 'publish')) return;
    if ((operation === 'publish' && !canPublish) || (operation !== 'publish' && !canWrite)) return;
    const wasUncertain = unconfirmed === 'publish';
    if (locked && !wasUncertain) return;
    // Retry the original idempotent intent even if a later snapshot now says there are no new edits.
    if (operation === 'publish' && !wasUncertain && publicationStatus.blocked) return;
    if (operation === 'publish') {
      if (!publishIntent.current) publishIntent.current = makePublishIntent(vehicle, crypto.randomUUID(), Date.now());
      if (publicationAttemptExpired(publishIntent.current, Date.now())) {
        setError('本次发布请求已超过 24 小时，请先读取当前状态核对结果，再决定下一步。');
        setUnconfirmed('publish'); void toast.warning('原发布请求已超过24小时，请先读取当前状态。'); return;
      }
      if (!wasUncertain && !await confirmAction('发布当前已保存的草稿？', isDemo ? '这是展示样例，不是实际库存。公开页面将显示样例标记，并保留待询价、库存未知等真实状态。' : isExternal ? '这是外部挂牌资料，不代表自有现货。公开展示来源与采集时间，保留参考价格或待询价、库存未知与未经人工审核标记。请先核对每张图片的来源与使用依据。' : '这会更新公开展示内容。内部采购成本、供应商联系方式和内部备注不会公开。')) { publishIntent.current = null; return; }
    } else if (operation === 'archive') {
      if (!await confirmAction('下架这辆车？', '下架后公开详情返回不存在，车辆退出公开列表；后台草稿和历史记录保留。', true)) return;
    } else if (!await confirmAction('确认库存核验结果', `你已实际核验库存为“${availabilityLabels[availability]}”，将记录当前核验时间。已售车辆会立即退出公开在售列表，恢复可售也会立即生效。`, availability === 'sold')) return;

    if (!mounted.current) return;
    const body = operation === 'publish' ? publishIntent.current!.body
      : JSON.stringify(operation === 'availability' ? { version: vehicle.version, availability, checkedAt: new Date().toISOString() } : { version: vehicle.version });
    start(operation);
    let mutationAcknowledged = false;
    try {
      const response = await request(`/api/v1/admin/vehicles/${encodeURIComponent(vehicle.id)}/${operation}`, AdminVehicleResponseSchema, {
        method: 'POST', body,
        headers: operation === 'publish' ? { 'Idempotency-Key': publishIntent.current!.key } : undefined,
      });
      mutationAcknowledged = true;
      const current = operation === 'publish' ? (await readVehicleLifecycle(vehicle.id)).vehicle : response.data;
      if (!mounted.current) return;
      accept(current);
      const feedback = operation === 'publish' ? publicationFeedback(response.data, current)
        : { tone: 'success' as const, text: operation === 'availability' ? '库存状态和核验时间已更新；草稿内容没有发布。' : '车辆已下架，公开详情不再可见。' };
      setSuccess(feedback.text);
      if (feedback.tone === 'success') void toast.success(feedback.text); else void toast.info(feedback.text);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof Error ? failure.message : '操作未完成，请保留页面并核对结果。');
      if (failure instanceof ApiClientError) {
        setIssues([...new Set(failure.fields.map(field => publicationIssueLabel(field.path)))]);
        if (failure.fields.some(field => field.path.replace(/^draft\./, '').startsWith('localization.'))) onLocalizationIssue?.();
        const uncertain = mutationAcknowledged || (operation === 'publish' ? keepPublishIntent(failure.status, wasUncertain) : failure.status === 0 || failure.status >= 500);
        if (uncertain) { setUnconfirmed(operation); void toast.warning(`${operationLabels[operation]}结果尚未确认，请保留页面并核对当前状态。`); }
        else { publishIntent.current = null; setUnconfirmed(null); void toast.error(failure.message); }
        if (failure.status === 409 && !uncertain) onConflict?.();
      } else { setUnconfirmed(operation); void toast.warning(`${operationLabels[operation]}结果尚未确认，请保留页面并核对当前状态。`); }
    } finally { stop(); }
  }

  async function readCurrent() {
    if (inFlight.current || confirmation.current || disabled) return;
    start('reconcile');
    try {
      const response = await request(`/api/v1/admin/vehicles/${encodeURIComponent(vehicle.id)}?includeDeleted=true`, AdminVehicleResponseSchema);
      if (mounted.current) { setLatest(response.data); void toast.success('已读取当前状态，请核对后再选择是否采用。'); }
    } catch (failure) { if (mounted.current) { const detail = failure instanceof Error ? failure.message : '读取当前状态失败，请稍后重试。'; setError(detail); void toast.error(detail); } }
    finally { stop(); }
  }

  async function refreshPublicationStatus() {
    if (inFlight.current || confirmation.current || disabled || hasUnsavedChanges || locked) return;
    start('reconcile');
    try {
      const current = (await readVehicleLifecycle(vehicle.id)).vehicle;
      if (!mounted.current) return;
      accept(current);
      const state = publicationControlState(current);
      setSuccess(state.needsRefresh ? '已读取最新记录，发布差异仍待核对。' : '已更新当前发布状态。');
      if (state.needsRefresh) void toast.info('已读取最新记录，发布差异仍待核对。');
      else void toast.success('已更新当前发布状态。');
    } catch (failure) {
      if (mounted.current) { const detail = failure instanceof Error ? failure.message : '读取发布状态失败，请稍后重试。'; setError(detail); void toast.error(detail); }
    } finally { stop(); }
  }

  async function adoptLatest() {
    if (!latest || inFlight.current || confirmation.current || disabled) return;
    if (!await confirmAction('采用核对到的版本？', '请确认已核对当前状态。这会结束本次结果未确认提示，不会自动再次发布。')) return;
    if (!mounted.current) return;
    accept(latest); setError(''); setIssues([]); setSuccess('已载入核对到的服务端版本，请按实际状态继续操作。'); void toast.success('已采用核对到的当前状态，没有再次执行发布。');
  }

  async function readPublic() {
    if (!canReadPublic || publicInFlight.current) return;
    publicInFlight.current = true;
    const sequence = ++publicRequest.current;
    setPublicLoading(true); setPublicError(''); setPublicVehicle(null);
    try {
      const response = await request(publicUrl, PublicVehicleResponseSchema);
      if (mounted.current && sequence === publicRequest.current) { setPublicVehicle(response.data); void toast.success('已读取当前公开内容。'); }
    } catch (failure) {
      if (mounted.current && sequence === publicRequest.current) {
        const missing = failure instanceof ApiClientError && failure.code === 'NOT_FOUND';
        const detail = missing ? '当前没有这个语言的公开版本，或车辆的发布状态已变化。可切换语言或刷新页面后重试。' : failure instanceof Error ? failure.message : '读取公开数据失败。';
        setPublicError(detail); if (missing) void toast.info('当前没有可读取的公开记录。'); else void toast.error(detail);
      }
    } finally { if (sequence === publicRequest.current) { publicInFlight.current = false; if (mounted.current) setPublicLoading(false); } }
  }

  const titleReady = ['zh', 'en', 'ru'].every(locale => {
    const translation = vehicle.draft.content.title.translations[locale as 'zh' | 'en' | 'ru'];
    return Boolean(translation?.text.trim() && translation.reviewStatus !== 'stale' && (allowsPending || translation.reviewStatus === 'approved') && translation.sourceVersion === vehicle.draft.content.title.sourceVersion);
  });
  const description = vehicle.draft.content.description;
  const descriptionReady = description.sourceText === null && Object.values(description.translations).every(value => value === null) || ['zh', 'en', 'ru'].every(locale => {
    const translation = description.translations[locale as 'zh' | 'en' | 'ru'];
    return Boolean(translation?.text.trim() && translation.reviewStatus !== 'stale' && (allowsPending || translation.reviewStatus === 'approved') && translation.sourceVersion === description.sourceVersion);
  });
  const checks = [
    { label: '基础车辆资料', ready: Boolean(vehicle.draft.facts.make && vehicle.draft.facts.model && (allowsPending || vehicle.draft.facts.location) && vehicle.draft.content.title.sourceText?.trim()) },
    { label: '已选择封面图片', ready: vehicle.draft.media.filter(image => image.isCover).length === 1 },
    { label: allowsPending ? '三语标题已填写' : '三语标题已审核', ready: titleReady },
    { label: allowsPending ? '三语描述已填写或留空' : '三语描述已就绪或留空', ready: descriptionReady },
    { label: isDemo ? '展示样例 · 保留库存未知' : isExternal ? '外部挂牌 · 保留库存未知' : '库存已核验', ready: allowsPending || vehicle.availability !== 'unknown' && Boolean(vehicle.availabilityCheckedAt) },
  ];
  return <section className={styles.panel} aria-labelledby="vehicle-actions-title">
    <Card title={<Space><SafetyCertificateOutlined /><Typography.Title level={4} id="vehicle-actions-title" style={{ margin: 0 }}>库存与发布</Typography.Title></Space>} extra={<Tag color={vehicle.publicationState === 'published' ? 'success' : vehicle.publicationState === 'archived' ? 'default' : 'processing'}>{publicationLabels[vehicle.publicationState]}</Tag>}>
      <div className={styles.summary}>
        <div><Typography.Text type="secondary">当前草稿</Typography.Text><Typography.Title level={4}>版本 {vehicle.version}</Typography.Title><Typography.Text type="secondary">保存草稿只更新后台资料</Typography.Text></div>
        <div><Typography.Text type="secondary">当前公开状态</Typography.Text><Typography.Title level={4}>{publicationLabels[vehicle.publicationState]}</Typography.Title><Typography.Text type="secondary">{vehicle.publishedAt ? formatTime(vehicle.publishedAt) : '尚未首次发布'}</Typography.Text></div>
      </div>
      <Alert className={styles.publicationStatus} showIcon type={hasUnsavedChanges ? 'info' : publicationStatus.tone}
        title={hasUnsavedChanges ? '有尚未保存的修改' : publicationStatus.title}
        description={hasUnsavedChanges ? '请先保存草稿，再检查哪些修改需要发布。当前公开内容不会随输入自动更新。' : publicationStatus.description}
        action={publicationStatus.needsRefresh && !hasUnsavedChanges ? <Button icon={<ReloadOutlined />} loading={busy && activeOperation === 'reconcile'} disabled={unavailable} onClick={() => void refreshPublicationStatus()}>核对发布状态</Button> : undefined} />
      {isDemo && <Alert className={styles.notice} showIcon type="warning" title="展示样例，非实际库存" description="样例保持库存未知和待询价，不作实际可售或已核验承诺。图片与三语内容仍需检查后才能发布。" />}
      {isExternal && <Alert className={styles.notice} showIcon type="info" title="外部挂牌，非自有库存承诺" description="保留库存未知，价格仅为参考或待询价。三语可待审核，公开内容不会标记为人工已审核；每张图片须记录原始来源。" />}
      {hasUnsavedChanges && <Alert className={styles.notice} showIcon type="info" title="请先保存当前修改" description="保存后，再单独操作库存、发布或下架。" />}
      {error && <Alert className={styles.notice} showIcon type="error" title={error} description={issues.length > 0 ? <ul className={styles.issueList}>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : undefined} />}
      {success && <Alert className={styles.notice} showIcon type="success" title={success} />}
      {unconfirmed && <Card size="small" className={styles.reconcileCard} title={`${operationLabels[unconfirmed]}结果尚未确认`}>
        <Alert showIcon type="warning" title="请先核对结果，避免重复操作" description={unconfirmed === 'publish' ? '服务端可能已完成发布。重试会使用原请求及相同幂等标识；其它修改暂时锁定。' : '服务端可能已完成操作。请读取当前状态核对，暂不要重复操作。'} />
        <Space wrap className={styles.buttons}>{unconfirmed === 'publish' && <Button loading={busy && activeOperation === 'publish'} disabled={disabled || !canPublish} onClick={() => void perform('publish')}>重试原发布请求</Button>}<Button icon={<ReloadOutlined />} loading={busy && activeOperation === 'reconcile'} disabled={busy || disabled} onClick={() => void readCurrent()}>读取当前状态</Button></Space>
        {latest && <div className={styles.reconcile}><Descriptions size="small" column={1} items={[{ key: 'version', label: '服务端版本', children: latest.version }, { key: 'state', label: '当前状态', children: `${publicationLabels[latest.publicationState]} · ${availabilityLabels[latest.availability]}` }, { key: 'published', label: '发布时间', children: formatTime(latest.publishedAt) }]} /><Button disabled={busy || disabled} onClick={() => void adoptLatest()}>采用核对到的版本，结束本次重试</Button></div>}
      </Card>}
      <div className={styles.readiness}>
        <Typography.Title level={5}>发布前检查</Typography.Title>
        <Space wrap>{checks.map(check => <Tag key={check.label} color={check.ready ? 'success' : 'warning'} icon={check.ready ? <CheckCircleOutlined /> : undefined}>{check.label}</Tag>)}</Space>
        <Typography.Paragraph type="secondary">以上根据已保存草稿检查。图片处理状态和最终发布条件仍以服务端校验结果为准。</Typography.Paragraph>
      </div>
      {canWrite && !allowsPending && <div className={styles.inventory}>
        <Form.Item label="核验后的库存状态" htmlFor="verified-availability"><Select id="verified-availability" aria-label="核验后的库存状态" value={availability} disabled={unavailable} onChange={setAvailability} options={Object.entries(availabilityLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Button icon={<SafetyCertificateOutlined />} loading={busy && activeOperation === 'availability'} disabled={unavailable} onClick={() => void perform('availability')}>核验并更新库存</Button>
        <Typography.Text type="secondary">当前：{availabilityLabels[vehicle.availability]} · 最近核验：{formatTime(vehicle.availabilityCheckedAt)}。请按实际库存确认后更新。</Typography.Text>
      </div>}
      <div className={styles.publishBar}>
        <Space wrap>{canPublish && <Button type="primary" size="large" icon={<CloudUploadOutlined />} disabled={unavailable || publicationStatus.blocked} loading={busy && activeOperation === 'publish'} onClick={() => void perform('publish')}>{hasUnsavedChanges ? '先保存当前修改' : publicationStatus.actionLabel}</Button>}{canWrite && <Button danger icon={<StopOutlined />} loading={busy && activeOperation === 'archive'} disabled={unavailable || vehicle.publicationState === 'archived'} onClick={() => void perform('archive')}>下架车辆</Button>}</Space>
        <Typography.Text type="secondary">发布后更新公开内容，下架立即撤销公开访问。</Typography.Text>
      </div>
    </Card>
    <Card className={styles.publicArea} title={<Space><EyeOutlined />官网公开内容</Space>} extra={canReadPublic && <Button type="link" icon={<LinkOutlined />} href={publicUrl} target="_blank" rel="noreferrer">查看公开接口响应 ↗</Button>}>
      {canReadPublic ? <div className={styles.publicToolbar}>
        <Form.Item label="公开内容语言" htmlFor="public-content-locale"><Select id="public-content-locale" aria-label="公开内容语言" value={locale} onChange={setLocale} options={Object.entries(localeLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Button icon={<ReloadOutlined />} loading={publicLoading} onClick={() => void readPublic()}>预览官网公开内容</Button>
        <Typography.Text type="secondary">仅展示当前发布版本，不包含未发布草稿与内部资料。</Typography.Text>
      </div> : <Alert showIcon type="info" title={vehicle.publicationState === 'draft' ? '草稿尚未发布' : '车辆已下架'} description="发布后可在这里查看官网访客能读取的内容。" />}
      {publicError && <Alert showIcon type="info" title={publicError} />}
      {canReadPublic && !publicVehicle && !publicError && <div className={styles.publicEmpty}><EyeOutlined /><Typography.Text type="secondary">选择语言后预览已发布的车辆资料。</Typography.Text></div>}
      {canReadPublic && publicVehicle && <article className={styles.publicCard}>
        {String(publicVehicle.source.kind) === 'demo' && <Alert className={styles.notice} showIcon type="warning" title="展示样例，非实际库存" />}
        {publicVehicle.source.kind === 'external' && <Alert className={styles.notice} showIcon type="info" title={`外部挂牌 · ${publicVehicle.source.platform.name}`} description={<Space wrap><a href={publicVehicle.source.listingUrl} target="_blank" rel="noreferrer">查看原始挂牌 ↗</a><span>采集：{formatTime(publicVehicle.fetchedAt)}</span><span>外部资料不代表自有现货，译文未经人工审核。</span></Space>} />}
        <div className={styles.publicHeading}><div><Typography.Text type="secondary">{publicVehicle.stockCode}</Typography.Text><Typography.Title level={3}>{publicVehicle.content.title.text}</Typography.Title></div><Tag color={publicVehicle.availability === 'available' ? 'success' : 'default'}>{availabilityLabels[publicVehicle.availability]}</Tag></div>
        <Typography.Title level={3} className={styles.price}>{publicVehicle.price.kind === 'on_request' ? '待询价' : `${publicVehicle.price.kind === 'reference' ? '参考价格' : '公开报价'} ${publicVehicle.price.money.amount} ${publicVehicle.price.money.currency}`}</Typography.Title>
        {publicVehicle.price.includes.length > 0 && <Typography.Paragraph type="secondary">价格包含：{publicVehicle.price.includes.join('；')}</Typography.Paragraph>}
        <Descriptions column={{ xs: 1, sm: 2 }} size="small" items={[
          { key: 'make', label: '品牌车型', children: `${publicVehicle.facts.make?.name ?? '未填写'} ${publicVehicle.facts.model?.name ?? ''}` },
          { key: 'location', label: '所在地', children: publicVehicle.facts.location?.displayName ?? ([publicVehicle.facts.location?.country, publicVehicle.facts.location?.city].filter(Boolean).join(' / ') || '未填写') },
          { key: 'year', label: '年款', children: publicVehicle.facts.modelYear ?? '未知' },
          { key: 'mileage', label: '里程', children: publicVehicle.facts.mileageKm === null ? '未知' : `${publicVehicle.facts.mileageKm} 公里` },
          { key: 'locale', label: '内容语言', children: `${localeLabels[publicVehicle.content.title.requestedLocale]} · ${publicVehicle.content.title.reviewed ? '已审核' : '未审核'}` },
          { key: 'published', label: '发布于', children: formatTime(publicVehicle.publishedAt) },
        ]} />
        {publicVehicle.content.description && <><Divider /><Typography.Paragraph className={styles.description}>{publicVehicle.content.description.text}</Typography.Paragraph></>}
        <Image.PreviewGroup><div className={styles.images}>{publicVehicle.images.map(image => <figure key={image.id}><Image src={image.url} alt={image.alt} loading="lazy" /><figcaption>{image.isCover ? '封面' : `图片 ${image.sortOrder + 1}`}{image.alt ? ` · ${image.alt}` : ''}</figcaption></figure>)}</div></Image.PreviewGroup>
      </article>}
    </Card>
  </section>;
}
