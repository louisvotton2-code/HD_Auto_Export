import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Button, InputNumber, Modal, Space, Table, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import styles from './home-sections.module.css';

type Props = {
  sectionNumber: number;
  ids: readonly string[];
  disabled: boolean;
  renderVehicle: (id: string) => ReactNode;
  vehicleLabel: (id: string) => string;
  onMove: (id: string, target: number) => void;
  onRemove: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
};
type Sorting = {
  id: string; ids: readonly string[]; target: number; kind: 'pointer' | 'keyboard';
  active: boolean; pointerId?: number; startY?: number; x?: number; y?: number; handle?: HTMLElement;
};
const sameIds = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((id, index) => id === right[index]);

/** Preview stays separate from the draft: only a completed move changes the ordered IDs. */
export function HomeVehicleOrder(props: Props) {
  const { sectionNumber, ids, disabled, renderVehicle, vehicleLabel, onMove, onRemove } = props;
  const latest = useRef(props); latest.current = props;
  const root = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<string, HTMLElement>());
  const adjustButtons = useRef(new Map<string, HTMLElement>());
  const sorting = useRef<Sorting | null>(null);
  const [preview, setPreview] = useState<Sorting | null>(null);
  const [positionDialog, setPositionDialog] = useState<{ id: string; position: number | null } | null>(null);
  const dialogVehicle = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const frame = useRef<number | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const helpId = useId();

  function setBusy(value: boolean) {
    busy.current = value;
    latest.current.onBusyChange(value);
  }
  function focusVehicle(id: string, adjust = false) {
    requestAnimationFrame(() => { if (alive.current) (adjust ? adjustButtons : handles).current.get(id)?.focus({ preventScroll: true }); });
  }
  function stopFrame() { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; }
  function finish(commit: boolean, restoreFocus = true) {
    const current = sorting.current;
    if (!current) return;
    sorting.current = null; stopFrame(); setPreview(null); setBusy(false);
    if (current.pointerId !== undefined && current.handle?.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    const valid = !latest.current.disabled && sameIds(current.ids, latest.current.ids);
    if (commit && current.active && valid) {
      latest.current.onMove(current.id, current.target);
      setAnnouncement(`${latest.current.vehicleLabel(current.id)}已移到第 ${current.target + 1} 位，保存后生效。`);
    } else if (current.active) setAnnouncement('已取消排序，原顺序未改变。');
    if (restoreFocus) focusVehicle(current.id);
  }
  function showTarget(current: Sorting, target: number) {
    const next = { ...current, target };
    sorting.current = next; setPreview(next);
    setAnnouncement(`${latest.current.vehicleLabel(current.id)}，目标第 ${target + 1} 位。${current.kind === 'keyboard' ? '按空格或回车确认，Escape 取消。' : '松开放置，Escape 取消。'}`);
  }
  function pointerTarget() {
    const current = sorting.current;
    if (!current?.active || current.kind !== 'pointer' || current.y === undefined) return;
    const rows = [...root.current?.querySelectorAll<HTMLElement>('[data-home-order-row]') ?? []].filter(row => row.dataset.homeOrderRow !== current.id);
    const target = rows.filter(row => { const rect = row.getBoundingClientRect(); return current.y! > rect.top + rect.height / 2; }).length;
    if (target !== current.target) showTarget(current, target);
  }
  function autoScroll() {
    const current = sorting.current;
    if (!current?.active || current.kind !== 'pointer' || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const y = current.y ?? 0; const x = current.x ?? 0;
    if (x >= rect.left && x <= rect.right) {
      const edge = 90;
      if (y > innerHeight - edge && rect.bottom > innerHeight - edge) window.scrollBy(0, Math.min(18, Math.max(0, y - (innerHeight - edge)) / 3));
      else if (y < edge && rect.top < edge) window.scrollBy(0, -Math.min(18, Math.max(0, edge - y) / 3));
      pointerTarget();
    }
    frame.current = requestAnimationFrame(autoScroll);
  }
  function pointerDown(event: PointerEvent<HTMLElement>, id: string) {
    if (disabled || busy.current || ids.length < 2 || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    const current: Sorting = { id, ids: [...ids], target: ids.indexOf(id), kind: 'pointer', active: false,
      pointerId: event.pointerId, startY: event.clientY, x: event.clientX, y: event.clientY, handle: event.currentTarget };
    sorting.current = current; setBusy(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    const current = sorting.current;
    if (!current || current.kind !== 'pointer' || current.pointerId !== event.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    if (!current.active && Math.abs(event.clientY - current.startY!) >= 6) {
      current.active = true; setPreview({ ...current }); frame.current = requestAnimationFrame(autoScroll);
    }
    if (current.active) { event.preventDefault(); pointerTarget(); }
  }
  function pointerUp(event: PointerEvent<HTMLElement>) {
    const current = sorting.current;
    if (!current || current.kind !== 'pointer' || current.pointerId !== event.pointerId) return;
    const rect = root.current?.getBoundingClientRect();
    finish(Boolean(rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
  }
  function keyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (disabled || ids.length < 2) return;
    const current = sorting.current;
    if (!current && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      const next: Sorting = { id, ids: [...ids], target: ids.indexOf(id), kind: 'keyboard', active: true };
      sorting.current = next; setBusy(true); showTarget(next, next.target); return;
    }
    if (current?.kind !== 'keyboard' || current.id !== id) return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); finish(true); }
    else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); finish(false, event.key !== 'Tab'); }
    else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, current.target + (event.key === 'ArrowUp' ? -1 : 1)));
      showTarget(current, target);
      const otherIds = ids.filter(value => value !== id);
      const targetId = otherIds[target] ?? otherIds.at(-1);
      if (targetId) handles.current.get(targetId)?.closest('tr')?.scrollIntoView({ block: 'nearest' });
    }
  }
  useEffect(() => {
    const cancel = () => finish(false, false);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && sorting.current) { event.preventDefault(); finish(false); } };
    window.addEventListener('blur', cancel); window.addEventListener('admin:unauthorized', cancel); window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('blur', cancel); window.removeEventListener('admin:unauthorized', cancel); window.removeEventListener('keydown', escape);
      alive.current = false; stopFrame();
      const current = sorting.current; sorting.current = null;
      if (current?.pointerId !== undefined && current.handle?.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      if (busy.current) latest.current.onBusyChange(false);
    };
  }, []);
  useEffect(() => {
    if (sorting.current && (disabled || !sameIds(sorting.current.ids, ids))) finish(false);
    if (positionDialog && (disabled || !ids.includes(positionDialog.id))) closePosition();
  }, [disabled, ids]);

  function openPosition(id: string) {
    if (disabled || busy.current) return;
    dialogVehicle.current = id; setPositionDialog({ id, position: ids.indexOf(id) + 1 }); setBusy(true);
  }
  function closePosition(target?: number) {
    const id = dialogVehicle.current;
    setPositionDialog(null); setBusy(false);
    if (id && target !== undefined && !latest.current.disabled && Number.isInteger(target) && target >= 0 && target < latest.current.ids.length && latest.current.ids.includes(id)) {
      latest.current.onMove(id, target);
      setAnnouncement(`${latest.current.vehicleLabel(id)}已移到第 ${target + 1} 位，保存后生效。`);
    }
  }
  const rest = preview ? ids.filter(id => id !== preview.id) : [];
  const before = preview ? rest[preview.target] : undefined;
  const after = preview && !before ? rest.at(-1) : undefined;
  const validPosition = positionDialog?.position !== null && Number.isInteger(positionDialog?.position) && positionDialog!.position! >= 1 && positionDialog!.position! <= ids.length;
  return <div ref={root} role="region" aria-label={`区块 ${sectionNumber}车辆排序`} className={styles.orderArea}>
    <Typography.Paragraph type="secondary" id={helpId} className={styles.orderHelp}>拖动手柄排序，或选择“调整顺序”直接指定位置。手柄聚焦后按空格开始，↑↓ 移动，回车确认，Esc 取消。</Typography.Paragraph>
    <div role="status" aria-live="polite" aria-atomic="true" className={styles.orderStatus}>{announcement}</div>
    <Table rowKey="id" size="middle" pagination={false} scroll={{ x: 650 }} dataSource={ids.map((id, position) => ({ id, position }))}
      onRow={row => ({ 'data-home-order-row': row.id, className: [preview?.id === row.id ? styles.sortingRow : '', before === row.id ? styles.dropBefore : '', after === row.id ? styles.dropAfter : ''].filter(Boolean).join(' ') })}
      columns={[
        { title: '顺序', width: 118, render: (_, row) => <Space orientation="vertical" size={4}>
          <Space size={4}><Button type="text" icon={<HolderOutlined />} className={styles.dragHandle}
            ref={element => { if (element) handles.current.set(row.id, element); else handles.current.delete(row.id); }}
            aria-label={`区块 ${sectionNumber}拖动排序 ${vehicleLabel(row.id)}`} aria-describedby={helpId} aria-pressed={preview?.id === row.id}
            disabled={disabled || ids.length < 2 || Boolean(preview && preview.id !== row.id)}
            onPointerDown={event => pointerDown(event, row.id)} onPointerMove={pointerMove} onPointerUp={pointerUp}
            onPointerCancel={() => finish(false)} onLostPointerCapture={() => { if (sorting.current?.kind === 'pointer') finish(false); }}
            onKeyDown={event => keyDown(event, row.id)} onBlur={() => { if (sorting.current?.kind === 'keyboard') finish(false, false); }}
          /><Typography.Text type="secondary">{String(row.position + 1).padStart(2, '0')}</Typography.Text></Space>
          <Button size="small" type="link" ref={element => { if (element) adjustButtons.current.set(row.id, element); else adjustButtons.current.delete(row.id); }}
            aria-label={`区块 ${sectionNumber}调整顺序 ${vehicleLabel(row.id)}`} disabled={disabled || Boolean(preview) || ids.length < 2} onClick={() => openPosition(row.id)}>调整顺序</Button>
        </Space> },
        { title: '车辆', render: (_, row) => renderVehicle(row.id) },
        { title: '区块操作', width: 230, render: (_, row) => <Space wrap>
          <Button aria-label={`区块 ${sectionNumber}上移车辆 ${row.position + 1}`} icon={<ArrowUpOutlined />} disabled={disabled || Boolean(preview) || row.position === 0} onClick={() => { onMove(row.id, row.position - 1); focusVehicle(row.id); }} />
          <Button aria-label={`区块 ${sectionNumber}下移车辆 ${row.position + 1}`} icon={<ArrowDownOutlined />} disabled={disabled || Boolean(preview) || row.position === ids.length - 1} onClick={() => { onMove(row.id, row.position + 1); focusVehicle(row.id); }} />
          <Button danger type="text" icon={<DeleteOutlined />} disabled={disabled || Boolean(preview)} onClick={() => onRemove(row.id)}>从区块移除</Button>
        </Space> },
      ]} />
    <Modal title={`调整区块 ${sectionNumber}车辆顺序`} open={positionDialog !== null} okText="移动到此位置" cancelText="取消" onCancel={() => closePosition()}
      onOk={() => { if (validPosition) closePosition(positionDialog!.position! - 1); }} okButtonProps={{ disabled: !validPosition || disabled }}
      afterClose={() => { if (dialogVehicle.current) focusVehicle(dialogVehicle.current, true); dialogVehicle.current = null; }} destroyOnHidden>
      <Typography.Paragraph>{positionDialog && vehicleLabel(positionDialog.id)} · 共 {ids.length} 辆</Typography.Paragraph>
      <Space wrap><Typography.Text>移到第</Typography.Text><InputNumber aria-label="目标序号" min={1} max={ids.length} precision={0} value={positionDialog?.position ?? null}
        onChange={position => setPositionDialog(current => current ? { ...current, position } : current)} /><Typography.Text>位</Typography.Text></Space>
      <div className={styles.quickOrder}><Button disabled={disabled} onClick={() => closePosition(0)}>置顶</Button><Button disabled={disabled} onClick={() => closePosition(ids.length - 1)}>置底</Button></div>
      <Typography.Paragraph type="secondary">调整后仍需保存首页配置。</Typography.Paragraph>
    </Modal>
  </div>;
}
