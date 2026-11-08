import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Space, Typography } from 'antd';
import { GlobalOutlined, ReloadOutlined } from '@ant-design/icons';
import { GenerateVehicleTranslationsRequestSchema, VehicleTranslationSuggestionsResponseSchema, type AdminVehicle, type VehicleDraftInput } from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { readVehicleLifecycle } from '../../shared/api/vehicle-lifecycle';
import { applyMachineTranslationSuggestions, TranslationContextChanged } from './machine-translation-model';

type Props = {
  vehicle: AdminVehicle;
  content: VehicleDraftInput['content'];
  hasUnsavedChanges: boolean;
  disabled?: boolean;
  onChange: (content: VehicleDraftInput['content']) => void;
  onBusyChange: (busy: boolean) => void;
  onConflict?: () => void;
};
type Intent = { key: string; body: string; vehicle: AdminVehicle; startedAt: number };

export function MachineTranslationActions({ vehicle, content, hasUnsavedChanges, disabled = false, onChange, onBusyChange, onConflict }: Props) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const intent = useRef<Intent | null>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const latest = useRef({ vehicle, content, hasUnsavedChanges, onChange, onBusyChange, onConflict });
  latest.current = { vehicle, content, hasUnsavedChanges, onChange, onBusyChange, onConflict };
  const chinese = vehicle.draft.content.title.sourceLanguage.split('-')[0] === 'zh' && (!vehicle.draft.content.description.sourceText || vehicle.draft.content.description.sourceLanguage.split('-')[0] === 'zh');
  const ready = chinese && Boolean(vehicle.draft.content.title.sourceText?.trim());

  useEffect(() => {
    mounted.current = true; epoch.current += 1;
    return () => { mounted.current = false; epoch.current += 1; latest.current.onBusyChange(false); };
  }, []);
  useEffect(() => { onBusyChange(busy || uncertain); }, [busy, uncertain, onBusyChange]);
  useEffect(() => { if (!intent.current && !running.current) setNotice(''); }, [vehicle.version]);

  async function generate(original = false) {
    if (running.current || disabled || hasUnsavedChanges || (!original && (!ready || uncertain))) return;
    if (!original) intent.current = { key: crypto.randomUUID(), body: JSON.stringify(GenerateVehicleTranslationsRequestSchema.parse({ version: vehicle.version })), vehicle: structuredClone(vehicle), startedAt: Date.now() };
    const snapshot = intent.current;
    if (!snapshot) return;
    if (Date.now() - snapshot.startedAt >= 24 * 60 * 60 * 1000) { setError('本次请求已超过24小时，请结束本次生成，核对当前草稿后重新生成。'); return; }
    const generation = epoch.current;
    const wasUncertain = uncertain;
    let receiptAccepted = false;
    let remoteChanged = false;
    const deadline = AbortSignal.timeout(35_000);
    running.current = true; setBusy(true); setError(''); setNotice(''); onBusyChange(true);
    try {
      const response = await request(`/api/v1/admin/vehicles/${encodeURIComponent(snapshot.vehicle.id)}/translation-suggestions`, VehicleTranslationSuggestionsResponseSchema, { method: 'POST', body: snapshot.body, headers: { 'Idempotency-Key': snapshot.key }, signal: deadline });
      receiptAccepted = true;
      // A successful response can be an immutable replay from before another employee edited/deleted the car.
      const current = await readVehicleLifecycle(snapshot.vehicle.id, deadline);
      if (!mounted.current || epoch.current !== generation) return;
      if (current.isDeleted || current.vehicle.id !== snapshot.vehicle.id || current.vehicle.version !== snapshot.vehicle.version) {
        remoteChanged = true;
        throw new TranslationContextChanged('服务端车辆已更新或删除，本次旧建议没有覆盖当前输入。请先核对最新版本。');
      }
      if (latest.current.hasUnsavedChanges || latest.current.vehicle.id !== snapshot.vehicle.id || latest.current.vehicle.version !== snapshot.vehicle.version) throw new TranslationContextChanged('草稿已变化，本次建议没有覆盖当前输入。请核对并保存后重新生成。');
      const result = await applyMachineTranslationSuggestions(current.vehicle, latest.current.content, response.data);
      if (!mounted.current || epoch.current !== generation) return;
      if (latest.current.hasUnsavedChanges || latest.current.vehicle.version !== snapshot.vehicle.version) throw new TranslationContextChanged('草稿已变化，本次建议没有覆盖当前输入。');
      intent.current = null; setUncertain(false);
      const text = result.applied ? `已填入${result.applied}项语言内容，请核对并保存草稿。${result.protected ? `已保留${result.protected}项人工或已审核内容。` : ''}` : '已有人工或已审核内容已保留，没有覆盖当前译文。';
      setNotice(text); void message.success(text);
      if (result.applied) latest.current.onChange(result.content);
    } catch (failure) {
      if (!mounted.current || epoch.current !== generation) return;
      const text = deadline.aborted ? '翻译等待超时，原请求已保留，请稍后核对重试。' : failure instanceof Error ? failure.message : '译文尚未生成，请稍后重试。';
      setError(text);
      const definite = failure instanceof TranslationContextChanged || failure instanceof ApiClientError && ([400, 401, 403, 404, 409, 413, 422, 429].includes(failure.status) || ['TRANSLATION_DISABLED', 'TRANSLATION_SOURCE_UNSUPPORTED', 'TRANSLATION_QUOTA_EXCEEDED'].includes(failure.code));
      const keep = !(failure instanceof TranslationContextChanged) && (wasUncertain || receiptAccepted || !definite);
      setUncertain(keep);
      if (!keep) intent.current = null;
      if (keep) void message.warning('尚未确认翻译结果，已保留原请求供核对重试。');
      else void message.error(text);
      if (remoteChanged || failure instanceof ApiClientError && failure.status === 409 && !keep) latest.current.onConflict?.();
    } finally {
      if (mounted.current && epoch.current === generation) { running.current = false; setBusy(false); }
    }
  }
  function dismiss() {
    if (running.current) return;
    intent.current = null; setUncertain(false); setError('');
    setNotice('已结束本次生成，没有修改已保存草稿。');
  }

  return <Card title={<Space wrap><GlobalOutlined />中文原文与机器翻译</Space>}>
    <Typography.Paragraph type="secondary">先填写并保存中文标题和描述，再生成英文、俄文草稿。机器译文保留“待审核”，人工编辑或已审核内容会继续保留；保存与发布仍分别操作。</Typography.Paragraph>
    {!chinese && <Alert showIcon type="info" title="请先准备中文原文" description="这条记录保留原来的来源语言。将标题和需要的描述整理为中文并保存后，才能生成英俄译文。" />}
    {hasUnsavedChanges && <Alert showIcon type="info" title="请先保存当前修改，再生成译文" style={{ marginBottom: 14 }} />}
    {error && <Alert showIcon type="error" title={error} style={{ marginBottom: 14 }} />}
    {notice && <Alert showIcon type="success" title={notice} style={{ marginBottom: 14 }} />}
    {uncertain ? <Space orientation="vertical" style={{ width: '100%' }}>
      <Alert showIcon type="warning" title="翻译结果尚未确认" description="原请求与版本已保留。重试会核对原结果，不会自动发布或覆盖人工内容；结束本次生成只会关闭当前建议的恢复入口。" />
      <Space wrap><Button icon={<ReloadOutlined />} loading={busy} disabled={disabled || hasUnsavedChanges || busy} onClick={() => void generate(true)}>重试原翻译请求</Button><Button disabled={busy} onClick={dismiss}>结束本次生成</Button></Space>
    </Space> : <Button type="primary" icon={<GlobalOutlined />} loading={busy} disabled={disabled || hasUnsavedChanges || busy || !ready} onClick={() => void generate()}>生成英俄译文</Button>}
  </Card>;
}
