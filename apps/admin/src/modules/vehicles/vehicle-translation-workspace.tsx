import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Collapse, Form, Input, Select, Space, Table, Typography } from 'antd';
import {
  VehicleTranslationBundleResponseSchema,
  type AdminVehicle, type DisplayField, type Drivetrain, type PublicationIssue, type VehicleTranslationBundle,
} from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { displayFieldLabel, drivetrainLabels } from './vehicle-localization-model';
import { TranslationEditor } from './translation-editor';
import { DisplayTranslationsEditor } from './display-translations-editor';
import { publicationIssueDetail, publicationTranslationTarget } from './vehicle-actions-model';
import {
  assertWorkspaceFresh, assertWorkspaceSnapshot,
  TranslationWorkspaceChanged, workspaceComparison, workspaceData, workspaceDirty, workspaceNeedsChineseNormalization, workspaceSaveRequest, workspaceIsFactsOnly, workspaceIsSourceDeclarationOnly, workspaceTranslationGaps, type TranslationWorkspaceData,
} from './workspace-model';
import styles from './vehicle-translation-workspace.module.css';

export type TranslationWorkspaceGuard = { dirty: boolean; busy: boolean; uncertain: boolean };
export type PublicationTranslationFocus = { issue: PublicationIssue; vehicleId: string; version: number };
export type VehicleTranslationWorkspaceProps = {
  vehicle: AdminVehicle;
  hasUnsavedChanges: boolean;
  active: boolean;
  publicationIssues: PublicationIssue[];
  publicationFocus: PublicationTranslationFocus | null;
  disabled?: boolean;
  onGuardChange: (guard: TranslationWorkspaceGuard) => void;
  onBusyChange?: (busy: boolean) => void;
  onVehicleUpdated: (vehicle: AdminVehicle) => void;
  canAdoptVehicle: (vehicle: AdminVehicle) => boolean;
  onConflict: () => void;
};
type Phase = 'idle' | 'loading' | 'saving' | 'recovering';
type Session = {
  base: VehicleTranslationBundle | null; data: TranslationWorkspaceData | null; remote: VehicleTranslationBundle | null;
  phase: Phase; uncertain: boolean; conflict: boolean; saveRetryAllowed: boolean; normalizationChecked: boolean;
};
type SaveIntent = { base: VehicleTranslationBundle; body: string; dirty: boolean };
const emptySession = (): Session => ({
  base: null, data: null, remote: null, phase: 'idle', uncertain: false, conflict: false,
  saveRetryAllowed: false, normalizationChecked: false,
});
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : '操作未完成，当前输入仍保留。';

export function VehicleTranslationWorkspace(props: VehicleTranslationWorkspaceProps) {
  const { modal, message } = App.useApp();
  const [session, setSession] = useState<Session>(emptySession);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeDisplayGroups, setActiveDisplayGroups] = useState<string[]>();
  const workspace = useRef<HTMLDivElement>(null);
  const handledPublicationFocus = useRef<PublicationTranslationFocus | null>(null);
  const publicationIssueRegion = useRef<HTMLElement>(null);
  const state = useRef(session), latest = useRef(props); latest.current = props;
  const mounted = useRef(false), running = useRef(false), epoch = useRef(0);
  const vehicleId = useRef(props.vehicle.id);
  const saveIntent = useRef<SaveIntent | null>(null);
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
    const data = workspaceData(bundle);
    saveIntent.current = null;
    generationId.current = bundle.localization.data.facts.generation?.id ?? null;
    update({ ...emptySession(), phase: state.current.phase, base: bundle, data });
    latest.current.onVehicleUpdated(bundle.vehicle);
    return data;
  }
  function reportConflict(failure: unknown) {
    if (failure instanceof TranslationWorkspaceChanged || failure instanceof ApiClientError && [404, 409].includes(failure.status)) {
      update({ conflict: true }); latest.current.onConflict();
    }
  }
  async function load(discarded = false) {
    if (!mounted.current || running.current || latest.current.hasUnsavedChanges) return;
    const token = start('loading');
    try {
      const fresh = await readBundle();
      if (!current(token)) return;
      accept(fresh);
      if (discarded) setNotice('已重新读取服务端多语资料。');
    }
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
      saveIntent.current = null; generationId.current = null;
      update(emptySession());
    }
    if (state.current.base?.vehicle.version === props.vehicle.version || running.current || workspaceDirty(state.current.base, state.current.data) || state.current.uncertain || state.current.conflict || props.hasUnsavedChanges) return;
    void load();
    // Reads use current parent guards; an old response can never replace an accepted newer version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.vehicle.id, props.vehicle.version, props.hasUnsavedChanges]);
  function edit(data: TranslationWorkspaceData) {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || s.uncertain || s.conflict || !s.base || s.base.vehicle.version !== latest.current.vehicle.version) return;
    update({ data });
    setError(''); setNotice('');
  }
  function prepareSave(base: VehicleTranslationBundle, data: TranslationWorkspaceData) {
    try {
      const intent = { base: structuredClone(base), body: JSON.stringify(workspaceSaveRequest(base, data)), dirty: workspaceDirty(base, data) };
      saveIntent.current = intent;
      return intent;
    } catch (failure) {
      setError(failure instanceof TranslationWorkspaceChanged ? failure.message : '请检查译文长度、来源及资料格式后再保存。');
      return null;
    }
  }
  async function save(retry = false) {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || !s.base || !s.data || s.conflict || s.base.vehicle.version !== latest.current.vehicle.version ||
        (retry ? !s.uncertain || !s.saveRetryAllowed : !!s.uncertain)) return;
    if (!retry) {
      const declarationOnly = workspaceIsSourceDeclarationOnly(s.base, s.data);
      if (s.data.sourceLanguageConfirmations.length && !declarationOnly) {
        setError('原文语言确认须单独保存，请先处理当前译文修改。');
        return;
      }
    }
    const intent = retry ? saveIntent.current : prepareSave(s.base, s.data);
    if (!intent) return;
    const token = start('saving');
    try { await persistSave(intent, token, retry); }
    finally { finish(token); }
  }
  async function persistSave(intent: SaveIntent, token: number, retry = false) {
    update({ saveRetryAllowed: false });
    try {
      const saved = (await request(`${path(intent.base.vehicle.id)}/translation-bundle`, VehicleTranslationBundleResponseSchema,
        { method: 'PUT', body: intent.body, signal: AbortSignal.timeout(35_000) })).data;
      if (!current(token)) return;
      if (!intent.dirty && saved.vehicle.version === intent.base.vehicle.version && saved.localization.revision === intent.base.localization.revision) {
        assertWorkspaceSnapshot(intent.base, saved);
        accept(saved);
        update({ normalizationChecked: true });
        setNotice('服务端确认当前多语资料与已保存的草稿一致。');
        return;
      }
      if (saved.vehicle.id !== intent.base.vehicle.id || saved.vehicle.version <= intent.base.vehicle.version || saved.localization.revision <= intent.base.localization.revision)
        throw new TranslationWorkspaceChanged('保存返回的版本未更新，请读取服务端结果核对。');
      const savedData = accept(saved);
      const remaining = workspaceTranslationGaps(saved, savedData).length;
      const success = '当前多语资料已保存';
      setNotice(`${success}。${remaining ? `还有 ${remaining} 项英俄内容待补。` : '请在发布预览核对。'}`);
      void message.success(success);
    } catch (failure) {
      if (!current(token)) return;
      const definite = failure instanceof ApiClientError && [400, 401, 403, 404, 409, 413, 422, 429].includes(failure.status);
      const saveUncertain = !definite || retry;
      update({ uncertain: saveUncertain });
      if (!saveUncertain) saveIntent.current = null;
      setError(failureText(failure));
      reportConflict(failure);
    }
  }
  async function compareOrRecoverSave() {
    if (running.current || latest.current.hasUnsavedChanges) return;
    const token = start('recovering');
    update({ saveRetryAllowed: false });
    try {
      const fresh = await readBundle(); if (!current(token)) return;
      update({ remote: fresh });
      if (state.current.uncertain && saveIntent.current) {
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
    modal.confirm({ title: '放弃本地多语修改并重新读取？', content: '重新读取会放弃当前未保存的三语编辑。',
      okText: '放弃并重新读取', cancelText: '保留输入', okButtonProps: { danger: true }, onOk: () => load(true) });
  }
  const base = session.base, data = session.data;
  const needsChineseNormalization = !!base && !session.normalizationChecked && workspaceNeedsChineseNormalization(base);
  const fieldLabel = (field: DisplayField) => displayFieldLabel(field, data?.localization.fields ?? [], base?.vehicle ?? props.vehicle);
  const refLabel = (ref: string) => ref === 'content.title' ? '车辆标题' : ref === 'content.description' ? '车况描述'
    : (data?.localization.fields.find(field => field.ref === ref) ? fieldLabel(data.localization.fields.find(field => field.ref === ref)!) : '公开展示文字');
  const gaps = base && data ? workspaceTranslationGaps(base, data) : [];
  const declarationOnly = !!base && !!data && workspaceIsSourceDeclarationOnly(base, data);
  const factsOnly = !!base && !!data && workspaceIsFactsOnly(base, data);
  const declarationMixed = !!data?.sourceLanguageConfirmations.length && !declarationOnly;
  const savingPartial = !declarationOnly && !factsOnly && gaps.length > 0;
  const comparison = data && session.remote ? workspaceComparison(data, session.remote, fieldLabel) : [];
  const groups = data ? [
    { id: 'vehicle', label: '车辆展示资料', fields: data.localization.fields.filter(field => !field.ref.startsWith('configuration.') && !field.ref.startsWith('media.') && !field.ref.startsWith('price.includes.')) },
    { id: 'configuration', label: '车辆配置译文', fields: data.localization.fields.filter(field => field.ref.startsWith('configuration.')) },
    { id: 'images', label: '图片说明', fields: data.localization.fields.filter(field => field.ref.startsWith('media.')) },
    { id: 'price', label: '价格包含项目', fields: data.localization.fields.filter(field => field.ref.startsWith('price.includes.')) },
  ].filter(group => group.fields.length) : [];
  const displayGroupKeys = activeDisplayGroups ?? groups.filter(group => group.id !== 'configuration').map(group => group.id);

  function focusTranslation(ref: string, locale: 'zh' | 'en' | 'ru') {
    const group = groups.find(group => group.fields.some(field => field.ref === ref));
    if (group && !displayGroupKeys.includes(group.id)) setActiveDisplayGroups([...displayGroupKeys, group.id]);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const input = workspace.current?.querySelector<HTMLTextAreaElement>(`textarea[data-translation-ref="${CSS.escape(ref)}"][data-translation-locale="${locale}"]`);
      const fallback = locale === 'zh' ? workspace.current?.querySelector<HTMLElement>('[data-publication-translation-save]') : publicationIssueRegion.current;
      focusWorkspaceNode(input && !input.disabled ? input : fallback);
    }));
  }

  function focusWorkspaceNode(node: HTMLElement | null | undefined) {
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: 'center' });
  }

  function focusPublicationTranslation(issue: PublicationIssue) {
    const target = publicationTranslationTarget(issue);
    if (!target) { focusWorkspaceNode(publicationIssueRegion.current); return; }
    if (target.language !== 'sourceLanguage') {
      focusTranslation(target.ref, target.language);
      return;
    }
    focusWorkspaceNode(workspace.current?.querySelector<HTMLElement>('[data-publication-source-confirmation]') ?? publicationIssueRegion.current);
  }

  useEffect(() => {
    const target = props.publicationFocus;
    if (!target || handledPublicationFocus.current === target || !props.active || busy || !base || staleBase ||
        target.vehicleId !== base.vehicle.id || target.version !== base.vehicle.version) return;
    handledPublicationFocus.current = target;
    focusPublicationTranslation(target.issue);
    // The focus action only runs once for the matching, active workspace snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.publicationFocus, props.active, busy, base, staleBase]);

  return <Form component={false} disabled={locked}><div ref={workspace} className={styles.workspace}>
    {base && data && <Card title="三语展示资料" className={styles.generateCard}>
        <div className={styles.saveRow} data-publication-translation-save tabIndex={-1}>
          <Button data-testid="translation-bundle-save" loading={session.phase === 'saving'} disabled={locked || declarationMixed || (!dirty && (!needsChineseNormalization || savingPartial))} onClick={() => void save()}>{declarationOnly ? '保存中文原文确认' : factsOnly ? '保存代系与驱动形式' : savingPartial ? '保存当前译文' : '保存全部多语资料'}</Button>
          {(session.conflict || session.uncertain) && <Button data-testid="translation-save-recover" disabled={busy || props.hasUnsavedChanges} onClick={() => void compareOrRecoverSave()}>读取最新多语资料供比较</Button>}
          {session.uncertain && session.saveRetryAllowed && <Button disabled={busy || props.hasUnsavedChanges || !!props.disabled} onClick={() => void save(true)}>重试原多语保存请求</Button>}
          <Button disabled={busy || props.hasUnsavedChanges} onClick={discardAndReload}>放弃修改并重新读取</Button></div>
      </Card>}
    {props.hasUnsavedChanges && <Alert type="warning" showIcon title="请先保存车辆资料，再编辑三语展示资料" />}
    {staleBase && <Alert type="warning" showIcon title="车辆版本已更新，当前多语输入仍保留，请核对最新资料" />}
    {error && <Alert type="error" showIcon title={error} />}
    {notice && <Alert type="info" showIcon title={notice} />}
    {props.publicationIssues.length > 0 && <section ref={publicationIssueRegion} tabIndex={-1} aria-label="发布检查待处理">
      <Card title="发布检查待处理">
        <Typography.Paragraph>选择一项可定位到对应译文。保存后会自动检查当前草稿。</Typography.Paragraph>
        <ul className={styles.gapList}>{props.publicationIssues.map((issue, index) => {
          const { label, reason } = publicationIssueDetail(issue, base?.vehicle ?? props.vehicle, base?.localization.data.fields);
          return <li key={`${issue.path}:${index}`}>
            <Button type="link" size="small" className={styles.gapLink} disabled={!base || locked}
              onClick={() => focusPublicationTranslation(issue)}>{label}</Button>
            <div className={styles.publicationIssueReason}>{reason}</div>
          </li>;
        })}</ul>
      </Card>
    </section>}
    {!base || !data ? <Card loading={session.phase === 'loading'}><Typography.Paragraph>多语资料尚未读取完成。</Typography.Paragraph><Button disabled={busy || props.hasUnsavedChanges} onClick={() => void load()}>重新读取多语资料</Button></Card> : <>
      {needsChineseNormalization && <Alert type="info" showIcon title="中文内容将在保存时同步" description="尚未填写的中文展示内容可随保存从已知中文原文补齐。已有中文内容会保留。" />}
      {!!base.sourceLanguageConfirmationRequired.length && <section data-publication-source-confirmation tabIndex={-1}>
        <Card title="确认历史原文语言">
        <Typography.Paragraph>如已核对以下原文均为中文，可确认并保存来源记录。</Typography.Paragraph>
        <ul className={styles.sourceList}>{base.sourceLanguageConfirmationRequired.map(ref => <li key={ref}>{refLabel(ref)}</li>)}</ul>
        <Checkbox data-testid="translation-source-confirm" disabled={locked} checked={data.sourceLanguageConfirmations.length === base.sourceLanguageConfirmationRequired.length}
          onChange={event => edit({ ...data, sourceLanguageConfirmations: event.target.checked ? [...base.sourceLanguageConfirmationRequired] : [] })}>我确认以上原文均为中文</Checkbox>
      </Card></section>}
      {session.conflict && <Alert type="warning" showIcon title="资料版本已变化，当前输入没有被覆盖" description="可比较最新资料，或明确放弃本地修改后重新读取。" />}
      {session.uncertain && <Alert type="warning" showIcon title="保存结果尚未确认" description="请先读取服务端结果。原保存正文和版本仍保留，不会自动再次提交。" />}
      {declarationMixed && <Alert showIcon type="warning" title="原文语言确认须单独保存，请先处理当前译文修改。" />}
      <TranslationEditor name="title" value={data.content.title} saved={base.vehicle.draft.content.title} sourceText={base.vehicle.draft.content.title.sourceText ?? ''} sourceLanguage={base.vehicle.draft.content.title.sourceLanguage}
        requiredForPublish onChange={title => edit({ ...data, content: { ...data.content, title } })} disabled={locked} />
      <TranslationEditor name="description" value={data.content.description} saved={base.vehicle.draft.content.description} sourceText={base.vehicle.draft.content.description.sourceText ?? ''} sourceLanguage={base.vehicle.draft.content.description.sourceLanguage}
        requiredForPublish={base.vehicle.draft.source.kind !== 'demo'} onChange={description => edit({ ...data, content: { ...data.content, description } })} disabled={locked} />
      <DisplayTranslationsEditor groups={groups} savedFields={base.localization.data.fields} activeGroups={displayGroupKeys} onGroupsChange={setActiveDisplayGroups}
        disabled={locked} labelForField={fieldLabel}
        onChange={field => edit({ ...data, localization: { ...data.localization, fields: data.localization.fields.map(item => item.ref === field.ref ? field : item) } })} />
      <Collapse defaultActiveKey={[]} items={[{ key: 'facts', label: '补充代系与驱动形式', children: <>
        <Typography.Paragraph type="secondary">仅填写已知事实。修改代系后先保存，再编辑它对应的译文。</Typography.Paragraph>
        <div className={styles.factFields}>
        <Form.Item label="基础资料中的车型"><Typography.Text>{base.vehicle.draft.facts.model?.name ?? '尚未填写车型'}</Typography.Text></Form.Item>
        <Form.Item label="代系（选填）" extra="车型下的代际，例如第三代。车型及其译文在车型名称行核对。"><Input aria-label="代系名称" disabled={locked} maxLength={120} value={data.localization.facts.generation?.name ?? ''}
          onChange={event => { const name = event.target.value; if (name.trim() && !generationId.current) generationId.current = `manual_${crypto.randomUUID().replaceAll('-', '')}`;
            edit({ ...data, localization: { ...data.localization, facts: { ...data.localization.facts, generation: name.trim() ? { id: data.localization.facts.generation?.id ?? generationId.current!, name } : null } } }); }} /></Form.Item>
          <Form.Item label="驱动形式"><Select aria-label="驱动形式" disabled={locked} value={data.localization.facts.drivetrain ?? ''}
            options={[{ value: '', label: '未知 / 未填写' }, ...Object.entries(drivetrainLabels).map(([value, label]) => ({ value, label }))]}
            onChange={value => edit({ ...data, localization: { ...data.localization, facts: { ...data.localization.facts, drivetrain: value ? value as Drivetrain : null } } })} /></Form.Item></div>
      </> }]} />
      {session.remote && <Card title="当前输入与服务端资料"><Typography.Paragraph>服务端车辆版本 {session.remote.vehicle.version}。内容相同仍可能有来源或译文记录变化。</Typography.Paragraph>
        <Table size="small" rowKey="key" pagination={false} scroll={{ x: 520 }} dataSource={comparison} columns={[
          { dataIndex: 'label', title: '字段' }, { dataIndex: 'local', title: '当前输入', render: text => <span className={styles.comparisonText}>{text}</span> },
          { dataIndex: 'remote', title: '服务端资料', render: text => <span className={styles.comparisonText}>{text}</span> },
        ]} /></Card>}
    </>}
  </div></Form>;
}
