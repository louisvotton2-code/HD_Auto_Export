import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Alert, App, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, ReloadOutlined, UndoOutlined } from '@ant-design/icons';
import type { AdminVehicle, StaffMe } from '@hd/contracts/admin';
import { ApiClientError } from '../../shared/api/client';
import { mutateVehicleLifecycle, readVehicleLifecycle } from '../../shared/api/vehicle-lifecycle';
import { formatTime, publicationLabels } from './draft-form';
import {
  keepVehicleLifecycleIntent, makeVehicleLifecycleIntent, vehicleLifecycleIntentExpired,
  type VehicleLifecycleIntent, type VehicleLifecycleOperation,
} from './vehicle-deletion-model';
import styles from './vehicle-deletion-actions.module.css';

type Props = {
  vehicle: AdminVehicle;
  isDeleted: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDeleted?: (record: AdminVehicle) => void;
  onRestored?: (record: AdminVehicle) => void;
  onConflict?: () => void;
  compact?: boolean;
};
type CurrentLifecycle = Awaited<ReturnType<typeof readVehicleLifecycle>>;
const operationLabels = { delete: '删除', restore: '恢复' };

/** Reversible lifecycle operations only. HTTP paths and response schemas belong to the shared adapter. */
export function VehicleDeletionActions({
  vehicle, isDeleted, disabled = false, onBusyChange, onDeleted, onRestored, onConflict, compact = false,
}: Props) {
  const { modal, message: toast } = App.useApp();
  const staff = useOutletContext<StaffMe>();
  const canManage = staff.permissions.includes('vehicles:write');
  const canRead = staff.permissions.includes('vehicles:read');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [latest, setLatest] = useState<CurrentLifecycle | null>(null);
  const intent = useRef<VehicleLifecycleIntent | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const currentVehicleId = useRef(vehicle.id);
  const parentBusy = useRef(onBusyChange);
  const confirmation = useRef<{ cancel(): void } | null>(null);
  currentVehicleId.current = vehicle.id;
  parentBusy.current = onBusyChange;

  useEffect(() => {
    mounted.current = true; generation.current += 1;
    intent.current = null; inFlight.current = false;
    setBusy(false); setConfirming(false); setUncertain(false); setConflict(false);
    setError(''); setSuccess(''); setLatest(null);
    return () => {
      mounted.current = false; generation.current += 1;
      confirmation.current?.cancel(); parentBusy.current?.(false);
    };
  }, [vehicle.id]);
  useEffect(() => { parentBusy.current?.(busy || confirming || uncertain); }, [busy, confirming, uncertain]);
  useEffect(() => {
    // The parent may resolve a 409 through its own comparison UI. Keep uncertain intents intact.
    if (!intent.current && !inFlight.current && !confirmation.current) {
      setConflict(false); setError(''); setLatest(null);
    }
  }, [vehicle.id, vehicle.version, isDeleted]);

  function isCurrent(id: string, epoch: number) {
    return mounted.current && currentVehicleId.current === id && generation.current === epoch;
  }
  function confirmAction(title: string, content: ReactNode, okText: string, danger = false): Promise<boolean> {
    if (confirmation.current || !mounted.current) return Promise.resolve(false);
    const id = vehicle.id; const epoch = generation.current;
    setConfirming(true); parentBusy.current?.(true);
    return new Promise<boolean>(resolve => {
      let settled = false;
      const settle = (accepted: boolean) => {
        if (settled) return;
        settled = true; confirmation.current = null;
        if (isCurrent(id, epoch)) setConfirming(false);
        resolve(accepted && isCurrent(id, epoch));
      };
      const instance = modal.confirm({
        title, content, okText, cancelText: '取消', okButtonProps: { danger },
        onOk: () => settle(true), onCancel: () => settle(false), afterClose: () => settle(false),
      });
      confirmation.current = { cancel: () => { instance.destroy(); settle(false); } };
    });
  }
  function start() {
    inFlight.current = true; setBusy(true); setError(''); setSuccess(''); setLatest(null);
    parentBusy.current?.(true);
  }
  function stop(id: string, epoch: number) {
    if (!isCurrent(id, epoch)) return;
    inFlight.current = false; setBusy(false);
  }
  function applyCurrent(current: CurrentLifecycle, message: string) {
    intent.current = null; setUncertain(false); setConflict(false); setLatest(null);
    setError(''); setSuccess(message); void toast.success(message);
    // A replayed receipt may predate another delete/restore. Only this freshly read state is adopted.
    if (current.isDeleted) onDeleted?.(current.vehicle);
    else onRestored?.(current.vehicle);
  }
  function verifyCurrent(current: CurrentLifecycle, expectedId: string): CurrentLifecycle {
    if (current.vehicle.id !== expectedId) throw new Error('读取到的车辆与当前记录不一致，请重新核对。');
    return current;
  }

  async function execute(snapshot: VehicleLifecycleIntent, wasUncertain: boolean) {
    if (inFlight.current || confirmation.current || disabled || !canManage) return;
    const epoch = generation.current;
    if (vehicleLifecycleIntentExpired(snapshot, Date.now())) {
      setUncertain(true); setError('本次请求已超过 24 小时，请先读取当前状态并核对结果，不能直接重试。'); void toast.warning('原请求已超过24小时，请先读取当前状态。'); return;
    }
    start();
    let receiptAccepted = false;
    let current: CurrentLifecycle | null = null;
    let versionConflict = false;
    try {
      await mutateVehicleLifecycle(snapshot.operation, snapshot.vehicleId, snapshot.version, snapshot.key);
      receiptAccepted = true;
      if (!isCurrent(snapshot.vehicleId, epoch)) return;
      current = verifyCurrent(await readVehicleLifecycle(snapshot.vehicleId), snapshot.vehicleId);
    } catch (failure) {
      if (!isCurrent(snapshot.vehicleId, epoch)) return;
      setError(failure instanceof Error ? failure.message : '操作结果尚未确认，请保留页面并核对当前状态。');
      const status = failure instanceof ApiClientError ? failure.status : 0;
      const keep = keepVehicleLifecycleIntent(status, wasUncertain, receiptAccepted);
      setUncertain(keep);
      if (keep) void toast.warning(`${operationLabels[snapshot.operation]}结果尚未确认，请保留页面并核对当前状态。`);
      else void toast.error(failure instanceof Error ? failure.message : '操作失败，请核对当前状态。');
      if (!keep) intent.current = null;
      versionConflict = !keep && status === 409;
      if (versionConflict) setConflict(true);
    } finally { stop(snapshot.vehicleId, epoch); }
    if (!isCurrent(snapshot.vehicleId, epoch)) return;
    if (versionConflict) onConflict?.();
    if (current) applyCurrent(current, current.isDeleted
      ? '已读取最新状态：车辆位于回收站，历史资料和图片保留。'
      : current.vehicle.publicationState === 'draft'
        ? '已读取最新状态：车辆为未发布草稿。重新核对发布条件后，才能明确发布；不会自动加回首页。'
        : '已读取最新状态：车辆未在回收站，且已有后续更新。请以当前版本为准。');
  }

  async function begin(operation: VehicleLifecycleOperation) {
    if (inFlight.current || confirmation.current || confirming || uncertain || conflict || disabled || !canManage) return;
    if ((operation === 'restore') !== isDeleted) return;
    const id = vehicle.id; const version = vehicle.version; const epoch = generation.current;
    const accepted = await confirmAction(
      operation === 'delete' ? '删除到回收站？' : '恢复为未发布草稿？',
      <Space orientation="vertical" size="middle">
        <Typography.Text strong>{vehicle.stockCode}</Typography.Text>
        <Typography.Paragraph style={{ marginBottom: 0 }}>{operation === 'delete'
          ? '车辆将从普通车辆列表、公开内容和首页区块中移除。历史资料和图片仍会保留，可以从回收站恢复；这不会永久清空资料。'
          : '车辆将恢复到未发布草稿，库存回到未知。草稿和历史保留，但不会自动发布或加回首页；请重新检查适用的发布条件。'}</Typography.Paragraph>
      </Space>,
      operation === 'delete' ? '确认删除' : '确认恢复', operation === 'delete',
    );
    if (!accepted || !isCurrent(id, epoch)) return;
    const snapshot = makeVehicleLifecycleIntent(operation, id, version, crypto.randomUUID(), Date.now());
    intent.current = snapshot;
    await execute(snapshot, false);
  }

  async function readCurrent() {
    if (inFlight.current || confirmation.current || confirming || !canRead) return;
    const id = vehicle.id; const epoch = generation.current;
    start();
    try {
      const current = verifyCurrent(await readVehicleLifecycle(id), id);
      if (isCurrent(id, epoch)) { setLatest(current); void toast.success('已读取当前状态，请核对后再选择是否采用。'); }
    } catch (failure) {
      if (isCurrent(id, epoch)) { const detail = failure instanceof Error ? failure.message : '读取当前状态失败，请稍后重试。'; setError(detail); void toast.error(detail); }
    } finally { stop(id, epoch); }
  }

  async function adoptLatest() {
    if (!latest || latest.vehicle.id !== vehicle.id || inFlight.current || confirmation.current || confirming || disabled || !canRead) return;
    const id = vehicle.id; const epoch = generation.current;
    const accepted = await confirmAction('采用核对到的当前状态？', '这会结束本次结果核对提示，不会再次删除、恢复或发布车辆。若当前状态已有后续变更，请以读到的版本为准。', '确认采用');
    if (!accepted || !isCurrent(id, epoch)) return;
    applyCurrent(latest, '已采用核对到的服务端状态。没有自动再次执行删除、恢复或发布。');
  }

  const pending = uncertain && intent.current?.vehicleId === vehicle.id ? intent.current : null;
  const expired = pending ? vehicleLifecycleIntentExpired(pending, Date.now()) : false;
  const content = <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
    {!compact && <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{isDeleted
      ? '此车位于回收站，不能编辑或公开预览。恢复后只回到未发布草稿，需要重新检查并明确发布。'
      : '删除到回收站会移除普通列表、公开内容和首页引用，保留历史及图片。仅暂时撤下公开展示时，请使用“下架车辆”。'}</Typography.Paragraph>}
    {error && <Alert type="error" showIcon title={error} />}
    {success && <Alert type="success" showIcon title={success} />}
    {conflict && !uncertain && <Alert type="warning" showIcon title="车辆版本已变化" description="当前页面的输入没有被覆盖。请读取最新状态供核对，或在车辆编辑页比较后再操作。" />}
    {pending && <Alert type="warning" showIcon title={`${operationLabels[pending.operation]}结果尚未确认`} description={<Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Text>服务端可能已经处理。当前操作已锁定为原请求，请保留页面并先核对结果。</Typography.Text>
      {expired && <Typography.Text type="danger">已超过 24 小时幂等保留期，只能先读取当前状态。</Typography.Text>}
      <Space wrap><Button icon={<ReloadOutlined />} loading={busy} disabled={busy || confirming || disabled || expired || !canManage} onClick={() => void execute(pending, true)}>重试原{operationLabels[pending.operation]}请求</Button><Button disabled={busy || confirming || !canRead} onClick={() => void readCurrent()}>读取当前状态</Button></Space>
    </Space>} />}
    {!pending && canManage && <Space wrap>
      <Button danger={!isDeleted} type={isDeleted ? 'primary' : 'default'} icon={isDeleted ? <UndoOutlined /> : <DeleteOutlined />} loading={busy} disabled={disabled || busy || confirming || conflict || !canManage} onClick={() => void begin(isDeleted ? 'restore' : 'delete')}>{isDeleted ? '恢复车辆' : '删除车辆'}</Button>
      {conflict && <Button icon={<ReloadOutlined />} disabled={busy || confirming || !canRead} onClick={() => void readCurrent()}>读取当前状态</Button>}
    </Space>}
    {latest && latest.vehicle.id === vehicle.id && <Card size="small" title="核对到的当前状态" className={styles.current}>
      <Descriptions size="small" column={1} items={[
        { key: 'stock', label: '车辆编号', children: latest.vehicle.stockCode },
        { key: 'version', label: '当前版本', children: latest.vehicle.version },
        { key: 'lifecycle', label: '回收站状态', children: <Tag color={latest.isDeleted ? 'warning' : 'success'}>{latest.isDeleted ? '在回收站' : '未删除'}</Tag> },
        { key: 'publication', label: '发布状态', children: publicationLabels[latest.vehicle.publicationState] },
        { key: 'updated', label: '最近更新', children: formatTime(latest.vehicle.updatedAt) },
      ]} />
      <Button disabled={busy || confirming || disabled || !canRead} onClick={() => void adoptLatest()}>采用核对到的当前状态</Button>
    </Card>}
  </Space>;
  return compact ? <div className={styles.compact}>{content}</div> : <Card title={<Space><DeleteOutlined />回收站操作</Space>} className={styles.panel} extra={<Tag color={isDeleted ? 'warning' : 'default'}>{isDeleted ? '已删除车辆' : '可恢复删除'}</Tag>}>{content}</Card>;
}
