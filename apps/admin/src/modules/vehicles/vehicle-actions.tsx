import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Alert, App, Button, Card, Checkbox, Descriptions, Divider, Form, Image, Modal, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloudUploadOutlined, EyeOutlined, LinkOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import { AdminVehicleResponseSchema, type AdminVehicle, type Availability, type ConfirmPublicationPreviewRequest, type PublicationIssue, type StaffMe } from '@hd/contracts/admin';
import { PublicVehicleResponseSchema, type Locale, type PublicVehicle } from '@hd/contracts/public';
import { ApiClientError, request } from '../../shared/api/client';
import { readVehicleLifecycle } from '../../shared/api/vehicle-lifecycle';
import { availabilityLabels, formatTime, publicationLabels } from './draft-form';
import { keepPublishIntent, makePublishIntent, publicationAttemptExpired, publicationControlState, publicationFeedback, publicationIssueLabel, publicationReadinessIssueLabel, type PublishIntent } from './vehicle-actions-model';
import styles from './vehicle-actions.module.css';
import { publicationConfirmationIsCurrent, publicationReceiptMatches, usePublicationReadiness } from './use-publication-readiness';

type Props = {
  vehicle: AdminVehicle;
  publishTarget?: HTMLElement | null;
  publicationTabActive: boolean;
  previewLocale: Locale;
  previewReceipt: ConfirmPublicationPreviewRequest | null;
  hasUnsavedChanges: boolean;
  disabled?: boolean;
  onUpdated: (vehicle: AdminVehicle) => void;
  onConflict?: () => void;
  onLocalizationIssue?: () => void;
  onIssue?: (issue: PublicationIssue) => void;
  onBusyChange?: (busy: boolean) => void;
};

type Operation = 'availability' | 'publish' | 'archive';
const operationLabels = { availability: '库存核验', publish: '发布', archive: '下架' };
const localeLabels = { zh: '中文', en: '英文', ru: '俄文' };

function proposedAvailability(vehicle: AdminVehicle): Availability {
  return vehicle.publicationState === 'draft' && vehicle.availability === 'unknown' && vehicle.availabilityCheckedAt === null ? 'available' : vehicle.availability;
}

export function VehicleActions({ publishTarget, publicationTabActive, previewLocale, previewReceipt, vehicle, hasUnsavedChanges, disabled = false, onUpdated, onConflict, onLocalizationIssue, onIssue, onBusyChange }: Props) {
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
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [acknowledgedReceipt, setAcknowledgedReceipt] = useState<string | null>(null);
  const inFlight = useRef(false);
  const actionGuard = useRef(false);
  const publicInFlight = useRef(false);
  const mounted = useRef(true);
  const publishIntent = useRef<PublishIntent | null>(null);
  const parentBusy = useRef(onBusyChange);
  parentBusy.current = onBusyChange;
  const publicRequest = useRef(0);
  const confirmation = useRef<{ cancel(): void } | null>(null);
  const previewConfirmGuard = useRef(false);
  const readiness = usePublicationReadiness({ vehicleId: vehicle.id, version: vehicle.version, locale: previewLocale, onConflict });
  const currentAction = useRef({ vehicle, disabled, hasUnsavedChanges, canPublish, publicationTabActive });
  currentAction.current = { vehicle, disabled, hasUnsavedChanges, canPublish, publicationTabActive };
  const receiptKey = previewReceipt ? JSON.stringify([vehicle.id, previewReceipt.version, previewReceipt.publicContentRevision, previewReceipt.fingerprint, previewReceipt.locale]) : null;
  const previewAcknowledged = receiptKey !== null && acknowledgedReceipt === receiptKey && !hasUnsavedChanges;
  const lastReceipt = useRef<string | null>(null);
  const isDemo = String(vehicle.draft.source.kind) === 'demo';
  const isExternal = vehicle.draft.source.kind === 'external';
  const allowsPending = isDemo || isExternal;
  const locked = unconfirmed !== null;
  const unavailable = disabled || hasUnsavedChanges || busy || confirming || locked || readiness.confirming;
  const publicationStatus = publicationControlState(vehicle);
  const canReadPublic = vehicle.publicationState === 'published';
  const publicUrl = `/api/v1/vehicles/${encodeURIComponent(vehicle.id)}?locale=${locale}&view=localized`;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; confirmation.current?.cancel(); parentBusy.current?.(false); }; }, []);
  useEffect(() => { parentBusy.current?.(busy || confirming || locked || readiness.confirming); }, [busy, confirming, locked, readiness.confirming]);
  useEffect(() => { setAcknowledgedReceipt(null); }, [vehicle.id, vehicle.version, previewLocale, receiptKey, hasUnsavedChanges, publicationTabActive]);
  useEffect(() => { if (!publicationTabActive) setIssuesOpen(false); }, [publicationTabActive]);
  useEffect(() => {
    if (receiptKey && lastReceipt.current !== receiptKey) {
      lastReceipt.current = receiptKey;
      void readiness.reload();
    }
  }, [receiptKey, readiness.reload]);
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
    if (operation === 'publish' && !currentAction.current.publicationTabActive) {
      setError('请先进入发布预览检查后再发布'); return;
    }
    // This synchronous latch covers confirmation as well as the subsequent HTTP request.
    if (actionGuard.current) return;
    actionGuard.current = true;
    try { await performMutation(operation); }
    finally { actionGuard.current = false; }
  }

  async function performMutation(operation: Operation) {
    if (inFlight.current || confirmation.current || confirming || readiness.confirming || previewConfirmGuard.current || disabled || hasUnsavedChanges || (operation === 'availability' && allowsPending) || (locked && operation !== 'publish')) return;
    if ((operation === 'publish' && !canPublish) || (operation !== 'publish' && !canWrite)) return;
    const wasUncertain = unconfirmed === 'publish';
    if (locked && !wasUncertain) return;
    // Retry the original idempotent intent even if a later snapshot now says there are no new edits.
    if (operation === 'publish' && !wasUncertain && publicationStatus.blocked) return;
    if (operation === 'publish') {
      if (wasUncertain && !publishIntent.current) {
        setError('原发布请求已不可用，请先读取当前状态核对结果；没有创建新的发布请求。'); return;
      }
      if (!wasUncertain && !readiness.isPublishReady()) {
        setIssuesOpen(true); setError('请先完成服务端发布检查，并确认当前预览。'); return;
      }
      if (!publishIntent.current) publishIntent.current = makePublishIntent(vehicle, crypto.randomUUID(), Date.now());
      if (publicationAttemptExpired(publishIntent.current, Date.now())) {
        setError('本次发布请求已超过 24 小时，请先读取当前状态核对结果，再决定下一步。');
        setUnconfirmed('publish'); void toast.warning('原发布请求已超过24小时，请先读取当前状态。'); return;
      }
      if (!wasUncertain && !await confirmAction('发布当前已保存的草稿？', isDemo ? '这是展示样例，不是实际库存。公开页面将显示样例标记，并保留待询价、库存未知等真实状态。' : isExternal ? '这是外部挂牌资料，不代表自有现货。公开展示来源与采集时间，保留参考价格或待询价、库存未知等真实来源信息。请先核对每张图片的来源与使用依据。' : '这会更新公开展示内容。内部采购成本、供应商联系方式和内部备注不会公开。')) { publishIntent.current = null; return; }
      // The editor stays mounted across tabs, so old modal handlers must read the current tab.
      // An uncertain original intent is retained for an explicit retry from the preview tab.
      if (!currentAction.current.publicationTabActive) {
        if (!wasUncertain) publishIntent.current = null;
        setError('请先进入发布预览检查后再发布'); return;
      }
      // The preview can expire or the page can receive a new version while the modal is open.
      if (!wasUncertain && (!readiness.isPublishReady() || currentAction.current.disabled || currentAction.current.hasUnsavedChanges || !currentAction.current.canPublish
        || currentAction.current.vehicle.id !== vehicle.id || currentAction.current.vehicle.version !== publishIntent.current.version
        || publicationControlState(currentAction.current.vehicle).blocked)) {
        publishIntent.current = null;
        setError('发布条件已变化或预览确认已过期，请重新核对后再发布。'); setIssuesOpen(true); return;
      }
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
        if (operation === 'publish' && !uncertain) void readiness.reload();
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

  const ready = readiness.ready;
  const receiptMatches = Boolean(ready && previewReceipt && previewReceipt.version === vehicle.version && publicationReceiptMatches(ready, previewReceipt));
  const canConfirmPreview = publicationTabActive && canPublish && !unavailable && !readiness.loading && !readiness.error && receiptMatches
    && Boolean(ready?.requiredFieldsReady && ready.localizationReady);
  const previewCurrent = Boolean(ready && publicationConfirmationIsCurrent(ready));
  const publishAllowed = publicationTabActive && canPublish && !unavailable && !publicationStatus.blocked && readiness.isPublishReady();

  async function confirmCurrentPreview() {
    if (!currentAction.current.publicationTabActive) { setError('请先进入发布预览检查后再发布'); return; }
    if (previewConfirmGuard.current || actionGuard.current || inFlight.current || confirmation.current || !previewAcknowledged || !canConfirmPreview || !previewReceipt
      || currentAction.current.disabled || currentAction.current.hasUnsavedChanges || !currentAction.current.canPublish) return;
    previewConfirmGuard.current = true;
    const receipt = previewReceipt;
    parentBusy.current?.(true);
    try {
      // This is the exact rendered receipt supplied by the parent, not a reconstructed latest payload.
      const result = await readiness.confirm(receipt);
      if (!mounted.current) return;
      if (result.ok) void toast.success('当前预览已确认。');
      else if (result.error) void toast.error(result.error);
    } finally {
      previewConfirmGuard.current = false;
      if (mounted.current) parentBusy.current?.(busy || confirming || locked);
    }
  }
  function navigateIssue(issue: PublicationIssue) {
    setIssuesOpen(false);
    if (onIssue) onIssue(issue);
    else if (issue.stage === 'localization') onLocalizationIssue?.();
  }
  function readinessIssues() {
    return <>
      {hasUnsavedChanges && <Alert showIcon type="info" title="请先保存当前修改，再检查发布条件。" />}
      {readiness.loading && <Alert showIcon type="info" title="正在读取服务端发布检查…" />}
      {readiness.error && <Alert showIcon type="error" title="发布检查未完成" description={readiness.error} />}
      {readiness.expired && <Alert showIcon type="warning" title="预览确认已过期，请重新读取并检查当前预览。" />}
      {ready && <ul className={styles.serverIssues}>{ready.issues.map((issue, index) => <li key={`${issue.stage}:${issue.path}:${issue.code}:${index}`}>
        <Tag>{issue.stage === 'required_fields' ? '车辆资料' : issue.stage === 'localization' ? '公开多语' : '发布预览'}</Tag>
        {onIssue || (issue.stage === 'localization' && onLocalizationIssue)
          ? <Button type="link" disabled={busy || confirming || readiness.confirming || locked} onClick={() => navigateIssue(issue)}>{publicationReadinessIssueLabel(issue)}</Button>
          : <Typography.Text>{publicationReadinessIssueLabel(issue)}</Typography.Text>}
      </li>)}</ul>}
      {ready && !readiness.loading && !readiness.error && !readiness.expired && ready.issues.length === 0
        && <Typography.Paragraph>服务端未报告发布缺项。{publicationStatus.blocked ? publicationStatus.title : '请核对当前预览确认状态，再明确发布。'}</Typography.Paragraph>}
      <Button icon={<ReloadOutlined />} loading={readiness.loading && !readiness.confirming} disabled={readiness.confirming || busy || confirming} onClick={() => void readiness.reload()}>重新检查发布条件</Button>
    </>;
  }
  const publishLabel = busy && activeOperation === 'publish' ? '正在发布' : publicationStatus.blocked ? publicationStatus.actionLabel : publishAllowed ? publicationStatus.actionLabel : '请完善信息';
  const publishControl = publicationTabActive && canPublish && <Space wrap className={styles.headerControls}>
    <Button data-testid="vehicle-publish" type="primary" size="large" icon={<CloudUploadOutlined />} className={publishAllowed ? styles.publishReady : styles.publishIncomplete}
      disabled={!publishAllowed} loading={busy && activeOperation === 'publish'} onClick={() => void perform('publish')}>{publishLabel}</Button>
    <Button size="small" onClick={() => setIssuesOpen(true)}>查看发布缺项</Button>
  </Space>;
  return <section className={styles.panel} aria-labelledby="vehicle-actions-title">
    {publicationTabActive && publishTarget && createPortal(publishControl, publishTarget)}
    <Modal title="发布缺项" open={publicationTabActive && issuesOpen} onCancel={() => setIssuesOpen(false)} footer={<Button onClick={() => setIssuesOpen(false)}>关闭</Button>}>
      <div className={styles.readinessModal}>{readinessIssues()}</div>
    </Modal>
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
      {isExternal && <Alert className={styles.notice} showIcon type="info" title="外部挂牌，非自有库存承诺" description="保留库存未知，价格仅为参考或待询价。员工发布前需完善三语并逐项审核；公开仍保留外部来源标记。每张图片须记录原始来源。" />}
      {hasUnsavedChanges && <Alert className={styles.notice} showIcon type="info" title="请先保存当前修改" description="保存后，再单独操作库存、发布或下架。" />}
      {error && <Alert className={styles.notice} showIcon type="error" title={error} description={issues.length > 0 ? <ul className={styles.issueList}>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : undefined} />}
      {success && <Alert className={styles.notice} showIcon type="success" title={success} />}
      {unconfirmed && <Card size="small" className={styles.reconcileCard} title={`${operationLabels[unconfirmed]}结果尚未确认`}>
        <Alert showIcon type="warning" title="请先核对结果，避免重复操作" description={unconfirmed === 'publish' ? '服务端可能已完成发布。重试会使用原请求及相同幂等标识；其它修改暂时锁定。' : '服务端可能已完成操作。请读取当前状态核对，暂不要重复操作。'} />
        <Space wrap className={styles.buttons}>{publicationTabActive && unconfirmed === 'publish' && <Button loading={busy && activeOperation === 'publish'} disabled={disabled || !canPublish} onClick={() => void perform('publish')}>重试原发布请求</Button>}<Button icon={<ReloadOutlined />} loading={busy && activeOperation === 'reconcile'} disabled={busy || disabled} onClick={() => void readCurrent()}>读取当前状态</Button></Space>
        {latest && <div className={styles.reconcile}><Descriptions size="small" column={1} items={[{ key: 'version', label: '服务端版本', children: latest.version }, { key: 'state', label: '当前状态', children: `${publicationLabels[latest.publicationState]} · ${availabilityLabels[latest.availability]}` }, { key: 'published', label: '发布时间', children: formatTime(latest.publishedAt) }]} /><Button disabled={busy || disabled} onClick={() => void adoptLatest()}>采用核对到的版本，结束本次重试</Button></div>}
      </Card>}
      <div className={styles.readiness}>
        <Typography.Title level={5}>服务端发布检查</Typography.Title>
        <Space wrap>{[
          { label: '必填车辆资料', passed: ready?.requiredFieldsReady },
          { label: '公开多语', passed: ready?.localizationReady },
          { label: `${localeLabels[previewLocale]}预览已确认`, passed: previewCurrent },
        ].map(check => <Tag key={check.label} color={check.passed ? 'success' : 'warning'} icon={check.passed ? <CheckCircleOutlined /> : undefined}>{check.label}</Tag>)}</Space>
        <Typography.Paragraph type="secondary">资料、多语和预览确认分别由服务端校验。确认预览不会自动审核译文，也不会自动发布。</Typography.Paragraph>
        {readinessIssues()}
      </div>
      {publicationTabActive && <Card size="small" className={styles.previewConfirmation} title="确认当前预览">
        {previewCurrent && ready?.confirmation && <Alert showIcon type="success" title={`已确认${localeLabels[previewLocale]}预览`} description={`有效至 ${formatTime(ready.confirmation.expiresAt)}。资料或公开内容变化后需要重新核对。`} />}
        {!previewReceipt && <Typography.Paragraph>请先在上方完整读取当前语言的草稿预览，再确认图片、价格和文字。</Typography.Paragraph>}
        {previewReceipt && !receiptMatches && <Typography.Paragraph>当前显示的预览与发布检查尚未对应，请重新读取当前版本的预览和发布检查。</Typography.Paragraph>}
        <Checkbox checked={previewAcknowledged} disabled={!canConfirmPreview} onChange={event => setAcknowledgedReceipt(event.target.checked ? receiptKey : null)}>我已检查当前预览，确认图片、价格和文字正确</Checkbox>
        <Button type="primary" loading={readiness.confirming} disabled={!canConfirmPreview || !previewAcknowledged} onClick={() => void confirmCurrentPreview()}>确认当前预览</Button>
      </Card>}
      {canWrite && !allowsPending && <div className={styles.inventory}>
        <Form.Item label="核验后的库存状态" htmlFor="verified-availability"><Select id="verified-availability" aria-label="核验后的库存状态" value={availability} disabled={unavailable} onChange={setAvailability} options={Object.entries(availabilityLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Button icon={<SafetyCertificateOutlined />} loading={busy && activeOperation === 'availability'} disabled={unavailable} onClick={() => void perform('availability')}>核验并更新库存</Button>
        <Typography.Text type="secondary">当前：{availabilityLabels[vehicle.availability]} · 最近核验：{formatTime(vehicle.availabilityCheckedAt)}。请按实际库存确认后更新。</Typography.Text>
      </div>}
      <div className={styles.publishBar}>
        <Space wrap>{!publishTarget && publishControl}{canWrite && <Button danger icon={<StopOutlined />} loading={busy && activeOperation === 'archive'} disabled={unavailable || vehicle.publicationState === 'archived'} onClick={() => void perform('archive')}>下架车辆</Button>}</Space>
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
