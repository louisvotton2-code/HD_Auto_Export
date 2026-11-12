import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Collapse, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import {
  CreateTranslationPlanRequestSchema, TranslationPlanResponseSchema, TranslationPlanResultResponseSchema, TranslationPlanStatusResponseSchema,
  VehicleTranslationBundleResponseSchema, vehicleConfigurationItemId,
  type AdminVehicle, type DisplayField, type Drivetrain, type TranslationPlan, type TranslationPlanResult, type VehicleTranslationBundle,
} from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { displayFieldLabel, drivetrainLabels } from './vehicle-localization-model';
import { TranslationEditor } from './translation-editor';
import { DisplayTranslationsEditor } from './display-translations-editor';
import {
  applyTranslationPlanResult, assertTranslationPlan, assertWorkspaceFresh, assertWorkspaceSnapshot, translationPlanConfirmation,
  TranslationWorkspaceChanged, workspaceComparison, workspaceData, workspaceDirty, workspaceNeedsChineseNormalization, workspaceSaveRequest, type TranslationWorkspaceData,
} from './workspace-model';
import styles from './vehicle-translation-workspace.module.css';

export type TranslationWorkspaceGuard = { dirty: boolean; busy: boolean; uncertain: boolean };
export type VehicleTranslationWorkspaceProps = {
  vehicle: AdminVehicle;
  hasUnsavedChanges: boolean;
  disabled?: boolean;
  onGuardChange: (guard: TranslationWorkspaceGuard) => void;
  onBusyChange?: (busy: boolean) => void;
  onVehicleUpdated: (vehicle: AdminVehicle) => void;
  canAdoptVehicle: (vehicle: AdminVehicle) => boolean;
  onConflict: () => void;
};
type Phase = 'idle' | 'loading' | 'saving' | 'planning' | 'generating' | 'recovering';
type Session = {
  base: VehicleTranslationBundle | null; data: TranslationWorkspaceData | null; remote: VehicleTranslationBundle | null;
  phase: Phase; uncertain: 'save' | 'generate' | null; conflict: boolean; saveRetryAllowed: boolean;
  plan: TranslationPlan | null; planOpen: boolean; costAccepted: boolean; planExpired: boolean;
  execution: 'none' | 'running' | 'unknown' | 'ready' | 'completed' | 'partial';
};
type SaveIntent = { base: VehicleTranslationBundle; body: string };
type GenerateIntent = { base: VehicleTranslationBundle; plan: TranslationPlan; body: string; key: string };
const emptySession = (): Session => ({ base: null, data: null, remote: null, phase: 'idle', uncertain: null, conflict: false,
  saveRetryAllowed: false, plan: null, planOpen: false, costAccepted: false, planExpired: false, execution: 'none' });
const providers = { disabled: '未启用', libretranslate: '本地翻译服务', aliyun: '阿里云通用翻译' };
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : '操作未完成，当前输入仍保留。';

export function VehicleTranslationWorkspace(props: VehicleTranslationWorkspaceProps) {
  const { modal, message } = App.useApp();
  const [session, setSession] = useState<Session>(emptySession);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const state = useRef(session), latest = useRef(props); latest.current = props;
  const mounted = useRef(false), running = useRef(false), epoch = useRef(0);
  const vehicleId = useRef(props.vehicle.id);
  const saveIntent = useRef<SaveIntent | null>(null), generateIntent = useRef<GenerateIntent | null>(null);
  const planBase = useRef<VehicleTranslationBundle | null>(null);
  const generationId = useRef<string | null>(null);
  const dirty = workspaceDirty(session.base, session.data);
  const busy = session.phase !== 'idle';
  const staleBase = !!session.base && (session.base.vehicle.id !== props.vehicle.id || session.base.vehicle.version !== props.vehicle.version);
  const locked = !!props.disabled || props.hasUnsavedChanges || busy || !!session.uncertain || session.conflict || staleBase;
  const path = (id = latest.current.vehicle.id) => `/api/v1/admin/vehicles/${encodeURIComponent(id)}`;

  function update(patch: Partial<Session>) {
    const next = { ...state.current, ...patch }; state.current = next; setSession(next);
    const guard = { dirty: workspaceDirty(next.base, next.data), busy: next.phase !== 'idle', uncertain: !!next.uncertain || next.conflict };
    latest.current.onGuardChange(guard); latest.current.onBusyChange?.(guard.busy || !!next.uncertain);
  }
  function current(token: number) { return mounted.current && epoch.current === token; }
  function start(phase: Phase) { running.current = true; setError(''); setNotice(''); update({ phase }); return ++epoch.current; }
  function finish(token: number) { if (current(token)) { running.current = false; update({ phase: 'idle' }); } }
  function checkContext(bundle: VehicleTranslationBundle) {
    assertWorkspaceFresh(latest.current.vehicle, bundle, state.current.base);
    if (latest.current.hasUnsavedChanges || !latest.current.canAdoptVehicle(bundle.vehicle))
      throw new TranslationWorkspaceChanged('车辆资料已有更新或未保存的输入，请先保存并核对最新多语资料。');
  }
  async function readBundle(id = latest.current.vehicle.id) {
    const fresh = (await request(`${path(id)}/translation-bundle`, VehicleTranslationBundleResponseSchema, { signal: AbortSignal.timeout(35_000) })).data;
    checkContext(fresh); return fresh;
  }
  function accept(bundle: VehicleTranslationBundle) {
    checkContext(bundle);
    saveIntent.current = null; generateIntent.current = null; planBase.current = null;
    generationId.current = bundle.localization.data.facts.generation?.id ?? null;
    update({ ...emptySession(), phase: state.current.phase, base: bundle, data: workspaceData(bundle) });
    latest.current.onVehicleUpdated(bundle.vehicle);
  }
  function reportConflict(failure: unknown) {
    if (failure instanceof TranslationWorkspaceChanged || failure instanceof ApiClientError && [404, 409].includes(failure.status)) {
      update({ conflict: true }); latest.current.onConflict();
    }
  }
  async function load() {
    if (running.current || latest.current.hasUnsavedChanges) return;
    const token = start('loading');
    try { const fresh = await readBundle(); if (current(token)) accept(fresh); }
    catch (failure) { if (current(token)) setError(failureText(failure)); }
    finally { finish(token); }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current++; latest.current.onGuardChange({ dirty: false, busy: false, uncertain: false }); latest.current.onBusyChange?.(false); };
  }, []);
  useEffect(() => {
    if (vehicleId.current !== props.vehicle.id) {
      epoch.current++; running.current = false; vehicleId.current = props.vehicle.id;
      saveIntent.current = null; generateIntent.current = null; planBase.current = null; generationId.current = null;
      update(emptySession());
    }
    if (state.current.base?.vehicle.version === props.vehicle.version || running.current || workspaceDirty(state.current.base, state.current.data) || state.current.uncertain || state.current.conflict || props.hasUnsavedChanges) return;
    void load();
    // Reads use current parent guards; an old response can never replace an accepted newer version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.vehicle.id, props.vehicle.version, props.hasUnsavedChanges]);
  useEffect(() => {
    if (!session.plan || !session.planOpen) return;
    const expires = () => update({ planExpired: true, costAccepted: false });
    const remaining = Date.parse(session.plan.expiresAt) - Date.now();
    if (remaining <= 0) { expires(); return; }
    const timer = window.setTimeout(expires, remaining); return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.plan, session.planOpen]);

  function edit(data: TranslationWorkspaceData) {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || s.uncertain || s.conflict || !s.base || s.base.vehicle.version !== latest.current.vehicle.version) return;
    update({ data, plan: null, planOpen: false, costAccepted: false, execution: 'none' }); planBase.current = null;
    setError(''); setNotice('');
  }
  async function save(retry = false) {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || !s.base || !s.data || s.conflict || s.base.vehicle.version !== latest.current.vehicle.version ||
        (retry ? s.uncertain !== 'save' || !s.saveRetryAllowed : !!s.uncertain)) return;
    if (!retry) {
      try { saveIntent.current = { base: structuredClone(s.base), body: JSON.stringify(workspaceSaveRequest(s.base, s.data)) }; }
      catch (failure) { setError(failure instanceof TranslationWorkspaceChanged ? failure.message : '请检查译文长度、来源及资料格式后再保存。'); return; }
    }
    const intent = saveIntent.current; if (!intent) return;
    const token = start('saving'); update({ saveRetryAllowed: false });
    try {
      const saved = (await request(`${path(intent.base.vehicle.id)}/translation-bundle`, VehicleTranslationBundleResponseSchema,
        { method: 'PUT', body: intent.body, signal: AbortSignal.timeout(35_000) })).data;
      if (!current(token)) return;
      if (saved.vehicle.id !== intent.base.vehicle.id || saved.vehicle.version <= intent.base.vehicle.version || saved.localization.revision <= intent.base.localization.revision)
        throw new TranslationWorkspaceChanged('保存返回的版本未更新，请读取服务端结果核对。');
      accept(saved); setNotice('全部多语资料已保存。请重新打开发布预览核对。'); void message.success('全部多语资料已保存');
    } catch (failure) {
      if (!current(token)) return;
      const definite = failure instanceof ApiClientError && [400, 401, 403, 404, 409, 413, 422, 429].includes(failure.status);
      update({ uncertain: retry || !definite ? 'save' : null });
      if (definite && !retry) saveIntent.current = null;
      setError(failureText(failure)); reportConflict(failure);
    } finally { finish(token); }
  }
  async function compareOrRecoverSave() {
    if (running.current || latest.current.hasUnsavedChanges) return;
    const token = start('recovering');
    try {
      const fresh = await readBundle(); if (!current(token)) return;
      update({ remote: fresh });
      if (state.current.uncertain === 'save' && saveIntent.current) {
        try {
          assertWorkspaceSnapshot(saveIntent.current.base, fresh);
          update({ saveRetryAllowed: true }); setNotice('服务端仍为提交前版本。可明确重试原保存请求，输入与请求正文不会改变。');
        } catch {
          update({ saveRetryAllowed: false, conflict: true }); setNotice('服务端已返回不同版本。请比较后明确重新读取，不会自动覆盖当前输入。');
        }
      }
    } catch (failure) { if (current(token)) setError(failureText(failure)); }
    finally { finish(token); }
  }
  function discardAndReload() {
    if (running.current) return;
    modal.confirm({ title: '放弃本地多语修改并重新读取？', content: '当前未保存的译文和恢复入口将被清除。服务端已完成的保存不会撤销，已开始的翻译不会被取消，也可能已产生费用。',
      okText: '放弃并重新读取', cancelText: '保留输入', okButtonProps: { danger: true }, onOk: async () => {
        if (!mounted.current || running.current || latest.current.hasUnsavedChanges) return;
        const token = start('loading');
        try { const fresh = await readBundle(); if (current(token)) { accept(fresh); setNotice('已重新读取服务端多语资料。'); } }
        catch (failure) { if (current(token)) setError(failureText(failure)); }
        finally { finish(token); }
      } });
  }
  async function createPlan() {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || !s.base || !s.data || workspaceDirty(s.base, s.data) || s.uncertain || s.conflict ||
        s.base.sourceLanguageConfirmationRequired.length || s.base.vehicle.version !== latest.current.vehicle.version) return;
    const base = structuredClone(s.base), token = start('planning');
    update({ plan: null, planOpen: false, costAccepted: false, execution: 'none' });
    try {
      const plan = (await request(`${path(base.vehicle.id)}/translation-plans`, TranslationPlanResponseSchema,
        { method: 'POST', body: JSON.stringify(CreateTranslationPlanRequestSchema.parse({ version: base.vehicle.version })), signal: AbortSignal.timeout(35_000) })).data;
      const fresh = await readBundle(base.vehicle.id);
      assertWorkspaceSnapshot(base, fresh); await assertTranslationPlan(plan, fresh);
      if (!current(token)) return;
      checkContext(fresh);
      if (workspaceDirty(base, state.current.data)) throw new TranslationWorkspaceChanged();
      planBase.current = base;
      update({ plan, planOpen: true, costAccepted: false, planExpired: Date.parse(plan.expiresAt) <= Date.now() });
    } catch (failure) { if (current(token)) { setError(failureText(failure)); reportConflict(failure); } }
    finally { finish(token); }
  }
  async function adoptResult(intent: GenerateIntent, result: TranslationPlanResult, token: number) {
    const fresh = await readBundle(intent.base.vehicle.id);
    if (!current(token)) return;
    checkContext(fresh);
    if (!state.current.data) throw new TranslationWorkspaceChanged();
    const adopted = await applyTranslationPlanResult(intent.plan, intent.base, state.current.data, fresh, result);
    if (!current(token)) return;
    checkContext(fresh);
    if (!state.current.data || workspaceDirty(intent.base, state.current.data)) throw new TranslationWorkspaceChanged();
    generateIntent.current = null; planBase.current = null;
    update({ data: adopted.data, uncertain: null, execution: result.status, costAccepted: false });
    setNotice(result.status === 'partial'
      ? `本次有${adopted.missing}项译文未完成，成功的${adopted.applied}项已填入，保留${adopted.protected}项现有译文。可保存成功内容；未完成部分可能已产生费用，再试需重新确认新计划。`
      : `已填入${adopted.applied}项译文，保留${adopted.protected}项现有译文。请编辑并保存全部多语资料。`);
  }
  async function generate() {
    const s = state.current, base = planBase.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || s.uncertain || s.conflict || !s.plan || !base || !s.costAccepted || !s.data ||
        base.vehicle.id !== latest.current.vehicle.id || base.vehicle.version !== latest.current.vehicle.version || !latest.current.canAdoptVehicle(base.vehicle) || workspaceDirty(base, s.data)) return;
    let body: string;
    try { body = JSON.stringify(translationPlanConfirmation(s.plan)); }
    catch (failure) { setError(failureText(failure)); update({ costAccepted: false, planExpired: Date.parse(s.plan.expiresAt) <= Date.now() }); return; }
    const intent: GenerateIntent = { base: structuredClone(base), plan: structuredClone(s.plan), body, key: crypto.randomUUID() };
    generateIntent.current = intent;
    const token = start('generating'); update({ planOpen: false, costAccepted: false, execution: 'running' });
    try {
      const result = (await request(`${path(base.vehicle.id)}/translation-plans/${encodeURIComponent(intent.plan.id)}/generate`, TranslationPlanResultResponseSchema,
        { method: 'POST', body: intent.body, headers: { 'Idempotency-Key': intent.key }, signal: AbortSignal.timeout(150_000) })).data;
      await adoptResult(intent, result, token);
    } catch (failure) {
      if (current(token)) { update({ uncertain: 'generate', execution: 'unknown' }); setError(failureText(failure)); reportConflict(failure); }
    } finally { finish(token); }
  }
  async function recoverResult() {
    const intent = generateIntent.current;
    if (running.current || !intent || latest.current.hasUnsavedChanges) return;
    const token = start('recovering');
    try {
      const status = (await request(`${path(intent.base.vehicle.id)}/translation-plans/${encodeURIComponent(intent.plan.id)}`, TranslationPlanStatusResponseSchema,
        { signal: AbortSignal.timeout(35_000) })).data;
      if (!current(token)) return;
      if (status.planId !== intent.plan.id || status.vehicleId !== intent.base.vehicle.id) throw new TranslationWorkspaceChanged();
      if (status.result) await adoptResult(intent, status.result, token);
      else {
        update({ execution: status.state === 'running' ? 'running' : 'ready', uncertain: 'generate' });
        setNotice(status.state === 'running' ? '翻译仍在处理中。稍后继续读取结果，不会再次发起生成请求。' : '服务端尚未记录本计划的执行。当前不会重新发送生成请求；请结束本次计划后重新查看范围和费用。');
      }
    } catch (failure) { if (current(token)) { setError(failureText(failure)); reportConflict(failure); } }
    finally { finish(token); }
  }

  const base = session.base, data = session.data;
  const needsChineseNormalization = !!base && workspaceNeedsChineseNormalization(base);
  const fieldLabel = (field: DisplayField) => {
    if (field.ref.startsWith('configuration.')) {
      const item = base?.vehicle.draft.configuration?.items.find(item => field.ref.startsWith(`configuration.${vehicleConfigurationItemId(item.name)}.`));
      return item ? `${item.name} · ${field.ref.endsWith('.name') ? '配置名称' : '配置内容'}` : '车辆配置文字';
    }
    return displayFieldLabel(field, data?.localization.fields ?? [], base?.vehicle ?? props.vehicle);
  };
  const refLabel = (ref: string) => ref === 'content.title' ? '车辆标题' : ref === 'content.description' ? '车况描述'
    : (data?.localization.fields.find(field => field.ref === ref) ? fieldLabel(data.localization.fields.find(field => field.ref === ref)!) : '公开展示文字');
  const comparison = data && session.remote ? workspaceComparison(data, session.remote, fieldLabel) : [];
  const groups = data ? [
    { id: 'vehicle', label: '车辆展示资料', fields: data.localization.fields.filter(field => !field.ref.startsWith('configuration.') && !field.ref.startsWith('media.') && !field.ref.startsWith('price.includes.')) },
    { id: 'configuration', label: '车辆配置译文', fields: data.localization.fields.filter(field => field.ref.startsWith('configuration.')) },
    { id: 'images', label: '图片说明', fields: data.localization.fields.filter(field => field.ref.startsWith('media.')) },
    { id: 'price', label: '价格包含项目', fields: data.localization.fields.filter(field => field.ref.startsWith('price.includes.')) },
  ].filter(group => group.fields.length) : [];

  return <Form component={false} disabled={locked}><div className={styles.workspace}>
    {props.hasUnsavedChanges && <Alert type="warning" showIcon title="请先保存车辆资料，再编辑或生成译文" />}
    {staleBase && <Alert type="warning" showIcon title="车辆版本已更新，当前多语输入仍保留，请核对最新资料" />}
    {error && <Alert type="error" showIcon title={error} />}
    {notice && <Alert type={session.execution === 'partial' ? 'warning' : 'info'} showIcon title={notice} />}
    {!base || !data ? <Card loading={session.phase === 'loading'}><Typography.Paragraph>多语资料尚未读取完成。</Typography.Paragraph><Button disabled={busy || props.hasUnsavedChanges} onClick={() => void load()}>重新读取多语资料</Button></Card> : <>
      {needsChineseNormalization && <Alert type="info" showIcon title="中文内容将在保存时同步" description="中文直接使用基础资料里的原文，保存全部译文时同步，无需重复填写。" />}
      {!!base.sourceLanguageConfirmationRequired.length && <Card title="确认历史原文语言">
        <Typography.Paragraph>以下原文尚未声明为中文。请核对整页原文后一次确认；保存后会更新来源，旧译文需重新生成或修改。</Typography.Paragraph>
        <ul className={styles.sourceList}>{base.sourceLanguageConfirmationRequired.map(ref => <li key={ref}>{refLabel(ref)}</li>)}</ul>
        <Checkbox data-testid="translation-source-confirm" disabled={locked} checked={data.sourceLanguageConfirmations.length === base.sourceLanguageConfirmationRequired.length}
          onChange={event => edit({ ...data, sourceLanguageConfirmations: event.target.checked ? [...base.sourceLanguageConfirmationRequired] : [] })}>我确认以上原文均为中文</Checkbox>
      </Card>}
      <Card className={styles.generateCard}><div className={styles.generateRow}><div><Typography.Title level={5}>生成整车英俄译文</Typography.Title><Typography.Paragraph>中文原文来自基础资料，英俄译文在这里统一保存；保存后请重新确认发布预览。人工修订的译文会保留，原文变化时请同时更新保留内容。</Typography.Paragraph></div>
        <Button data-testid="vehicle-translation-generate" type="primary" loading={session.phase === 'planning'} disabled={locked || dirty || !!base.sourceLanguageConfirmationRequired.length} onClick={() => void createPlan()}>生成翻译</Button></div>
        {dirty && <Typography.Text type="secondary">请先保存当前多语修改，再生成新计划。</Typography.Text>}
      </Card>
      {(session.phase === 'generating' || session.uncertain === 'generate') && <Card title="翻译执行结果">
        <Typography.Paragraph>{session.phase === 'generating' ? '翻译正在执行，最长等待约两分半。关闭或断线不代表任务取消，也不代表没有费用。' : '结果尚需核对。读取结果只查询本次任务，不会重新发送收费请求。'}</Typography.Paragraph>
        <Space wrap><Button data-testid="translation-result-recover" disabled={busy || props.hasUnsavedChanges} loading={session.phase === 'recovering'} onClick={() => void recoverResult()}>读取翻译结果</Button>
          {session.execution === 'ready' && <Button disabled={busy || props.hasUnsavedChanges} onClick={discardAndReload}>结束本次计划并重新读取</Button>}</Space>
      </Card>}
      <TranslationEditor name="title" value={data.content.title} sourceText={base.vehicle.draft.content.title.sourceText ?? ''} sourceLanguage={base.vehicle.draft.content.title.sourceLanguage}
        requiredForPublish onChange={title => edit({ ...data, content: { ...data.content, title } })} disabled={locked} />
      <TranslationEditor name="description" value={data.content.description} sourceText={base.vehicle.draft.content.description.sourceText ?? ''} sourceLanguage={base.vehicle.draft.content.description.sourceLanguage}
        requiredForPublish={base.vehicle.draft.source.kind !== 'demo'} onChange={description => edit({ ...data, content: { ...data.content, description } })} disabled={locked} />
      <DisplayTranslationsEditor groups={groups} savedFields={base.localization.data.fields} disabled={locked} labelForField={fieldLabel}
        onChange={field => edit({ ...data, localization: { ...data.localization, fields: data.localization.fields.map(item => item.ref === field.ref ? field : item) } })} />
      <Collapse defaultActiveKey={[]} items={[{ key: 'facts', label: '补充代系与驱动形式', children: <>
        <Typography.Paragraph type="secondary">仅填写已知事实。修改代系后先保存，再编辑它对应的译文。</Typography.Paragraph>
        <div className={styles.factFields}><Form.Item label="代系名称"><Input aria-label="代系名称" disabled={locked} maxLength={120} value={data.localization.facts.generation?.name ?? ''}
          onChange={event => { const name = event.target.value; if (name.trim() && !generationId.current) generationId.current = `manual_${crypto.randomUUID().replaceAll('-', '')}`;
            edit({ ...data, localization: { ...data.localization, facts: { ...data.localization.facts, generation: name.trim() ? { id: data.localization.facts.generation?.id ?? generationId.current!, name } : null } } }); }} /></Form.Item>
          <Form.Item label="驱动形式"><Select aria-label="驱动形式" disabled={locked} value={data.localization.facts.drivetrain ?? ''}
            options={[{ value: '', label: '未知 / 未填写' }, ...Object.entries(drivetrainLabels).map(([value, label]) => ({ value, label }))]}
            onChange={value => edit({ ...data, localization: { ...data.localization, facts: { ...data.localization.facts, drivetrain: value ? value as Drivetrain : null } } })} /></Form.Item></div>
      </> }]} />
      {session.conflict && <Alert type="warning" showIcon title="资料版本已变化，当前输入没有被覆盖" description="可比较最新资料，或明确放弃本地修改后重新读取。" />}
      {session.uncertain === 'save' && <Alert type="warning" showIcon title="保存结果尚未确认" description="请先读取服务端结果。原保存正文和版本仍保留，不会自动再次提交。" />}
      {(session.conflict || session.uncertain === 'save') && <Button data-testid="translation-save-recover" disabled={busy || props.hasUnsavedChanges} onClick={() => void compareOrRecoverSave()}>读取最新多语资料供比较</Button>}
      {session.remote && <Card title="当前输入与服务端资料"><Typography.Paragraph>服务端车辆版本 {session.remote.vehicle.version}。内容相同仍可能有来源或译文记录变化。</Typography.Paragraph>
        <Table size="small" rowKey="key" pagination={false} scroll={{ x: 520 }} dataSource={comparison} columns={[
          { dataIndex: 'label', title: '字段' }, { dataIndex: 'local', title: '当前输入', render: text => <span className={styles.comparisonText}>{text}</span> },
          { dataIndex: 'remote', title: '服务端资料', render: text => <span className={styles.comparisonText}>{text}</span> },
        ]} /></Card>}
      <div className={styles.saveRow}><Button data-testid="translation-bundle-save" type="primary" loading={session.phase === 'saving'} disabled={locked || (!dirty && !needsChineseNormalization)} onClick={() => void save()}>保存全部多语资料</Button>
        {session.uncertain === 'save' && session.saveRetryAllowed && <Button disabled={busy || props.hasUnsavedChanges || !!props.disabled} onClick={() => void save(true)}>重试原多语保存请求</Button>}
        <Button disabled={busy || props.hasUnsavedChanges} onClick={discardAndReload}>放弃修改并重新读取</Button></div>
    </>}
    <Modal open={session.planOpen} title="确认翻译范围与费用" okText="确认费用并生成" cancelText="取消" onCancel={() => { if (!running.current) update({ planOpen: false, costAccepted: false }); }}
      onOk={() => void generate()} okButtonProps={{ 'data-testid': 'translation-plan-start', disabled: locked || !session.costAccepted || session.planExpired || session.plan?.provider === 'disabled' }}>
      {session.plan && <div className={styles.plan} data-testid="translation-plan-confirmation">
        <Typography.Paragraph>目标语言：英文、俄文；服务：{providers[session.plan.provider]}。</Typography.Paragraph>
        <Typography.Paragraph>最多 {session.plan.estimate.maximumCharacters} 个字符，最多 {session.plan.estimate.maximumRequests} 次请求；每小时字符预算 {session.plan.estimate.hourlyCharacterLimit}。这些是请求上界，并非实际账单。</Typography.Paragraph>
        <Alert showIcon type="warning" title="费用及免费额度未知，不能视为免费" description="确认后可能产生费用，失败或中断也可能已计费。人工修订的译文会保留，但计划所列字段仍可能发送翻译请求。" />
        <Typography.Paragraph>以下为本次固定范围。计划有效期至 {new Date(session.plan.expiresAt).toLocaleTimeString('zh-CN')}。</Typography.Paragraph>
        <ul className={styles.planFields}>{session.plan.fields.map(field => <li key={field.ref}><strong>{refLabel(field.ref)}</strong><span> · {field.sourceCharacters}字符</span><div className={styles.planSource}>{field.sourceText}</div></li>)}</ul>
        {session.planExpired && <Alert type="warning" title="计划已过期，请取消后重新生成费用计划" />}
        {session.plan.provider === 'disabled' && <Alert type="warning" title="翻译服务尚未启用，可继续人工编辑译文" />}
        <Checkbox data-testid="translation-generate-confirm" disabled={locked || session.planExpired || session.plan.provider === 'disabled'} checked={session.costAccepted}
          onChange={event => update({ costAccepted: event.target.checked })}>我已核对翻译范围与参数，并接受可能产生的费用</Checkbox>
      </div>}
    </Modal>
  </div></Form>;
}
