import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Alert, App, Button, Card, Collapse, Form, Input, Space, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { CopyOutlined, UploadOutlined } from '@ant-design/icons';
import {
  CONFIGURATION_IMPORT_JSON_BYTES, CONFIGURATION_IMPORT_LOCALES, ConfigurationImportPreviewRequestSchema, ConfigurationImportPreviewResponseSchema,
  ConfigurationImportSaveRequestSchema, VehicleTranslationBundleResponseSchema, vehicleConfigurationItemId,
  type AdminVehicle, type ConfigurationImportDocument, type ConfigurationImportPreview, type ConfigurationImportPreviewRequest, type DisplayField,
  type VehicleTranslationBundle,
} from '@hd/contracts/admin';
import { ApiClientError, requestWithTimeout } from '../../shared/api/client';
import {
  configurationImportIssues, importExampleText, importLocaleLabels, prepareConfigurationImport, previewImportRows, savedImportRows,
  type ImportComparisonRow,
} from './configuration-import-model';
import { ConfigurationImportFields } from './configuration-import-fields';
import { readConfigurationFacts } from './configuration-facts';
import styles from './vehicle-configuration-import.module.css';

export type ConfigurationImportGuard = { dirty: boolean; busy: boolean; uncertain: boolean };
type Props = {
  vehicle: AdminVehicle | null; active: boolean; disabled: boolean; hasUnsavedChanges: boolean;
  prompt: (fields: readonly DisplayField[]) => string;
  publicationIssue?: (fields: readonly DisplayField[]) => string;
  onGuardChange: (guard: ConfigurationImportGuard) => void; onSaved: (vehicle: AdminVehicle) => void;
};
type Phase = 'reading' | 'previewing' | 'saving' | 'refreshing' | null;
type Preview = { source: string; input: ConfigurationImportPreviewRequest; output: ConfigurationImportPreview };
type Issue = { path: string; message: string };
type ContextError = { vehicleId: string; version: number; message: string };
const comparisonColumns: TableColumnsType<ImportComparisonRow> = [
  { title: '字段', dataIndex: 'label', rowScope: 'row', width: '28%' },
  ...CONFIGURATION_IMPORT_LOCALES.map(locale => ({ title: importLocaleLabels[locale], dataIndex: locale,
    render: (text: string | null) => text ?? '—' })),
];

export function VehicleConfigurationImport({ vehicle, active, prompt, disabled, hasUnsavedChanges, publicationIssue, onGuardChange, onSaved }: Props) {
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
  const [bundle, setBundle] = useState<VehicleTranslationBundle | null>(null);
  const [contextError, setContextError] = useState<ContextError | null>(null);
  const [contextRetry, setContextRetry] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  const guard = useRef(onGuardChange); guard.current = onGuardChange;
  const busy = phase !== null;
  const hasChanges = !!raw.trim();
  const editable = !!vehicle && !disabled && !hasUnsavedChanges && !busy && !uncertain;
  const path = vehicle ? `/api/v1/admin/vehicles/${encodeURIComponent(vehicle.id)}` : '';
  const vehicleId = vehicle?.id;
  const version = vehicle?.version;
  const currentBundle = bundle && bundle.vehicle.id === vehicleId && bundle.vehicle.version === version ? bundle : null;
  const currentFields = currentBundle?.localization.data.fields;
  const readError = contextError?.vehicleId === vehicleId && contextError?.version === version ? contextError?.message : undefined;
  const promptReady = !vehicle || (!!currentFields && !hasUnsavedChanges && !needsRefresh && !readError);
  const currentPreview = !needsRefresh && preview && preview.input.version === version && preview.source === raw ? preview : null;
  const comparisonRows = useMemo(() => {
    if (currentPreview && document && vehicle) return previewImportRows(document, vehicle, currentFields ?? []);
    return currentBundle ? savedImportRows(currentBundle) : [];
  }, [currentPreview, document, vehicle, currentFields, currentBundle]);
  const savedItems = vehicle?.draft.configuration?.items;
  const beforeItems = new Map(savedItems?.map(item => [vehicleConfigurationItemId(item.name), item.name]));
  const afterItems = new Map(document?.items?.map(item => [item.id, item.name.zh]));
  const itemOrder = currentPreview?.output.itemOrder;
  const removedItems = itemOrder ? itemOrder.before.filter(id => !itemOrder.after.includes(id)).map(id => beforeItems.get(id) ?? id) : [];
  const conflicts = currentPreview?.output.warnings?.filter(warning => warning.code !== 'UNVERIFIED_CONFIGURATION_VALUE') ?? [];
  const { fields: standardValues, errors: standardErrors } = useMemo(() => {
    const rows = document?.items?.map(({ name, value }) => ({ name: name.zh, value: value.zh })) ?? [];
    const savedValues = new Map(savedItems?.map(({ name, value }) => [name, value]));
    return { fields: readConfigurationFacts(rows).fields, errors: readConfigurationFacts(rows.filter(row => savedValues.get(row.name) !== row.value)).errors };
  }, [document, savedItems]);
  const currentPowertrain = vehicle?.draft.facts.powertrain;
  const savedPowertrain = useMemo(() => readConfigurationFacts(savedItems ?? []).fields.powertrain, [savedItems]);
  const configurationPowertrain = document?.items ? standardValues.powertrain : savedPowertrain;
  const powertrain = document?.facts?.powertrain ?? currentPowertrain;
  const powertrainMismatch = !!configurationPowertrain && configurationPowertrain !== powertrain &&
    (configurationPowertrain !== savedPowertrain || powertrain !== currentPowertrain);
  const standardInvalid = powertrainMismatch || standardErrors.length > 0;

  const rememberBundle = useCallback((data: VehicleTranslationBundle) => {
    setBundle(previous => {
      if (previous?.vehicle.id === data.vehicle.id &&
          (previous.vehicle.version > data.vehicle.version || previous.localization.revision > data.localization.revision)) return previous;
      return data;
    });
    setContextError(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; guard.current({ dirty: false, busy: false, uncertain: false }); };
  }, []);
  useEffect(() => { guard.current({ dirty: hasChanges, busy, uncertain }); }, [hasChanges, busy, uncertain]);
  useEffect(() => {
    if (!active || !vehicleId || version === undefined || hasUnsavedChanges) return;
    const controller = new AbortController();
    void requestWithTimeout(`${path}/translation-bundle`, VehicleTranslationBundleResponseSchema, 20_000, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (data.vehicle.id !== vehicleId || data.vehicle.deletedAt) throw new ApiClientError(0, 'INVALID_RESPONSE');
        if (data.vehicle.version !== version) {
          setContextError({ vehicleId, version, message: '草稿版本已变化。请先读取最新草稿。' });
          setNeedsRefresh(true);
          return;
        }
        rememberBundle(data);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setContextError({ vehicleId, version, message: failure instanceof ApiClientError ? failure.message : '暂时无法读取车辆公开字段。' });
      });
    return () => controller.abort();
  }, [active, contextRetry, hasUnsavedChanges, path, rememberBundle, vehicleId, version]);

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
    if (!promptReady || busy) return;
    try {
      await navigator.clipboard.writeText(prompt(currentFields ?? []));
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
    const { data } = await requestWithTimeout(`${path}/translation-bundle`, VehicleTranslationBundleResponseSchema, 20_000);
    if (data.vehicle.id !== vehicle?.id || data.vehicle.deletedAt || data.localization.vehicleId !== data.vehicle.id ||
        data.localization.vehicleVersion !== data.vehicle.version || data.vehicle.version < vehicle.version)
      throw new ApiClientError(0, 'INVALID_RESPONSE');
    return data;
  }

  async function previewImport() {
    if (!editable || !hasChanges || !start('previewing')) return;
    setPreview(null);
    try {
      const { document, json } = prepareConfigurationImport(raw);
      setDocument(document);
      const current = await loadBundle();
      if (!mounted.current) return;
      if (current.vehicle.version !== vehicle?.version) {
        setNeedsRefresh(true); setError('草稿有更新，请先读取最新版本，再预览当前文件。'); return;
      }
      rememberBundle(current);
      const input = ConfigurationImportPreviewRequestSchema.parse({
        version: current.vehicle.version, localizationRevision: current.localization.revision, json,
      });
      const { data } = await requestWithTimeout(`${path}/configuration-import/preview`, ConfigurationImportPreviewResponseSchema, 25_000, {
        method: 'POST', body: JSON.stringify(input),
      });
      if (!mounted.current) return;
      if (data.version !== input.version || data.localizationRevision !== input.localizationRevision)
        throw new ApiClientError(0, 'INVALID_RESPONSE');
      setPreview({ source: raw, input, output: data });
      setNeedsRefresh(false);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiClientError && failure.status === 409) setNeedsRefresh(true);
      showError(failure);
    } finally { finish(); }
  }

  async function saveImport() {
    if (!editable || !currentPreview || standardInvalid ||
        (!currentPreview.output.changes.length && !currentPreview.output.itemOrder) || !start('saving')) return;
    try {
      const body = ConfigurationImportSaveRequestSchema.parse({ ...currentPreview.input, previewToken: currentPreview.output.previewToken });
      const { data } = await requestWithTimeout(`${path}/configuration-import`, VehicleTranslationBundleResponseSchema, 35_000, {
        method: 'PUT', body: JSON.stringify(body),
      });
      if (!mounted.current) return;
      if (data.vehicle.id !== vehicle.id || data.vehicle.deletedAt || data.localization.vehicleId !== vehicle.id ||
          data.localization.vehicleVersion !== data.vehicle.version || data.vehicle.version <= currentPreview.input.version ||
          data.localization.revision < currentPreview.input.localizationRevision) throw new ApiClientError(0, 'INVALID_RESPONSE');
      change('');
      rememberBundle(data);
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
      rememberBundle(current);
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
      <Typography.Paragraph>复制提示词给你的 AI。上传生成的 JSON 文件，核对后保存到草稿。</Typography.Paragraph>
      <Button icon={<CopyOutlined />} disabled={busy || !promptReady} onClick={() => void copyPrompt()}>复制三语 JSON 提示词</Button>
    </div>
    {vehicle && !hasUnsavedChanges && !currentBundle && !readError && <Typography.Text type="secondary">正在读取本车三语资料…</Typography.Text>}
    {readError && !hasUnsavedChanges && <Alert type="warning" showIcon title={readError}
      action={<Button disabled={busy} onClick={() => { setContextError(null); setContextRetry(previous => previous + 1); }}>重新读取公开字段</Button>} />}
    <Collapse className={styles.details} activeKey={open} onChange={keys => setOpen(keys)} items={[
      { key: 'prompt', label: '查看 AI 提示词', collapsible: promptReady ? undefined : 'disabled', children: <Input.TextArea aria-label="三语 JSON 提示词" readOnly value={promptReady ? prompt(currentFields ?? []) : ''} autoSize={{ minRows: 8, maxRows: 20 }} className={styles.input} /> },
      { key: 'example', label: '查看三语 JSON 示例', children: <pre className={styles.example}>{importExampleText}</pre> },
    ]} />
    {!vehicle && <Alert type="info" showIcon title="先保存基础资料，再导入 JSON" />}
    {vehicle && hasUnsavedChanges && <Alert type="info" showIcon title="请先保存当前草稿编辑，再导入 JSON" />}
    {publicationIssue && <Alert type="warning" showIcon title="发布前请在 JSON 中补齐资料" description={publicationIssue(currentFields ?? [])} />}
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
    {currentPreview && <>
      {powertrainMismatch && <Alert type="error" showIcon title="配置项目中的动力类型与车辆动力类型不一致"
        description="请在 JSON 中核对动力类型配置和 facts.powertrain，再重新预览。" />}
      {standardErrors.length > 0 && <Alert type="error" showIcon title="请修正标准参数并重新预览"
        description={<ul className={styles.errors}>{standardErrors.map(issue => <li key={issue}>{issue}</li>)}</ul>} />}
      {conflicts.length > 0 && <Alert type="warning" showIcon title="部分配置与详细车辆信息有差异" description={<ul className={styles.errors}>
        {conflicts.map(warning => {
          const index = /^json\.items\.(\d+)\.value$/.exec(warning.path)?.[1];
          const name = index === undefined ? '配置项目' : document?.items?.[Number(index)]?.name.zh ?? '配置项目';
          return <li key={`${warning.path}.${warning.code}`}>{name}。本次配置填写「{warning.submitted}」。{warning.retained === null
            ? '发现同一参数有不同值，请核对后再确认。'
            : `详细车辆信息采用已确认的「${warning.retained}」。`}</li>;
        })}
      </ul>} />}
      {removedItems.length > 0 && <Alert type="warning" showIcon title={`本次将移除 ${removedItems.length} 项配置`}
        description={<Typography.Text className={styles.removedItems}>{removedItems.join('、')}</Typography.Text>} />}
      {itemOrder && <Collapse items={[{ key: 'item-order', label: '查看导入后的配置顺序', children: <>
        <Typography.Paragraph>{itemOrder.after.map(id => afterItems.get(id) ?? id).join('、') || '无配置'}</Typography.Paragraph>
      </> }]} />}
      {!currentPreview.output.changes.length && <Typography.Paragraph>没有文字内容发生变化</Typography.Paragraph>}
    </>}
    {comparisonRows.length > 0 && <section aria-label={currentPreview ? '待保存的三语资料' : '已保存的三语资料'} className={styles.comparisonTable}>
      <Typography.Title level={5}>{currentPreview ? '待保存的三语资料' : '已保存的三语资料'}</Typography.Title>
      <Table size="small" tableLayout="fixed" dataSource={comparisonRows} pagination={{ pageSize: 10, showSizeChanger: false }} columns={comparisonColumns} />
    </section>}
    {currentPreview &&
      <Button type="primary" disabled={!editable || standardInvalid || (!currentPreview.output.changes.length && !currentPreview.output.itemOrder)} loading={phase === 'saving'}
        onClick={() => void saveImport()}>确认并保存三语资料</Button>
    }
  </Card>;
}
