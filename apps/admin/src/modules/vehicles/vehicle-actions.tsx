import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Alert, App, Button, Card, Descriptions, Form, Select, Space, Tag, Typography } from 'antd';
import { CloudUploadOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import { AdminVehicleResponseSchema, type AdminVehicle, type Availability, type ConfirmPublicationPreviewRequest, type PublicationIssue, type StaffMe } from '@hd/contracts/admin';
import type { Locale } from '@hd/contracts/public';
import { ApiClientError, request } from '../../shared/api/client';
import { readVehicleLifecycle } from '../../shared/api/vehicle-lifecycle';
import { availabilityLabels, formatTime, publicationLabels } from './draft-form';
import { keepPublishIntent, makePublishIntent, publicationAttemptExpired, publicationControlState, publicationFeedback, publicationIssueLabel, publicationIssueDetail, type PublishIntent } from './vehicle-actions-model';
import styles from './vehicle-actions.module.css';
import { publicationReceiptMatches, usePublicationReadiness } from './use-publication-readiness';

type Props = {
  vehicle: AdminVehicle;
  publicationTabActive: boolean;
  previewLocale: Locale;
  previewReceipt: ConfirmPublicationPreviewRequest | null;
  hasUnsavedChanges: boolean;
  disabled?: boolean;
  onUpdated: (vehicle: AdminVehicle) => void;
  onConflict?: () => void;
  onIssue: (issue: PublicationIssue) => void;
  onBusyChange?: (busy: boolean) => void;
};

type Operation = 'availability' | 'publish' | 'archive';
const operationLabels = { availability: '库存核验', publish: '发布', archive: '下架' };

function proposedAvailability(vehicle: AdminVehicle): Availability {
  return vehicle.publicationState === 'draft' && vehicle.availability === 'unknown' && vehicle.availabilityCheckedAt === null ? 'available' : vehicle.availability;
}

export function VehicleActions({ publicationTabActive, previewLocale, previewReceipt, vehicle, hasUnsavedChanges, disabled = false, onUpdated, onConflict, onIssue, onBusyChange }: Props) {
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
  const inFlight = useRef(false);
  const actionGuard = useRef(false);
  const mounted = useRef(true);
  const publishIntent = useRef<PublishIntent | null>(null);
  const parentBusy = useRef(onBusyChange);
  parentBusy.current = onBusyChange;
  const confirmation = useRef<{ cancel(): void } | null>(null);
  const readiness = usePublicationReadiness({ vehicleId: vehicle.id, version: vehicle.version, locale: previewLocale, onConflict });
  const receiptKey = previewReceipt ? JSON.stringify([vehicle.id, previewReceipt.version, previewReceipt.publicContentRevision, previewReceipt.fingerprint, previewReceipt.locale]) : null;
  const currentAction = useRef({ vehicle, disabled, hasUnsavedChanges, canPublish, publicationTabActive, receiptKey });
  currentAction.current = { vehicle, disabled, hasUnsavedChanges, canPublish, publicationTabActive, receiptKey };
  const lastReceipt = useRef<string | null>(null);
  const isDemo = String(vehicle.draft.source.kind) === 'demo';
  const isExternal = vehicle.draft.source.kind === 'external';
  const allowsPending = isDemo || isExternal;
  const locked = unconfirmed !== null;
  const unavailable = disabled || hasUnsavedChanges || busy || confirming || locked || readiness.confirming;
  const publicationStatus = publicationControlState(vehicle);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; confirmation.current?.cancel(); parentBusy.current?.(false); }; }, []);
  useEffect(() => { parentBusy.current?.(busy || confirming || locked || readiness.confirming); }, [busy, confirming, locked, readiness.confirming]);
  useEffect(() => {
    if (receiptKey && lastReceipt.current !== receiptKey) {
      void readiness.reload();
    }
    lastReceipt.current = receiptKey;
  }, [receiptKey, readiness.reload]);
  useEffect(() => { setAvailability(proposedAvailability(vehicle)); }, [vehicle.id, vehicle.availability, vehicle.availabilityCheckedAt, vehicle.publicationState, vehicle.version]);

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
    if (inFlight.current || confirmation.current || confirming || readiness.confirming || disabled || hasUnsavedChanges || (operation === 'availability' && allowsPending) || (locked && operation !== 'publish')) return;
    if ((operation === 'publish' && !canPublish) || (operation !== 'publish' && !canWrite)) return;
    const wasUncertain = unconfirmed === 'publish';
    if (locked && !wasUncertain) return;
    // Retry the original idempotent intent even if a later snapshot now says there are no new edits.
    if (operation === 'publish' && !wasUncertain && publicationStatus.blocked) return;
    if (operation === 'publish') {
      if (wasUncertain && !publishIntent.current) {
        setError('原发布请求已不可用，请先读取当前状态核对结果；没有创建新的发布请求。'); return;
      }
      if (!wasUncertain && (!publishAllowed || !previewReceipt)) return;
      if (!publishIntent.current) publishIntent.current = makePublishIntent(vehicle, crypto.randomUUID(), Date.now());
      if (publicationAttemptExpired(publishIntent.current, Date.now())) {
        setError('本次发布请求已超过 24 小时，请先读取当前状态核对结果，再决定下一步。');
        setUnconfirmed('publish'); void toast.warning('原发布请求已超过24小时，请先读取当前状态。'); return;
      }
      if (!wasUncertain && previewReceipt) {
        start('publish');
        let proceed = false;
        try {
          const result = await readiness.confirm(previewReceipt);
          const current = currentAction.current;
          if (!mounted.current) return;
          if (!result.ok) {
            setError(result.error ?? '预览确认未完成，请重新检查后再发布。');
            return;
          }
          if (!current.publicationTabActive || current.disabled || current.hasUnsavedChanges || !current.canPublish ||
              current.vehicle.id !== vehicle.id || current.vehicle.version !== publishIntent.current?.version ||
              current.receiptKey !== receiptKey || publicationControlState(current.vehicle).blocked || !readiness.isPublishReady(previewReceipt)) {
            setError('草稿或预览已变化，请检查当前预览后再发布。');
            return;
          }
          proceed = true;
        } finally {
          if (!proceed) { publishIntent.current = null; stop(); }
        }
      }
    } else if (operation === 'archive') {
      if (!await confirmAction('下架这辆车？', '下架后公开详情返回不存在，车辆退出公开列表；后台草稿和历史记录保留。', true)) return;
    } else if (!await confirmAction('确认库存核验结果', `你已实际核验库存为“${availabilityLabels[availability]}”，将记录当前核验时间。已售车辆会立即退出公开在售列表，恢复可售也会立即生效。`, availability === 'sold')) return;

    if (!mounted.current) return;
    const body = operation === 'publish' ? publishIntent.current!.body
      : JSON.stringify(operation === 'availability' ? { version: vehicle.version, availability, checkedAt: new Date().toISOString() } : { version: vehicle.version });
    if (!inFlight.current) start(operation);
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
        const uncertain = mutationAcknowledged || (operation === 'publish' ? keepPublishIntent(failure.status, wasUncertain) : failure.status === 0 || failure.status >= 500);
        if (uncertain) { setUnconfirmed(operation); void toast.warning(`${operationLabels[operation]}结果尚未确认，请保留页面并核对当前状态。`); }
        else { publishIntent.current = null; setUnconfirmed(null); void toast.error(failure.message); }
        if (operation === 'publish' && !uncertain) {
          void readiness.reload();
        }
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

  const ready = readiness.ready;
  const receiptMatches = Boolean(ready && previewReceipt && previewReceipt.version === vehicle.version && publicationReceiptMatches(ready, previewReceipt));
  const publishAllowed = publicationTabActive && canPublish && !unavailable && !publicationStatus.blocked &&
    !readiness.loading && !readiness.error && receiptMatches && !!ready?.requiredFieldsReady && !!ready.localizationReady;


  const pending = ready?.issues.filter(issue => issue.stage !== 'preview') ?? [];
  const publishLabel = busy && activeOperation === 'publish' ? '正在发布' : publicationStatus.blocked ? publicationStatus.actionLabel : '确认并发布';
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
      {isExternal && <Alert className={styles.notice} showIcon type="info" title="外部挂牌，非自有库存承诺" description="保留库存未知，价格仅为参考或待询价。员工发布前需完善三语并逐项审核；公开仍保留外部来源标记。每张图片须记录原始来源。" />}
      {hasUnsavedChanges && <Alert className={styles.notice} showIcon type="info" title="请先保存当前修改" description="保存后，再单独操作库存、发布或下架。" />}
      {error && error !== readiness.error && <Alert className={styles.notice} showIcon type="error" title={error} description={issues.length > 0 ? <ul className={styles.issueList}>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : undefined} />}
      {success && <Alert className={styles.notice} showIcon type="success" title={success} />}
      {unconfirmed && <Card size="small" className={styles.reconcileCard} title={`${operationLabels[unconfirmed]}结果尚未确认`}>
        <Alert showIcon type="warning" title="请先核对结果，避免重复操作" description={unconfirmed === 'publish' ? '服务端可能已完成发布。重试会使用原请求及相同幂等标识；其它修改暂时锁定。' : '服务端可能已完成操作。请读取当前状态核对，暂不要重复操作。'} />
        <Space wrap className={styles.buttons}>{publicationTabActive && unconfirmed === 'publish' && <Button loading={busy && activeOperation === 'publish'} disabled={disabled || !canPublish} onClick={() => void perform('publish')}>重试原发布请求</Button>}<Button icon={<ReloadOutlined />} loading={busy && activeOperation === 'reconcile'} disabled={busy || disabled} onClick={() => void readCurrent()}>读取当前状态</Button></Space>
        {latest && <div className={styles.reconcile}><Descriptions size="small" column={1} items={[{ key: 'version', label: '服务端版本', children: latest.version }, { key: 'state', label: '当前状态', children: `${publicationLabels[latest.publicationState]} · ${availabilityLabels[latest.availability]}` }, { key: 'published', label: '发布时间', children: formatTime(latest.publishedAt) }]} /><Button disabled={busy || disabled} onClick={() => void adoptLatest()}>采用核对到的版本，结束本次重试</Button></div>}
      </Card>}
      {publicationTabActive && <section className={styles.readiness} aria-label="发布检查">
        <Typography.Title level={5}>发布检查</Typography.Title>
        {hasUnsavedChanges ? <Alert showIcon type="info" title="请先保存当前修改" />
          : readiness.error ? <Alert showIcon type="error" title="发布检查未完成" description={readiness.error} />
          : readiness.loading && !inFlight.current ? <Alert showIcon type="info" title="正在读取发布检查…" />
          : pending.length ? <ul className={styles.serverIssues}>{pending.map((issue, index) => {
            const { label, reason } = publicationIssueDetail(issue, vehicle);
            return <li key={`${issue.path}:${index}`}><div className={styles.issueDetails}>
              <Button type="link" disabled={unavailable} onClick={() => onIssue(issue)}>{label}</Button>
              {reason && <Typography.Text type="secondary">{reason}</Typography.Text>}
            </div></li>;
          })}</ul>
          : !receiptMatches && <Typography.Paragraph>请完整载入当前草稿预览后再发布。</Typography.Paragraph>}
        {(readiness.error || (previewReceipt && !receiptMatches && !readiness.loading)) && <Button icon={<ReloadOutlined />} disabled={unavailable} onClick={() => void readiness.reload()}>重新检查发布条件</Button>}
      </section>}
      {canWrite && !allowsPending && <div className={styles.inventory}>
        <div className={styles.inventoryControls}>
          <Form.Item label="核验后的库存状态" htmlFor="verified-availability"><Select id="verified-availability" aria-label="核验后的库存状态" value={availability} disabled={unavailable} onChange={setAvailability} options={Object.entries(availabilityLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Button icon={<SafetyCertificateOutlined />} loading={busy && activeOperation === 'availability'} disabled={unavailable} onClick={() => void perform('availability')}>核验并更新库存</Button>
        </div>
        <Typography.Text type="secondary">当前：{availabilityLabels[vehicle.availability]} · 最近核验：{formatTime(vehicle.availabilityCheckedAt)}。请按实际库存确认后更新。</Typography.Text>
      </div>}
      {(canWrite || (publicationTabActive && canPublish && unconfirmed !== 'publish')) &&
        <div className={styles.publishBar} role="group" aria-label="发布与下架">
          <Space wrap>
            {publicationTabActive && canPublish && unconfirmed !== 'publish' && <Button data-testid="vehicle-publish" type="primary" size="large" icon={<CloudUploadOutlined />}
              className={publishAllowed ? styles.publishReady : styles.publishIncomplete}
              disabled={!publishAllowed} loading={busy && activeOperation === 'publish'} onClick={() => void perform('publish')}>{publishLabel}</Button>}
            {canWrite && <Button danger size="large" icon={<StopOutlined />} loading={busy && activeOperation === 'archive'} disabled={unavailable || vehicle.publicationState === 'archived'} onClick={() => void perform('archive')}>下架车辆</Button>}
          </Space>
          <Typography.Text type="secondary">确认发布前请核对预览中的图片、价格和文字。下架立即撤销公开访问。</Typography.Text>
        </div>}
    </Card>
  </section>;
}
