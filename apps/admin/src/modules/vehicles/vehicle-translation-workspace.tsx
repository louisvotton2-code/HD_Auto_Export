import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Collapse, Form, Input, Modal, Select, Space, Spin, Table, Typography } from 'antd';
import {
  CreateTranslationPlanRequestSchema, RecoverableTranslationPlanResponseSchema, TranslationPlanResponseSchema, TranslationPlanResultResponseSchema, TranslationPlanStatusResponseSchema,
  VehicleTranslationBundleResponseSchema,
  type AdminVehicle, type DisplayField, type Drivetrain, type PublicationIssue, type RecoverableTranslationPlan, type TranslationPlan, type TranslationPlanResult, type VehicleTranslationBundle,
} from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { displayFieldLabel, drivetrainLabels } from './vehicle-localization-model';
import { TranslationEditor } from './translation-editor';
import { DisplayTranslationsEditor } from './display-translations-editor';
import { publicationIssueDetail, publicationTranslationTarget } from './vehicle-actions-model';
import {
  applyTranslationPlanResult, assertTranslationPlan, assertWorkspaceFresh, assertWorkspaceSnapshot, translationPlanConfirmation, translationPlanTargets, translationPlanUsesSupplier, translationSourceUnchanged,
  TranslationWorkspaceChanged, workspaceComparison, workspaceData, workspaceDirty, workspaceNeedsChineseNormalization, workspaceSaveRequest, workspaceIsFactsOnly, workspaceIsSourceDeclarationOnly, workspaceTranslationGaps, type TranslationResultTarget, type TranslationWorkspaceData,
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
type Phase = 'idle' | 'loading' | 'saving' | 'saving-generated' | 'planning' | 'generating' | 'recovering';
type TranslationFailures = TranslationPlanResult['failures'];
type Session = {
  base: VehicleTranslationBundle | null; data: TranslationWorkspaceData | null; remote: VehicleTranslationBundle | null;
  phase: Phase; uncertain: 'save' | 'generate' | null; conflict: boolean; saveRetryAllowed: boolean;
  normalizationChecked: boolean;
  plan: TranslationPlan | null; planOpen: boolean; costAccepted: boolean; planExpired: boolean;
  execution: 'none' | 'running' | 'unknown' | 'ready' | 'completed' | 'partial';
  recoverable: RecoverableTranslationPlan | null;
  failures: TranslationFailures;
};
type GeneratedSave = { count: number; failures: TranslationFailures; usesSupplier: boolean };
type SaveIntent = { base: VehicleTranslationBundle; body: string; dirty: boolean; generated?: GeneratedSave };
type GenerateIntent = { base: VehicleTranslationBundle; plan: TranslationPlan; body: string; key: string };
const emptySession = (): Session => ({ base: null, data: null, remote: null, phase: 'idle', uncertain: null, conflict: false,
  saveRetryAllowed: false, normalizationChecked: false, plan: null, planOpen: false, costAccepted: false, planExpired: false, execution: 'none', recoverable: null, failures: [] });
const providers = { disabled: '未启用', libretranslate: '本地翻译服务', aliyun: '阿里云通用翻译' };
const targetLanguageLabels = { en: '英文', ru: '俄文' };
const translationFailureLabels = {
  upstream_failed: '翻译服务调用失败',
  outcome_unknown: '调用结果未确认',
  budget_exceeded: '超过每小时字符预算',
  invalid_result: '译文校验未通过',
  not_attempted: '本轮未执行',
} satisfies Record<TranslationFailures[number]['code'], string>;
const translationFailureReasonLabels = {
  facts_mismatch: '本次未获得可用译文',
  output_constraint: '译文格式、长度或内容未通过校验',
  provider_unusable: '翻译服务未返回可用译文',
} satisfies Record<NonNullable<TranslationFailures[number]['reason']>, string>;
function summarizeFailures(failures: TranslationFailures) {
  const counts = new Map<TranslationFailures[number]['code'], number>();
  for (const { code } of failures) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, count]) => `${translationFailureLabels[code]} ${count} 项`).join('、');
}
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : '操作未完成，当前输入仍保留。';

export function VehicleTranslationWorkspace(props: VehicleTranslationWorkspaceProps) {
  const { modal, message } = App.useApp();
  const [session, setSession] = useState<Session>(emptySession);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeDisplayGroups, setActiveDisplayGroups] = useState<string[]>();
  const [showAllGaps, setShowAllGaps] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const handledPublicationFocus = useRef<PublicationTranslationFocus | null>(null);
  const publicationIssueRegion = useRef<HTMLElement>(null);
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
    const data = workspaceData(bundle);
    saveIntent.current = null; generateIntent.current = null; planBase.current = null;
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
      const data = accept(fresh);
      if (discarded) setNotice('已重新读取服务端多语资料。');
      if (fresh.sourceLanguageConfirmationRequired.length || !workspaceTranslationGaps(fresh, data).length) return;
      try {
        const recoverable = (await request(`${path(fresh.vehicle.id)}/translation-plans/recoverable`, RecoverableTranslationPlanResponseSchema,
          { signal: AbortSignal.timeout(8_000) })).data;
        if (current(token) && recoverable) update({ recoverable });
      } catch (failure) {
        if (current(token) && !(failure instanceof ApiClientError && [400, 404].includes(failure.status)))
          setNotice('暂时无法查询上次译文。可重新读取多语资料后再试。');
      }
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
  function prepareSave(base: VehicleTranslationBundle, data: TranslationWorkspaceData, generated?: GeneratedSave) {
    try {
      const intent = { base: structuredClone(base), body: JSON.stringify(workspaceSaveRequest(base, data)), dirty: workspaceDirty(base, data), generated };
      saveIntent.current = intent;
      return intent;
    } catch (failure) {
      setError((generated ? '译文已生成，自动保存失败。' : '') +
        (failure instanceof TranslationWorkspaceChanged ? failure.message : '请检查译文长度、来源及资料格式后再保存。'));
      return null;
    }
  }
  async function save(retry = false) {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || !s.base || !s.data || s.conflict || s.base.vehicle.version !== latest.current.vehicle.version ||
        (retry ? s.uncertain !== 'save' || !s.saveRetryAllowed : !!s.uncertain)) return;
    if (!retry) {
      const declarationOnly = workspaceIsSourceDeclarationOnly(s.base, s.data);
      if (s.data.sourceLanguageConfirmations.length && !declarationOnly) {
        setError('原文语言确认须单独保存，请先处理当前译文修改。');
        return;
      }
    }
    const intent = retry ? saveIntent.current : prepareSave(s.base, s.data);
    if (!intent) return;
    const token = start(intent.generated ? 'saving-generated' : 'saving');
    try { await persistSave(intent, token, retry); }
    finally { finish(token); }
  }
  async function persistSave(intent: SaveIntent, token: number, retry = false) {
    update({ saveRetryAllowed: false });
    try {
      const saved = (await request(`${path(intent.base.vehicle.id)}/translation-bundle`, VehicleTranslationBundleResponseSchema,
        { method: 'PUT', body: intent.body, signal: AbortSignal.timeout(35_000) })).data;
      if (!current(token)) return;
      if (!intent.dirty && !intent.generated && saved.vehicle.version === intent.base.vehicle.version && saved.localization.revision === intent.base.localization.revision) {
        assertWorkspaceSnapshot(intent.base, saved);
        accept(saved);
        update({ normalizationChecked: true });
        setNotice('服务端确认当前多语资料与已保存的草稿一致。');
        return;
      }
      if (saved.vehicle.id !== intent.base.vehicle.id || saved.vehicle.version <= intent.base.vehicle.version || saved.localization.revision <= intent.base.localization.revision)
        throw new TranslationWorkspaceChanged('保存返回的版本未更新，请读取服务端结果核对。');
      const previousFailures = intent.generated?.failures ?? state.current.failures;
      const savedData = accept(saved);
      const gaps = workspaceTranslationGaps(saved, savedData);
      const remaining = gaps.length;
      const success = intent.generated ? `已自动保存 ${intent.generated.count} 项译文` : '当前多语资料已保存';
      const stillMissing = new Set(gaps.map(gap => `${gap.ref}:${gap.locale}`));
      const failures = previousFailures.filter(failure => stillMissing.has(`${failure.ref}:${failure.targetLocale}`) &&
        translationSourceUnchanged(intent.base, saved, failure.ref));
      const failureSummary = intent.generated ? summarizeFailures(failures) : '';
      const feeNotice = failureSummary && intent.generated?.usesSupplier ? '未完成部分可能已产生费用。' : '';
      setNotice(`${success}。${remaining ? `还有 ${remaining} 项译文待补。` : '请重新打开发布预览核对。'}${failureSummary ? failureSummary + '。' : ''}${feeNotice}`);
      if (failures.length) update({ execution: 'partial', failures });
      void message.success(success);
    } catch (failure) {
      if (!current(token)) return;
      const definite = failure instanceof ApiClientError && [400, 401, 403, 404, 409, 413, 422, 429].includes(failure.status);
      const saveUncertain = !definite || retry;
      update({ uncertain: saveUncertain ? 'save' : null });
      if (!saveUncertain) saveIntent.current = null;
      const saveError = intent.generated ? saveUncertain ? '译文已生成，自动保存结果尚未确认。' : '译文已生成，自动保存失败。当前译文仍保留。' : '';
      setError(saveError + failureText(failure));
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
    const plan = generateIntent.current?.plan;
    const feeNotice = plan && translationPlanUsesSupplier(plan) ? '已开始的翻译可能已经产生费用。' : '';
    modal.confirm({ title: '放弃本地多语修改并重新读取？', content: '当前未保存的本页输入会丢失。服务器已有可用译文时，重新读取后仍可手动恢复。' + feeNotice,
      okText: '放弃并重新读取', cancelText: '保留输入', okButtonProps: { danger: true }, onOk: () => load(true) });
  }
  async function createPlan() {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || !s.base || !s.data || workspaceDirty(s.base, s.data) || s.uncertain || s.conflict ||
        !s.base.vehicle.draft.content.title.sourceText?.trim() || s.base.sourceLanguageConfirmationRequired.length ||
        s.base.vehicle.version !== latest.current.vehicle.version) return;
    const base = structuredClone(s.base), token = start('planning');
    planBase.current = null;
    update({ plan: null, planOpen: false, costAccepted: false, execution: 'none' });
    try {
      const plan = (await request(`${path(base.vehicle.id)}/translation-plans`, TranslationPlanResponseSchema,
        { method: 'POST', body: JSON.stringify(CreateTranslationPlanRequestSchema.parse({
          version: base.vehicle.version, scope: 'missing', useCatalog: true,
        })), signal: AbortSignal.timeout(35_000) })).data;
      const fresh = await readBundle(base.vehicle.id);
      assertWorkspaceSnapshot(base, fresh); await assertTranslationPlan(plan, fresh, true);
      if (!current(token)) return;
      checkContext(fresh);
      if (workspaceDirty(base, state.current.data)) throw new TranslationWorkspaceChanged();
      if (!plan.fields.length) {
        setNotice('当前没有待生成的译文。');
        return;
      }
      planBase.current = base;
      update({ plan, planOpen: true, costAccepted: false, planExpired: Date.parse(plan.expiresAt) <= Date.now() });
    } catch (failure) { if (current(token)) { setError(failureText(failure)); reportConflict(failure); } }
    finally { finish(token); }
  }
  async function adoptResult(intent: Pick<GenerateIntent, 'base' | 'plan'>, result: TranslationPlanResult, token: number,
    blockedTargets: readonly TranslationResultTarget[] = [], adoptionBase?: RecoverableTranslationPlan['adoptionBase']) {
    const fresh = await readBundle(intent.base.vehicle.id);
    if (!current(token)) return;
    checkContext(fresh);
    if (!state.current.data) throw new TranslationWorkspaceChanged();
    const adopted = await applyTranslationPlanResult(intent.plan, intent.base, state.current.data, fresh, result, blockedTargets, adoptionBase);
    if (!current(token)) return;
    checkContext(fresh);
    if (!state.current.data || workspaceDirty(intent.base, state.current.data)) throw new TranslationWorkspaceChanged();
    generateIntent.current = null; planBase.current = null;
    const remaining = workspaceTranslationGaps(fresh, adopted.data).length;
    const usesSupplier = translationPlanUsesSupplier(intent.plan);
    const failures: TranslationFailures = [...result.failures, ...blockedTargets.map(target => ({ ...target, code: 'invalid_result' as const }))];
    update({ uncertain: null, execution: failures.length ? 'partial' : result.status, costAccepted: false, failures, recoverable: null });
    if (!adopted.applied) {
      if (remaining) {
        const failureSummary = summarizeFailures(failures);
        setError(`本次没有获得新的可用译文，仍有 ${remaining} 项待补。${failureSummary ? failureSummary + '。' : ''}可在待补列表中打开对应字段并手动填写。${usesSupplier ? '未完成部分可能已产生费用。' : ''}`);
      } else setNotice('本次没有新的译文需要保存。');
      return;
    }
    update({ data: adopted.data, phase: 'saving-generated' });
    const save = prepareSave(fresh, adopted.data, { count: adopted.applied, failures, usesSupplier });
    if (save) await persistSave(save, token);
  }
  async function generate() {
    const s = state.current, base = planBase.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || s.uncertain || s.conflict || !s.planOpen || !s.plan || !base || !s.data ||
        (translationPlanUsesSupplier(s.plan) && !s.costAccepted) ||
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
      if (!current(token)) return;
      setError(failureText(failure));
      reportConflict(failure);
      update({ uncertain: 'generate', execution: 'unknown' });
      // A returned rejection can still follow provider work. Check the recorded plan
      // before offering a new paid attempt. A dropped response stays on recovery.
      if (failure instanceof ApiClientError && failure.requestId && [
        'TRANSLATION_DISABLED', 'TRANSLATION_SOURCE_UNSUPPORTED', 'TRANSLATION_INPUT_TOO_LONG',
        'TRANSLATION_UPSTREAM_FAILED', 'TRANSLATION_BUSY', 'TRANSLATION_QUOTA_EXCEEDED', 'RATE_LIMITED',
      ].includes(failure.code)) {
        try {
          const status = await readPlanStatus(intent, 8_000);
          if (!current(token)) return;
          if (status.state === 'ready') {
            generateIntent.current = null; planBase.current = null;
            update({ plan: null, uncertain: null, execution: 'none' });
          }
        } catch { /* Keep the original error and the existing recovery entry. */ }
      }
    } finally { finish(token); }
  }
  async function readPlanStatus(intent: GenerateIntent, timeout = 35_000) {
    const status = (await request(`${path(intent.base.vehicle.id)}/translation-plans/${encodeURIComponent(intent.plan.id)}`, TranslationPlanStatusResponseSchema,
      { signal: AbortSignal.timeout(timeout) })).data;
    if (status.planId !== intent.plan.id || status.vehicleId !== intent.base.vehicle.id) throw new TranslationWorkspaceChanged();
    return status;
  }

  async function recoverResult() {
    const intent = generateIntent.current;
    if (running.current || !intent || latest.current.hasUnsavedChanges) return;
    const token = start('recovering');
    try {
      const status = await readPlanStatus(intent);
      if (!current(token)) return;
      if (status.result) await adoptResult(intent, status.result, token);
      else {
        update({ execution: status.state === 'running' ? 'running' : 'ready', uncertain: 'generate' });
        setNotice(status.state === 'running' ? '翻译仍在处理中。稍后继续读取结果，不会再次发起生成请求。' : '服务端尚未记录本计划的执行。请结束当前计划，再核对下一次翻译范围。');
      }
    } catch (failure) { if (current(token)) { setError(failureText(failure)); reportConflict(failure); } }
    finally { finish(token); }
  }
  async function recoverPreviousResult() {
    const s = state.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || s.uncertain || s.conflict || !s.base || !s.recoverable ||
        s.base.vehicle.version !== latest.current.vehicle.version || workspaceDirty(s.base, s.data)) return;
    const token = start('recovering');
    try { await adoptResult({ base: s.base, plan: s.recoverable.plan }, s.recoverable.result, token, s.recoverable.blockedTargets, s.recoverable.adoptionBase); }
    catch (failure) {
      if (current(token)) { setError(failureText(failure)); reportConflict(failure); }
    } finally { finish(token); }
  }

  const base = session.base, data = session.data;
  const supplierPlan = session.plan === null || translationPlanUsesSupplier(session.plan);
  const hasSavedTitle = !!base?.vehicle.draft.content.title.sourceText?.trim();
  const needsChineseNormalization = !!base && !session.normalizationChecked && workspaceNeedsChineseNormalization(base);
  const fieldLabel = (field: DisplayField) => displayFieldLabel(field, data?.localization.fields ?? [], base?.vehicle ?? props.vehicle);
  const refLabel = (ref: string) => ref === 'content.title' ? '车辆标题' : ref === 'content.description' ? '车况描述'
    : (data?.localization.fields.find(field => field.ref === ref) ? fieldLabel(data.localization.fields.find(field => field.ref === ref)!) : '公开展示文字');
  const gaps = base && data ? workspaceTranslationGaps(base, data) : [];
  const hasTargetTranslations = !!data && [...Object.values(data.content), ...data.localization.fields]
    .some(field => !!field.translations.en?.text.trim() || !!field.translations.ru?.text.trim());
  const declarationOnly = !!base && !!data && workspaceIsSourceDeclarationOnly(base, data);
  const factsOnly = !!base && !!data && workspaceIsFactsOnly(base, data);
  const declarationMixed = !!data?.sourceLanguageConfirmations.length && !declarationOnly;
  const savingPartial = !declarationOnly && !factsOnly && gaps.length > 0;
  const savingGenerated = session.phase === 'saving-generated';
  const waitingForTranslation = session.phase === 'generating' || savingGenerated ||
    (session.phase === 'recovering' && (session.uncertain === 'generate' || !!session.recoverable));
  const failureByTarget = new Map(session.failures.map(failure => [`${failure.ref}:${failure.targetLocale}`, failure]));
  const pendingTargets = gaps.map(gap => ({ ...gap, failure: failureByTarget.get(`${gap.ref}:${gap.locale}`) }));
  const orderedTargets = [...pendingTargets.filter(target => target.failure), ...pendingTargets.filter(target => !target.failure)];
  const visibleTargets = showAllGaps ? orderedTargets : orderedTargets.slice(0, 6);
  const hasRejectedTarget = pendingTargets.some(target => target.failure?.code === 'invalid_result' || !!target.failure?.reason);
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
    <Modal open={waitingForTranslation} title={savingGenerated ? '正在保存译文' : '正在处理翻译'} footer={null} closable={false} keyboard={false}
      mask={{ closable: false }} centered zIndex={1200}>
      <Space size="middle" role="status" tabIndex={0}>
        <Spin />
        <Typography.Text>{savingGenerated ? '已收到译文，正在保存到草稿。' : '正在等待译文结果，请稍候。'}</Typography.Text>
      </Space>
    </Modal>
    {base && data && <Card className={styles.generateCard}><div className={styles.generateRow}><div><Typography.Title level={5}>{hasTargetTranslations ? '补齐英俄译文' : '生成整车英俄译文'}</Typography.Title><Typography.Paragraph>生成的译文会自动保存到草稿。人工修改请在此页手动保存。保存后可在发布预览查看当前版本。</Typography.Paragraph></div>
        <Button data-testid="vehicle-translation-generate" type={session.recoverable ? 'default' : 'primary'} loading={session.phase === 'planning'}
          disabled={locked || dirty || !hasSavedTitle || !!base.sourceLanguageConfirmationRequired.length || gaps.length === 0}
          onClick={() => void createPlan()}>{hasTargetTranslations ? `翻译剩余 ${gaps.length} 项` : '生成翻译'}</Button></div>
        {dirty && <Typography.Text type="secondary">请先保存当前多语修改，再生成新计划。</Typography.Text>}
        {session.recoverable && <Typography.Paragraph type="secondary">找到上次生成的译文。恢复时直接保存已有结果，无需再次翻译。</Typography.Paragraph>}
        {!hasSavedTitle && <Typography.Text type="secondary">请先在基础资料填写并保存中文标题。</Typography.Text>}
        <div className={styles.saveRow} data-publication-translation-save tabIndex={-1}>
          {session.recoverable && <Button type="primary" disabled={locked || dirty} onClick={() => void recoverPreviousResult()}>恢复并保存上次译文</Button>}
          <Button data-testid="translation-bundle-save" loading={session.phase === 'saving'} disabled={locked || declarationMixed || (!dirty && (!needsChineseNormalization || savingPartial))} onClick={() => void save()}>{declarationOnly ? '保存中文原文确认' : factsOnly ? '保存代系与驱动形式' : savingPartial ? '保存当前译文' : '保存全部多语资料'}</Button>
          {(session.conflict || session.uncertain === 'save') && <Button data-testid="translation-save-recover" disabled={busy || props.hasUnsavedChanges} onClick={() => void compareOrRecoverSave()}>读取最新多语资料供比较</Button>}
          {session.uncertain === 'save' && session.saveRetryAllowed && <Button disabled={busy || props.hasUnsavedChanges || !!props.disabled} onClick={() => void save(true)}>重试原多语保存请求</Button>}
          <Button disabled={busy || props.hasUnsavedChanges} onClick={discardAndReload}>放弃修改并重新读取</Button></div>
      </Card>}
    {props.hasUnsavedChanges && <Alert type="warning" showIcon title="请先保存车辆资料，再编辑或生成译文" />}
    {staleBase && <Alert type="warning" showIcon title="车辆版本已更新，当前多语输入仍保留，请核对最新资料" />}
    {error && <Alert type="error" showIcon title={error} />}
    {notice && <Alert type={session.execution === 'partial' ? 'warning' : 'info'} showIcon title={notice} />}
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
      {needsChineseNormalization && <Alert type="info" showIcon title="中文内容将在保存时同步" description="中文直接使用基础资料里的原文，保存多语资料时同步，无需重复填写。" />}
      {!!base.sourceLanguageConfirmationRequired.length && <section data-publication-source-confirmation tabIndex={-1}>
        <Card title="确认历史原文语言">
        <Typography.Paragraph>以下历史字段需要确认原文语言。确认并保存后可为缺项生成英俄译文。</Typography.Paragraph>
        <ul className={styles.sourceList}>{base.sourceLanguageConfirmationRequired.map(ref => <li key={ref}>{refLabel(ref)}</li>)}</ul>
        <Checkbox data-testid="translation-source-confirm" disabled={locked} checked={data.sourceLanguageConfirmations.length === base.sourceLanguageConfirmationRequired.length}
          onChange={event => edit({ ...data, sourceLanguageConfirmations: event.target.checked ? [...base.sourceLanguageConfirmationRequired] : [] })}>我确认以上原文均为中文</Checkbox>
      </Card></section>}
      {session.conflict && <Alert type="warning" showIcon title="资料版本已变化，当前输入没有被覆盖" description="可比较最新资料，或明确放弃本地修改后重新读取。" />}
      {session.uncertain === 'save' && <Alert type="warning" showIcon title="保存结果尚未确认" description="请先读取服务端结果。原保存正文和版本仍保留，不会自动再次提交。" />}
      {declarationMixed && <Alert showIcon type="warning" title="原文语言确认须单独保存，请先处理当前译文修改。" />}
      {savingPartial && <Alert showIcon type="warning" title={`还差 ${gaps.length} 项译文${dirty && session.phase === 'idle' ? '，可先保存当前译文' : ''}`}
        description={<>
          {hasRejectedTarget && <p className={styles.gapHint}>可以直接按中文原文手动补齐，再从顶部保存。</p>}
          <ul className={styles.gapList}>{visibleTargets.map(({ ref, locale, failure }) => {
            const label = `${refLabel(ref)} · ${targetLanguageLabels[locale]}`;
            const reason = failure?.reason ? translationFailureReasonLabels[failure.reason] : failure && translationFailureLabels[failure.code];
            return <li key={`${ref}:${locale}`}><Button type="link" size="small" className={styles.gapLink} disabled={locked}
              aria-label={`编辑${label}`} onClick={() => focusTranslation(ref, locale)}>{label}</Button>
              {reason && <span> · {reason}</span>}
            </li>;
          })}</ul>
          {pendingTargets.length > 6 && <Button type="link" size="small" className={styles.gapLink} onClick={() => setShowAllGaps(!showAllGaps)}>
            {showAllGaps ? '收起' : `查看全部 ${pendingTargets.length} 项`}
          </Button>}
        </>} />}
      {(session.phase === 'generating' || session.uncertain === 'generate') && <Card title="翻译执行结果">
        <Typography.Paragraph>{session.phase === 'generating'
          ? supplierPlan ? '翻译正在执行，最长等待约两分半。关闭或断线不代表任务取消，也不代表没有费用。' : '正在应用本地术语。'
          : '结果尚需核对。读取结果只查询本次任务。'}</Typography.Paragraph>
        <Space wrap><Button data-testid="translation-result-recover" disabled={busy || props.hasUnsavedChanges} loading={session.phase === 'recovering'} onClick={() => void recoverResult()}>读取翻译结果</Button>
          {session.execution === 'ready' && <Button disabled={busy || props.hasUnsavedChanges} onClick={discardAndReload}>结束本次计划并重新读取</Button>}</Space>
      </Card>}
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
    <Modal open={session.planOpen} title={supplierPlan ? '确认翻译范围与费用' : '确认本地术语'} okText={supplierPlan ? '确认费用并生成' : '确认并应用'} cancelText="取消"
      onCancel={() => { if (!running.current) update({ planOpen: false, costAccepted: false }); }}
      onOk={() => void generate()} okButtonProps={{ 'data-testid': 'translation-plan-start', disabled: locked || !session.planOpen || !session.plan || session.planExpired || (supplierPlan && (!session.costAccepted || session.plan.provider === 'disabled')) }}>
      {session.plan && <div className={styles.plan} data-testid="translation-plan-confirmation">
        <Typography.Paragraph>目标语言：{[...new Set(session.plan.fields.flatMap(field => [...translationPlanTargets(field)]))].map(locale => targetLanguageLabels[locale]).join('、')}{supplierPlan && `。翻译服务为${providers[session.plan.provider]}`}。</Typography.Paragraph>
        {supplierPlan ? <>
          <Typography.Paragraph>最多 {session.plan.estimate.maximumCharacters} 个字符，最多 {session.plan.estimate.maximumRequests} 次请求；每小时字符预算 {session.plan.estimate.hourlyCharacterLimit.toLocaleString('zh-CN')}。这些是请求上界，并非实际账单。</Typography.Paragraph>
          <Alert showIcon type="warning" title="费用及免费额度未知，不能视为免费" description="确认后可能产生费用，失败或中断也可能已计费。已有译文会保留。请核对本次计划的请求和费用。" />
        </> : <Alert showIcon type="info" title="使用本地术语，无供应商费用" />}
        <Typography.Paragraph>以下为本次固定范围。计划有效期至 {new Date(session.plan.expiresAt).toLocaleTimeString('zh-CN')}。</Typography.Paragraph>
        <ul className={styles.planFields}>{session.plan.fields.map(field => <li key={field.ref}><strong>{refLabel(field.ref)}</strong>
          <span> · {translationPlanTargets(field).map(locale => targetLanguageLabels[locale] + (field.catalogTargets?.includes(locale) ? '（本地术语）' : '')).join('、')}</span>
          <div className={styles.planSource}>{field.sourceText}</div></li>)}</ul>
        {session.planExpired && <Alert type="warning" title="计划已过期，请取消后重新查看翻译范围" />}
        {supplierPlan && session.plan.provider === 'disabled' && <Alert type="warning" title="翻译服务尚未启用，可继续人工编辑译文" />}
        {supplierPlan && <Checkbox data-testid="translation-generate-confirm" disabled={locked || session.planExpired || session.plan.provider === 'disabled'} checked={session.costAccepted}
          onChange={event => update({ costAccepted: event.target.checked })}>我已核对翻译范围与参数，并接受可能产生的费用</Checkbox>}
      </div>}
    </Modal>
  </div></Form>;
}
