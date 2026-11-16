import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Alert, App, Button, Card, Collapse, Form, Input, Space, Table, Typography } from 'antd';
import { CopyOutlined, UploadOutlined } from '@ant-design/icons';
import {
  CONFIGURATION_IMPORT_JSON_BYTES, ConfigurationImportPreviewRequestSchema, ConfigurationImportPreviewResponseSchema,
  ConfigurationImportSaveRequestSchema, VehicleTranslationBundleResponseSchema, parseConfigurationImportJson, vehicleConfigurationItemId,
  type AdminVehicle, type ConfigurationImportDocument, type ConfigurationImportPreview, type ConfigurationImportPreviewRequest,
} from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { configurationImportIssues, importExampleText } from './configuration-import-model';
import { ConfigurationImportFields } from './configuration-import-fields';
import { powertrainLabels } from './draft-form';
import styles from './vehicle-configuration-editor.module.css';

type Guard = { dirty: boolean; busy: boolean; uncertain: boolean };
type Props = {
  vehicle: AdminVehicle | null; prompt: string; disabled: boolean; hasUnsavedChanges: boolean;
  onGuardChange: (guard: Guard) => void; onSaved: (vehicle: AdminVehicle) => void;
};
type Phase = 'reading' | 'previewing' | 'saving' | 'refreshing' | null;
type Preview = { input: ConfigurationImportPreviewRequest; output: ConfigurationImportPreview };
type Issue = { path: string; message: string };

export function VehicleConfigurationImport({ vehicle, prompt, disabled, hasUnsavedChanges, onGuardChange, onSaved }: Props) {
  const { message, modal } = App.useApp();
  const [raw, setRaw] = useState('');
  const [document, setDocument] = useState<ConfigurationImportDocument | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  const guard = useRef(onGuardChange); guard.current = onGuardChange;
  const busy = phase !== null;
  const hasChanges = !!raw.trim();
  const editable = !!vehicle && !disabled && !hasUnsavedChanges && !busy && !uncertain;
  const path = vehicle ? `/api/v1/admin/vehicles/${encodeURIComponent(vehicle.id)}` : '';
  const beforeItems = new Map(vehicle?.draft.configuration?.items.map(item => [vehicleConfigurationItemId(item.name), item.name]));
  const afterItems = new Map(document?.items?.map(item => [item.id, item.name.zh]));
  function displayValue(path: string, value: string | null, empty: string) {
    if (value === null) return empty;
    if (path === 'facts.powertrain') return powertrainLabels[value as keyof typeof powertrainLabels] ?? value;
    return value;
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; guard.current({ dirty: false, busy: false, uncertain: false }); };
  }, []);
  useEffect(() => { guard.current({ dirty: hasChanges, busy, uncertain }); }, [hasChanges, busy, uncertain]);

  function start(next: Phase) {
    if (operation.current) return false;
    operation.current = true;
    setPhase(next); setError(''); setIssues([]); setNotice('');
    return true;
  }
  function finish() {
    operation.current = false;
    if (mounted.current) setPhase(null);
  }
  function change(value: string, parsed: ConfigurationImportDocument | null = null) {
    setRaw(value); setDocument(parsed); setPreview(null); setIssues([]); setError(''); setNotice('');
  }
  function expand(key: string) {
    setOpen(previous => previous.includes(key) ? previous : [...previous, key]);
  }
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      void message.success('已复制三语 JSON 提示词。');
    } catch {
      expand('prompt');
      void message.info('请在下方手动复制提示词。');
    }
  }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !editable || !start('reading')) return;
    try {
      if (file.size > CONFIGURATION_IMPORT_JSON_BYTES) throw new Error('JSON 文件最多 512 KiB。');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (mounted.current) {
        change(text); setNotice(`已读取 ${file.name}，请预览变更。`);
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof TypeError ? '文件不是有效的 UTF-8 JSON。' : failure instanceof Error ? failure.message : '无法读取文件。');
    } finally { finish(); }
  }
  function showError(failure: unknown) {
    const fields = failure instanceof ApiClientError ? failure.fields : configurationImportIssues(failure);
    if (fields.length) setIssues(fields.map(({ path, message }) => ({ path, message })));
    setError(failure instanceof ApiClientError ? failure.message : '请检查标出的 JSON 字段。');
  }

  async function loadBundle() {
    const { data } = await request(`${path}/translation-bundle`, VehicleTranslationBundleResponseSchema, { signal: AbortSignal.timeout(20_000) });
    if (data.vehicle.id !== vehicle?.id || data.vehicle.deletedAt || data.localization.vehicleId !== data.vehicle.id ||
        data.localization.vehicleVersion !== data.vehicle.version || data.vehicle.version < vehicle.version)
      throw new ApiClientError(0, 'INVALID_RESPONSE');
    return data;
  }

  async function previewImport() {
    if (!editable || !hasChanges || !start('previewing')) return;
    setPreview(null);
    try {
      const parsed = parseConfigurationImportJson(raw);
      setDocument(parsed);
      const current = await loadBundle();
      if (!mounted.current) return;
      if (current.vehicle.version !== vehicle?.version) {
        setNeedsRefresh(true); setError('草稿有更新，请先读取最新版本，再预览当前文件。'); return;
      }
      const input = ConfigurationImportPreviewRequestSchema.parse({
        version: current.vehicle.version, localizationRevision: current.localization.revision, json: raw,
      });
      const { data } = await request(`${path}/configuration-import/preview`, ConfigurationImportPreviewResponseSchema, {
        method: 'POST', body: JSON.stringify(input), signal: AbortSignal.timeout(25_000),
      });
      if (!mounted.current) return;
      if (data.version !== input.version || data.localizationRevision !== input.localizationRevision)
        throw new ApiClientError(0, 'INVALID_RESPONSE');
      setPreview({ input, output: data });
      setNeedsRefresh(false);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiClientError && failure.status === 409) setNeedsRefresh(true);
      showError(failure);
    } finally { finish(); }
  }

  async function saveImport() {
    if (!editable || !preview || preview.input.version !== vehicle?.version || preview.input.json !== raw ||
        (!preview.output.changes.length && !preview.output.itemOrder) || !start('saving')) return;
    try {
      const body = ConfigurationImportSaveRequestSchema.parse({ ...preview.input, previewToken: preview.output.previewToken });
      const { data } = await request(`${path}/configuration-import`, VehicleTranslationBundleResponseSchema, {
        method: 'PUT', body: JSON.stringify(body), signal: AbortSignal.timeout(35_000),
      });
      if (!mounted.current) return;
      if (data.vehicle.id !== vehicle.id || data.vehicle.deletedAt || data.localization.vehicleId !== vehicle.id ||
          data.localization.vehicleVersion !== data.vehicle.version || data.vehicle.version <= preview.input.version ||
          data.localization.revision < preview.input.localizationRevision) throw new ApiClientError(0, 'INVALID_RESPONSE');
      change('');
      onSaved(data.vehicle);
      setNotice('三语资料已保存到草稿。'); void message.success('三语资料已保存到草稿。');
    } catch (failure) {
      if (!mounted.current) return;
      if (!(failure instanceof ApiClientError) || failure.status === 0 || failure.status >= 500) setUncertain(true);
      if (failure instanceof ApiClientError && failure.status === 409) {
        setPreview(null); setNeedsRefresh(true);
        setError('预览已过期或草稿版本已变，请读取最新版本后重新预览。');
      } else showError(failure);
    } finally { finish(); }
  }

  async function refreshVersion() {
    if (!vehicle || disabled || hasUnsavedChanges || !start('refreshing')) return;
    try {
      const current = await loadBundle();
      if (!mounted.current) return;
      onSaved(current.vehicle);
      setPreview(null); setUncertain(false); setNeedsRefresh(false);
      setNotice('已读取当前草稿。请重新预览并核对导入差异。');
    } catch (failure) { if (mounted.current) showError(failure); }
    finally { finish(); }
  }

  function edit(update: (value: ConfigurationImportDocument) => void) {
    if (!document || !editable || operation.current) return;
    const next = structuredClone(document);
    update(next); change(JSON.stringify(next, null, 2), next);
  }

  return <Card title="导入中英俄车辆资料" className={styles.card}>
    <div className={styles.instructions}>
      <Typography.Paragraph>复制提示词给你的 AI。上传或粘贴单个 JSON，预览变更后保存到草稿。</Typography.Paragraph>
      <Button icon={<CopyOutlined />} disabled={busy} onClick={() => void copyPrompt()}>复制三语 JSON 提示词</Button>
    </div>
    <Collapse className={styles.details} activeKey={open} onChange={keys => setOpen(keys)} items={[
      { key: 'prompt', label: '查看 AI 提示词', children: <Input.TextArea aria-label="三语 JSON 提示词" readOnly value={prompt} autoSize={{ minRows: 8, maxRows: 20 }} className={styles.input} /> },
      { key: 'example', label: '查看三语 JSON 示例', children: <pre className={styles.example}>{importExampleText}</pre> },
    ]} />
    {!vehicle && <Alert type="info" showIcon title="先保存基础资料，再导入 JSON" />}
    {vehicle && hasUnsavedChanges && <Alert type="info" showIcon title="请先保存当前草稿编辑，再导入 JSON" />}
    <Form.Item label="三语 JSON" htmlFor="configuration-import-json">
      <Input.TextArea id="configuration-import-json" value={raw} disabled={!editable} onChange={event => change(event.target.value)}
        aria-invalid={issues.length > 0} placeholder="粘贴完整 JSON，或从文件读取" autoSize={{ minRows: 5, maxRows: 14 }} className={styles.input} spellCheck={false} />
    </Form.Item>
    <input type="file" ref={fileInput} accept=".json,application/json" hidden onChange={event => void readFile(event)} />
    <Space wrap className={styles.valid}>
      <Button icon={<UploadOutlined />} disabled={!editable} loading={phase === 'reading'} onClick={() => fileInput.current?.click()}>上传 JSON</Button>
      <Button type="primary" disabled={!editable || !hasChanges} loading={phase === 'previewing'} onClick={() => void previewImport()}>预览导入变更</Button>
      {hasChanges && <Button disabled={!editable} onClick={() => modal.confirm({ title: '清除当前导入内容？', okText: '清除', cancelText: '取消', onOk: () => change('') })}>清除导入内容</Button>}
    </Space>
    {notice && <Alert type="success" showIcon title={notice} />}
    {error && <Alert type="error" showIcon title={error} description={issues.length ? <ul className={styles.errors}>{issues.map(({ path, message }, index) =>
      <li key={index}><code>{path}</code>：{message}</li>)}</ul> : undefined} />}
    {uncertain && <Alert type="warning" showIcon title="保存结果待核对" description="请读取服务端草稿版本，再决定是否重新预览。" />}
    {(uncertain || needsRefresh) && <Button disabled={disabled || hasUnsavedChanges || busy} loading={phase === 'refreshing'} onClick={() => void refreshVersion()}>读取最新草稿版本</Button>}
    {document && <section className={styles.importItem} aria-label="文件中的三语内容">
      <Typography.Title level={5}>核对并编辑文件内容</Typography.Title>
      <ConfigurationImportFields key={String(document.items?.length ?? 0)} document={document} disabled={!editable} edit={edit} />
    </section>}
    {preview && preview.input.version === vehicle?.version && <>
      <Typography.Title level={5}>将保存到草稿的变更</Typography.Title>
      {preview.output.itemOrder && <Collapse items={[{ key: 'item-order', label: '查看配置项目和顺序变化', children: <>
        <Typography.Paragraph>当前：{preview.output.itemOrder.before.map(id => beforeItems.get(id) ?? id).join('、') || '无配置'}</Typography.Paragraph>
        <Typography.Paragraph>导入后：{preview.output.itemOrder.after.map(id => afterItems.get(id) ?? id).join('、') || '无配置'}</Typography.Paragraph>
      </> }]} />}
      <Table size="small" dataSource={preview.output.changes} rowKey="path" pagination={{ pageSize: 8, showSizeChanger: false }}
        className={styles.details} locale={{ emptyText: '没有文字内容发生变化' }} columns={[
          { title: '字段', dataIndex: 'path', render: value => value === 'facts.powertrain' ? '动力类型' : value },
          { title: '当前草稿', dataIndex: 'before', render: (value, row) => displayValue(row.path, value, '未填写') },
          { title: '导入后', dataIndex: 'after', render: (value, row) => displayValue(row.path, value, '移除') },
        ]} />
      <Button type="primary" disabled={!editable || (!preview.output.changes.length && !preview.output.itemOrder)} loading={phase === 'saving'}
        onClick={() => void saveImport()}>确认并保存三语资料</Button>
    </>}
  </Card>;
}
