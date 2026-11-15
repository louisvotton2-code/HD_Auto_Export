import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Badge, Breadcrumb, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Row, Select, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, CloudUploadOutlined, FileTextOutlined, GlobalOutlined, PlusOutlined, SaveOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { AdminVehicleResponseSchema, VehicleDraftWriteSchema, type AdminVehicle, type ConfirmPublicationPreviewRequest, type PublicationIssue, type PublishReadiness, type VehicleDraftInput } from '@hd/contracts/admin';
import type { Locale } from '@hd/contracts/public';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { PartialDateField } from '../../shared/ui/partial-date-field';
import { UtcDateTimeField } from '../../shared/ui/utc-date-time-field';
import { SourceReportLink } from '../../shared/ui/source-report-link';
import { ActivityHistory, ActivitySummary } from '../activity';
import { request, ApiClientError } from '../../shared/api/client';
import { useVehicleDictionary } from '../../shared/api/vehicle-dictionary';
import { availabilityLabels, changedFields, draftToForm, emptyDraft, fieldForPath, fieldLabels, formatTime, formToDraft, powertrainLabels, publicationLabels, type DraftForm } from './draft-form';
import { VehicleMediaEditor } from './media-editor';
import { VehicleActions } from './vehicle-actions';
import { PublicationPreviewPanel } from './publication-preview-panel';
import { VehicleDeletionActions } from './vehicle-deletion-actions';
import { VehicleTranslationWorkspace, type PublicationTranslationFocus, type TranslationWorkspaceGuard as LocalizationGuard } from './vehicle-translation-workspace';
import { brandIdentityOptions } from './vehicle-localization-model';
import { modelIdentityOptions } from './model-suggestions';
import styles from './vehicle-editor.module.css';
import { externalSourceFormKeys, formForDemo, formForExternal, sourceForKind } from './vehicle-editor-helpers';
import { basicDraftIssues } from './draft-entry-validation';
import { readConfigurationFacts } from './configuration-facts';
import { configurationFormState } from './configuration-form';
import { buildConfigurationAiPrompt, VehicleConfigurationEditor } from './vehicle-configuration-editor';

type TabKey = 'basics' | 'configuration' | 'commercial' | 'images' | 'review' | 'localization';
type SourceKind = VehicleDraftInput['source']['kind'];
type FieldIssue = { key?: keyof DraftForm; label: string; tab: TabKey };
type CreateAttempt = { key: string; body: string; startedAt: number };
function newManualDraft(): VehicleDraftInput {
  const draft = emptyDraft();
  draft.facts.location = { country: 'CN', city: null, displayName: null };
  draft.price = { kind: 'asking', money: { amount: null, currency: 'CNY' }, includes: [] };
  draft.internal.purchaseCost = { amount: null, currency: 'CNY' };
  return draft;
}
const blank = newManualDraft();
const steps: readonly { key: TabKey; label: string }[] = [
  { key: 'basics', label: '基础资料' },
  { key: 'configuration', label: '车辆配置' },
  { key: 'commercial', label: '价格与内部信息' },
  { key: 'images', label: '图片管理' },
  { key: 'localization', label: '公开字段多语' },
  { key: 'review', label: '发布预览' },
];

function tabForField(key?: keyof DraftForm, path = ''): TabKey {
  if (key === 'configuration' || key === 'powertrain') return 'configuration';
  if (path.replace(/^draft\./, '').startsWith('localization')) return 'localization';
  if (path.includes('media')) return 'images';
  if (path.includes('translations')) return 'localization';
  if (key && ['priceKind', 'amount', 'currency', 'includes', 'purchaseAmount', 'purchaseCurrency', 'supplierContact', 'vin', 'notes'].includes(key)) return 'commercial';
  return 'basics';
}
function issueForPath(path: string): FieldIssue {
  if (path.replace(/^draft\./, '').startsWith('localization')) return { label: '公开字段多语', tab: 'localization' };
  const key = fieldForPath(path);
  const visibleKey = key === 'makeId' ? 'makeName' : key === 'modelId' ? 'modelName' : key === 'trimId' ? 'trimName'
    : key === 'titleLanguage' ? 'title' : key === 'descriptionLanguage' ? 'description' : key;
  return { key: visibleKey, label: visibleKey ? fieldLabels[visibleKey] : path.includes('translations') ? '三语内容' : path.includes('media') ? '车辆图片' : '车辆信息', tab: tabForField(visibleKey, path) };
}

export function VehicleEditorPage() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { id } = useParams();
  const navigate = useNavigate();
  const route = useLocation();
  const { modal, message } = App.useApp();
  const dictionary = useVehicleDictionary();
  const [record, setRecord] = useState<AdminVehicle | null>(null);
  const [previewLocale, setPreviewLocale] = useState<Locale>('zh');
  const [previewReceipt, setPreviewReceipt] = useState<ConfirmPublicationPreviewRequest | null>(null);
  const [publicationReadiness, setPublicationReadiness] = useState<PublishReadiness | null>(null);
  const [publicationTranslationFocus, setPublicationTranslationFocus] = useState<PublicationTranslationFocus | null>(null);
  const acceptedRecord = useRef<AdminVehicle | null>(null);
  const reportRefresh = useRef<AbortController | null>(null);
  const reportSession = useRef(0);
  const reportAllowed = useRef(true);
  const [reportAccessExpired, setReportAccessExpired] = useState(false);
  const [base, setBase] = useState<VehicleDraftInput>(blank);
  const [form, setForm] = useState<DraftForm>(() => draftToForm(blank));
  const configurationState = useMemo(() => configurationFormState(form.configuration), [form.configuration]);
  const configurationInvalid = configurationState.errors.length > 0;
  const [sourceKind, setSourceKind] = useState<SourceKind>('manual');
  const [extras, setExtras] = useState(() => ({ media: blank.media, content: blank.content }));
  const [mediaBusy, setMediaBusy] = useState(false);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [localizationGuard, setLocalizationGuard] = useState<LocalizationGuard>({ dirty: false, busy: false, uncertain: false });
  const localizationGuardRef = useRef(localizationGuard);
  const [localizationOpened, setLocalizationOpened] = useState(route.state?.afterCreate === 'localization');
  const [loading, setLoading] = useState(!!id);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [remote, setRemote] = useState<AdminVehicle | null>(null);
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const requested = route.state?.afterCreate;
    return id && steps.some(step => step.key === requested) ? requested as TabKey : 'basics';
  });
  const [newIdentity, setNewIdentity] = useState<'make' | 'model' | null>(null);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const attempt = useRef<CreateAttempt | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const baseForm = draftToForm(base);
  const coreDirty = JSON.stringify(form) !== JSON.stringify(baseForm) || JSON.stringify(extras) !== JSON.stringify({ media: base.media, content: base.content }) || sourceKind !== base.source.kind || uncertain;
  const localizationLocked = localizationGuard.dirty || localizationGuard.busy || localizationGuard.uncertain;
  const dirty = coreDirty || localizationGuard.dirty || localizationGuard.uncertain;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || localizationGuard.busy;
  const blocker = useBlocker(() => dirtyRef.current || inFlight.current);
  const isDeleted = !!record?.deletedAt;
  const locked = saving || uncertain || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || localizationLocked || isDeleted;
  const isDemo = sourceKind === 'demo';
  const isExternal = sourceKind === 'external';
  const requiredFields = new Set<keyof DraftForm>(['makeName', 'modelName', 'title', 'trimName', 'configuration', 'modelYear', 'powertrain', 'mileageKm', 'priceKind', 'amount', 'currency', 'purchaseAmount', 'purchaseCurrency', 'description']);
  const required = (key: keyof DraftForm) => (sourceKind === 'manual' || sourceKind === 'external') && requiredFields.has(key);
  const entryIssues = !id ? basicDraftIssues(form) : [];
  const invalidPriceFields = (['amount', 'purchaseAmount'] as const).filter(key =>
    (key !== 'amount' || form.priceKind !== 'on_request') &&
    form[key] !== baseForm[key] && !/^(?:0|[1-9]\d{0,13})?$/.test(form[key]),
  );
  const priceFormatError = '请输入最多 14 位的整数，开头无需补 0。';
  const nextStep = steps[steps.findIndex(step => step.key === activeTab) + 1];
  const configurationFacts = useMemo(
    () => readConfigurationFacts(configurationState.value?.items ?? [], base.configuration?.items),
    [configurationState, base.configuration],
  );
  const [configurationReview, setConfigurationReview] = useState<{ input: string; confirmed: boolean } | null>(null);
  const currentConfigurationReview = configurationReview?.input === form.configuration ? configurationReview : null;
  const configChanged = form.configuration !== baseForm.configuration;
  const configurationConfirmed = currentConfigurationReview?.confirmed === true;
  const configurationFactIssues = configChanged && !isDemo ? configurationFacts.errors : [];
  const configurationNeedsConfirmation = configChanged && !isDemo && !!configurationState.value && !configurationConfirmed;
  const showConfigurationReview = !!configurationState.value && (!configChanged || !!currentConfigurationReview);
  const configurationReviewHint = currentConfigurationReview
    ? '请点击「人工核对无误」后再继续。'
    : '请先点击「解析并核对配置」，再完成人工核对。';
  const externalSourceChanged = isExternal && externalSourceFormKeys.some(key => form[key] !== baseForm[key]);
  const sourceReportUrl = externalSourceChanged || reportAccessExpired ? null : record?.report?.url;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reportRefresh.current?.abort(); }; }, []);
  useEffect(() => {
    const expireReport = () => {
      reportSession.current++;
      reportAllowed.current = false;
      reportRefresh.current?.abort();
      setReportAccessExpired(true);
    };
    window.addEventListener('admin:unauthorized', expireReport);
    return () => window.removeEventListener('admin:unauthorized', expireReport);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('admin:dirty', { detail: dirty || saving || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || localizationGuard.busy }));
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.dispatchEvent(new CustomEvent('admin:dirty', { detail: false })); };
  }, [dirty, saving, mediaBusy, actionsBusy, lifecycleBusy, translationBusy, localizationGuard.busy]);

  useEffect(() => { setPreviewReceipt(null); }, [id]);

  function localizationGuardChanged(next: LocalizationGuard) {
    localizationGuardRef.current = next;setLocalizationGuard(next);
    dirtyRef.current = coreDirty || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || next.dirty || next.busy || next.uncertain;
  }

  function accept(vehicle: AdminVehicle) {
    if (acceptedRecord.current?.id === vehicle.id && acceptedRecord.current.version > vehicle.version) return;
    reportRefresh.current?.abort();
    acceptedRecord.current = vehicle;
    setSuccess('');
    setRecord(vehicle); setBase(vehicle.draft); setForm(draftToForm(vehicle.draft));
    setConfigurationReview(null);
    setSourceKind(vehicle.draft.source.kind);
    setExtras({ media: vehicle.draft.media, content: vehicle.draft.content });
    setRemote(null); setConflict(false); setIssues([]); setUncertain(false); attempt.current = null;
    dirtyRef.current = false;
  }
  function acceptMutation(vehicle: AdminVehicle) {
    accept(vehicle);
    if (!reportAllowed.current || acceptedRecord.current !== vehicle || vehicle.report !== undefined || vehicle.draft.source.kind !== 'external') return;
    const controller = new AbortController();
    reportRefresh.current = controller;
    // Older mutation receipts omit report metadata. Refresh only that metadata;
    // a late response must never replace input entered after the successful save.
    void request(`/api/v1/admin/vehicles/${encodeURIComponent(vehicle.id)}?includeDeleted=true`, AdminVehicleResponseSchema, { signal: controller.signal })
      .then(({ data }) => {
        const current = acceptedRecord.current;
        const binding = (value: AdminVehicle) => {
          const source = value.draft.source;
          return source.kind === 'external' ? JSON.stringify([source.platform.id, source.externalId, source.listingUrl]) : null;
        };
        if (controller.signal.aborted || !reportAllowed.current || !mounted.current || !current || current.id !== vehicle.id || current.version !== vehicle.version
          || data.id !== vehicle.id || data.version !== vehicle.version || binding(data) !== binding(vehicle) || binding(current) !== binding(vehicle)) return;
        const next = { ...current, report: data.report };
        acceptedRecord.current = next;
        setRecord(next);
      })
      .catch(() => { /* Saving succeeded; unavailable metadata stays unknown. */ });
  }
  useEffect(() => {
    const controller = new AbortController();
    const session = reportSession.current;
    reportRefresh.current?.abort();
    setError(''); setRemote(null); setConflict(false); setLoadFailed(false);
    if (!id) {
      setConfigurationReview(null);
      const draft = newManualDraft(); acceptedRecord.current = null;setRecord(null); setBase(draft); setForm(draftToForm(draft)); setSourceKind('manual'); setExtras({ media: draft.media, content: draft.content }); setLoading(false);
      setUncertain(false); setSuccess(''); setIssues([]); attempt.current = null; dirtyRef.current = false;
      return () => controller.abort();
    }
    setLoading(true);
    request(`/api/v1/admin/vehicles/${encodeURIComponent(id)}?includeDeleted=true`, AdminVehicleResponseSchema, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        accept(response.data);
        if (session === reportSession.current) { reportAllowed.current = true; setReportAccessExpired(false); }
      })
      .catch((failure: unknown) => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : '读取车辆失败。'); setLoadFailed(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, refresh]);
  function change<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((current) => ({ ...current, [key]: value, ...(key === 'title' ? { titleLanguage: 'zh' } : {}), ...(key === 'description' ? { descriptionLanguage: 'zh' } : {}) })); setSuccess('');
  }
  function confirm(title: string, content: string, okText = '确认'): Promise<boolean> {
    return new Promise(resolve => modal.confirm({ title, content, okText, cancelText: '取消', onOk: () => { resolve(true); }, onCancel: () => { resolve(false); } }));
  }
  async function loadRemote() {
    if (!id) return;
    try { const response = await request(`/api/v1/admin/vehicles/${encodeURIComponent(id)}?includeDeleted=true`, AdminVehicleResponseSchema); if (mounted.current) setRemote(response.data); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '读取最新版本失败，当前输入已保留。'); }
  }
  function focusIssue(issue: FieldIssue) {
    if (issue.key === 'powertrain' && sourceKind !== 'manual') issue = { ...issue, tab: 'basics' };
    if (issue.tab === 'localization') setLocalizationOpened(true);
    setActiveTab(issue.tab);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const node = (issue.key && document.getElementById(issue.key)) || document.querySelector(`[data-editor-section="${issue.tab}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (node instanceof HTMLElement) node.focus();
    }));
  }
  function showEntryIssues() {
    const missing: FieldIssue[] = entryIssues.map(key => ({ key, label: fieldLabels[key], tab: 'basics' }));
    if (!missing.length) return;
    setIssues(missing);
    setError(`请先补全或修正基础资料：${missing.map(issue => issue.label).join('、')}。`);
    focusIssue(missing[0]!);
  }

  function canContinuePastConfiguration(tab: TabKey, requireConfiguration = false) {
    if (tab === 'basics' || tab === 'configuration' || (activeTab !== 'configuration' && !configChanged)) return true;
    const problem = configurationInvalid ? '车辆配置格式有误，请按示例修正。'
      : requireConfiguration && !isDemo && !configurationState.value ? '请先填写配置 JSON 并完成人工核对。'
      : configurationFactIssues.length ? '请修正标准参数并重新核对。'
      : configurationNeedsConfirmation ? configurationReviewHint : '';
    if (!problem) return true;
    void message.warning(problem);
    if (activeTab !== 'configuration') focusIssue({ key: 'configuration', label: '车辆详细配置', tab: 'configuration' });
    return false;
  }

  function openTab(tab: TabKey) {
    if (tab !== 'basics' && entryIssues.length) { showEntryIssues(); return; }
    if (!canContinuePastConfiguration(tab)) return;
    setActiveTab(tab);
    if (tab === 'localization') setLocalizationOpened(true);
  }

  function focusPublicationIssue(issue: PublicationIssue) {
    if (issue.stage === 'localization' && record) {
      setPublicationTranslationFocus({ issue, vehicleId: record.id, version: record.version });
      openTab('localization');
    } else focusIssue(issueForPath(issue.path));
  }

  function clearPowertrain() {
    const config = configurationState.value;
    const rows = config?.items.filter(item => item.name.normalize('NFKC').trim() !== '动力类型');
    const configuration = rows && rows.length !== config?.items.length
      ? (rows.length ? JSON.stringify({ version: 1, items: rows }, null, 2) : '')
      : form.configuration;
    setConfigurationReview(null);
    setForm(current => ({ ...current, powertrain: 'unknown', configuration }));
    setSuccess('');
  }

  function confirmConfiguration() {
    if (locked || !currentConfigurationReview || !configurationState.value || configurationFactIssues.length) return;
    setConfigurationReview({ ...currentConfigurationReview, confirmed: true });
    setSuccess('');
    setError('');
  }

  function advance(tab: TabKey) {
    if (entryIssues.length && !uncertain) { showEntryIssues(); return; }
    if (!canContinuePastConfiguration(tab, activeTab === 'configuration')) return;
    if (localizationGuardRef.current.dirty || localizationGuardRef.current.uncertain) {
      void message.warning('请先补齐并保存全部译文，再继续。');
      return;
    }
    if (!id || coreDirty) void save(tab);
    else openTab(tab);
  }

  async function save(afterSave?: TabKey) {
    const guard = localizationGuardRef.current;
    if (inFlight.current || conflict || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || isDeleted || guard.dirty || guard.busy || guard.uncertain || id && !coreDirty) return;
    setError(''); setIssues([]); setSuccess('');
    if (!attempt.current && entryIssues.length) { showEntryIssues(); return; }
    const invalidPrice = invalidPriceFields[0];
    if (!attempt.current && invalidPrice) {
      setError(priceFormatError);
      focusIssue({ key: invalidPrice, label: fieldLabels[invalidPrice], tab: 'commercial' });
      return;
    }
    if (!attempt.current && (configurationNeedsConfirmation || configurationFactIssues.length)) {
      focusIssue({ key: 'configuration', label: '车辆详细配置', tab: 'configuration' });
      setError(configurationFactIssues.length ? '请修正标准参数并重新核对。' : configurationReviewHint);
      return;
    }
    if (configurationInvalid) {
      const issue: FieldIssue = { key: 'configuration', label: '车辆详细配置', tab: 'configuration' };
      setIssues([issue]); focusIssue(issue);
      setError('车辆详细配置格式有误，请按示例修正后保存。');
      return;
    }
    let body: string;
    try {
      if (!id && attempt.current) {
        if (Date.now() - attempt.current.startedAt >= 24 * 60 * 60 * 1000) { setError('本次创建请求已超过 24 小时，请先到车辆列表核对结果，再决定是否新建。'); return; }
        body = attempt.current.body;
      } else {
        const confirmed = configChanged && !isDemo && configurationConfirmed ? { ...form, ...configurationFacts.fields } : form;
        const sourceForm = isDemo ? formForDemo(confirmed) : isExternal ? formForExternal(confirmed) : confirmed;
        const draft = formToDraft({ ...base, ...extras, source: sourceForKind(sourceKind, sourceForm, base.source) }, sourceForm);
        const writeDraft = VehicleDraftWriteSchema.parse({ ...draft,
          configuration: sourceForm.configuration === baseForm.configuration ? draft.configuration : sourceForm.configuration,
        });
        body = JSON.stringify(id ? { version: record!.version, draft: writeDraft } : { draft: writeDraft });
        if (!id) attempt.current = { key: crypto.randomUUID(), body, startedAt: Date.now() };
      }
    } catch (failure) {
      const validation = failure as { issues?: { path: PropertyKey[] }[] };
      const nextIssues = validation.issues?.map(issue => issueForPath(issue.path.join('.'))) ?? [];
      setIssues(nextIssues); if (nextIssues[0]) focusIssue(nextIssues[0]);
      setError('请检查标出的字段。未知信息可以留空，已填写的数字、日期和金额须符合格式。'); return;
    }
    inFlight.current = true; setSaving(true);
    try {
      const response = await request(id ? `/api/v1/admin/vehicles/${encodeURIComponent(id)}` : '/api/v1/admin/vehicles', AdminVehicleResponseSchema, {
        method: id ? 'PATCH' : 'POST', body,
        headers: !id ? { 'Idempotency-Key': attempt.current!.key } : undefined,
      });
      if (!mounted.current) return;
      const publicContentCurrent = response.data.publicationState === 'published' && response.data.hasUnpublishedChanges === false;
      const identityChanged = response.data.draft.facts.make?.id !== base.facts.make?.id
        || response.data.draft.facts.model?.id !== base.facts.model?.id;
      if (id) acceptMutation(response.data); else accept(response.data);
      if (identityChanged) dictionary.reload();
      setSuccess(publicContentCurrent ? '草稿已保存，对外内容已是最新，无需重复发布。' : '草稿已保存，尚未发布这些修改。');
      void message.success(publicContentCurrent ? '资料已保存，公开内容无需重复发布。' : '草稿已保存。下一步可生成译文、检查图片并单独发布。');
      if (!id) {
        inFlight.current = false;
        navigate(`/vehicles/${encodeURIComponent(response.data.id)}`, { replace: true, state: { afterCreate: afterSave } });
      } else if (afterSave) openTab(afterSave);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof Error ? failure.message : '保存失败，当前输入已保留。');
      if (failure instanceof ApiClientError && failure.status > 0 && failure.status < 500) void message.error(failure.message);
      else void message.warning('尚未确认保存结果，当前输入已保留，请核对后再操作。');
      if (failure instanceof ApiClientError) {
        const nextIssues = failure.fields.map(item => issueForPath(item.path));
        setIssues(nextIssues); if (nextIssues[0]) focusIssue(nextIssues[0]);
        if (id && failure.status === 409) { setConflict(true); await loadRemote(); }
        const createRejected = [400, 401, 403, 404, 413, 422].includes(failure.status) || failure.status === 409 && failure.code === 'SOURCE_IDENTITY_CONFLICT';
        if (!id && !uncertain && createRejected) { attempt.current = null; setUncertain(false); }
        else if (!id) setUncertain(true);
      } else if (!id) setUncertain(true);
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }

  function textField(key: keyof DraftForm, options: { multiline?: boolean; hint?: string; inputMode?: 'decimal' | 'numeric'; maxLength?: number; label?: string; placeholder?: string } = {}) {
    const invalidPrice = invalidPriceFields.some(field => field === key);
    const invalid = invalidPrice || issues.some(issue => issue.key === key);
    const label = options.label ?? fieldLabels[key];
    const attrs = { id: key, name: key, value: form[key], disabled: locked || (isDemo && ['mileageKm', 'manufacturedAt', 'firstRegistration', 'vin'].includes(key)) || (!!record && isExternal && ['sourcePlatformId', 'sourceExternalId'].includes(key)), onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      change(key, event.target.value as DraftForm[typeof key]);
      if ((key === 'amount' || key === 'purchaseAmount') && error === priceFormatError) setError('');
      if (key === 'trimName' && event.target.value && !form.trimId) change('trimId', `manual_${crypto.randomUUID().replaceAll('-', '')}`);
      if (key === 'trimName' && !event.target.value) change('trimId', '');
    }, 'aria-label': label, 'aria-invalid': invalid, maxLength: options.maxLength ?? 10000, placeholder: options.placeholder };
    return <Form.Item label={label} required={required(key)} htmlFor={key} validateStatus={invalid ? 'error' : undefined} help={invalidPrice ? priceFormatError : invalid ? '请检查此项内容或格式' : undefined} extra={options.hint} key={key}>
      {options.multiline ? <Input.TextArea {...attrs} rows={3} /> : <Input {...attrs} inputMode={options.inputMode} />}
    </Form.Item>;
  }
  function selectField(key: keyof DraftForm, values: Record<string, string>, label = fieldLabels[key]) {
    return <Form.Item label={label} required={required(key)} htmlFor={key} key={key}><Select id={key} aria-label={label} value={form[key]} disabled={locked || (isDemo && ['registrationStatus', 'manufacturedPrecision', 'registrationPrecision'].includes(key))} onChange={value => change(key, value as DraftForm[typeof key])} options={Object.entries(values).map(([value, name]) => ({ value, label: name }))} /></Form.Item>;
  }
  function identityOptions(kind: 'make' | 'model') {
    const choices = kind === 'make' ? dictionary.data?.makes ?? [] : (dictionary.data?.models ?? []).filter(item => item.makeId === form.makeId);
    const selected = kind === 'make' ? { id: form.makeId, name: form.makeName } : { id: form.modelId, name: form.modelName };
    if (kind === 'make') return brandIdentityOptions(choices, selected);
    return modelIdentityOptions({ id: form.makeId, name: form.makeName }, choices, selected);
  }
  function chooseIdentity(kind: 'make' | 'model', value: string | undefined) {
    if (kind === 'make') {
      const option = identityOptions('make').find(item => item.value === value);
      setForm(current => ({ ...current, makeId: value ?? '', makeName: option?.rawName ?? '', ...(current.makeId !== value ? { modelId: '', modelName: '' } : {}) }));
    } else {
      const option = identityOptions('model').find(item => item.value === value);
      setForm(current => ({ ...current, modelId: value ?? '', modelName: option?.rawName ?? '' }));
    }
    setSuccess('');
  }
  function addIdentity() {
    const name = newName.trim();
    if (!newIdentity || !name || name.length > 120) { setNameError('请输入1–120个字符的名称。'); return; }
    const existing = identityOptions(newIdentity).find(item => item.rawName.toLocaleLowerCase() === name.toLocaleLowerCase());
    const newId = existing?.value ?? `manual_${crypto.randomUUID().replaceAll('-', '')}`;
    if (newIdentity === 'make') setForm(current => ({ ...current, makeId: newId, makeName: existing?.rawName ?? name, ...(current.makeId !== newId ? { modelId: '', modelName: '' } : {}) }));
    else setForm(current => ({ ...current, modelId: newId, modelName: existing?.rawName ?? name }));
    setNewIdentity(null); setNewName(''); setNameError(''); setSuccess('');
  }
  const comparisonRows = remote ? changedFields(form, draftToForm(remote.draft)).filter(key => !['makeId', 'modelId', 'trimId'].includes(key)).map(key => ({ key, label: fieldLabels[key], local: form[key] || '未填写', remote: draftToForm(remote.draft)[key] || '未填写' })) : [];

  const leaveDialog = <Modal open={blocker.state === 'blocked'} title="离开当前草稿？" okText="确认离开" cancelText="继续编辑" onOk={() => { if (blocker.state === 'blocked') blocker.proceed(); }} onCancel={() => { if (blocker.state === 'blocked') blocker.reset(); }} okButtonProps={{ danger: true }}>未保存的输入将丢失；如果正在保存或操作结果未确认，请先核对结果。</Modal>;
  if (loading) return <div className={styles.loading}><Spin size="large" /><Typography.Text type="secondary">正在读取车辆草稿…</Typography.Text></div>;
  if (loadFailed) return <Space orientation="vertical" size="large" className={styles.page}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/vehicles')}>返回车辆列表</Button><Alert type="error" title="读取车辆失败" description={error} showIcon action={<Button onClick={() => setRefresh(value => value + 1)}>重新读取</Button>} /></Space>;

  if (record && isDeleted) return <section className={styles.page}>
    <Breadcrumb items={[{ title: <Link to="/recycle-bin">车辆回收站</Link> }, { title: record.stockCode }]} />
    <header className={styles.heading}><div><Typography.Text type="secondary">回收站只读档案</Typography.Text><h1>车辆已移入回收站</h1><Typography.Paragraph type="secondary" className={styles.noMargin}>这辆车已停止公开，草稿与历史资料保留。恢复后仅回到未发布草稿，不会自动发布或加回首页。</Typography.Paragraph></div><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/recycle-bin')}>返回回收站</Button></header>
    <Alert type="warning" showIcon title="已删除记录只读" description="当前不能编辑、上传图片、核验库存或发布。先恢复草稿，再重新核对资料与发布条件。" className={styles.feedback} />
    <Card title="操作追溯" extra={<Button onClick={() => setHistoryOpen(true)}>操作记录</Button>}><ActivitySummary activity={record.activity} external={record.draft.source.kind === 'external'} /></Card>
    <ActivityHistory target={historyOpen ? { kind: 'vehicle', id: record.id, label: record.stockCode } : null} onClose={() => setHistoryOpen(false)} />
    <Card title="档案摘要" className={styles.card}><Descriptions column={{ xs: 1, sm: 2 }} items={[
      { key: 'stock', label: '稳定车号', children: record.stockCode },
      { key: 'source', label: '资料类型', children: record.draft.source.kind === 'external' ? '外部来源资料，非自有库存' : record.draft.source.kind === 'demo' ? '展示样例，非实际库存' : '真实车源录入' },
      { key: 'vehicle', label: '品牌车型', children: [record.draft.facts.make?.name, record.draft.facts.model?.name].filter(Boolean).join(' ') || '未填写' },
      { key: 'deleted', label: '删除时间', children: formatTime(record.deletedAt) },
      { key: 'title', label: '标题原文', children: record.draft.content.title.sourceText || '未填写' },
      ...(sourceReportUrl ? [{ key: 'report', label: '来源报告', children: <SourceReportLink url={sourceReportUrl} /> }] : []),
      { key: 'images', label: '保留图片', children: `${record.draft.media.length} 张（恢复前不提供预览）` },
    ]} /></Card>
    <VehicleDeletionActions vehicle={record} isDeleted disabled={saving || mediaBusy || actionsBusy || translationBusy || dirty} onBusyChange={setLifecycleBusy} onDeleted={acceptMutation} onRestored={acceptMutation} onConflict={() => { setError('记录状态已变化，正在重新读取。'); setRefresh(value => value + 1); }} />
    {leaveDialog}
  </section>;

  const basics = <div className={styles.sectionStack} data-editor-section="basics" tabIndex={-1}>
    {isDemo && <Alert type="warning" showIcon title="展示样例，不代表实际库存" description="样例仅用于展示车型，不展示价格或真实库存。" />}
    {isExternal && <Card title="外部来源资料" className={styles.card} extra={<Tag color="blue">保存前完整填写</Tag>}>
      <Typography.Paragraph type="secondary">保留可追溯的原始挂牌身份。采集时间与来源更新时间分别记录，时间使用UTC格式；此处不会下载或刷新外部网页。</Typography.Paragraph>
      <Row gutter={[24, 0]}>
        <Col xs={24} md={12}>{textField('sourcePlatformId', { maxLength: 100, placeholder: '如 mobile-de', hint: record ? '平台身份创建后不可更改。' : '同一平台统一使用相同标识；创建后不可更改。' })}</Col>
        <Col xs={24} md={12}>{textField('sourcePlatformName', { maxLength: 120, placeholder: '填写来源平台的显示名称' })}</Col>
        <Col xs={24} md={12}>{textField('sourceExternalId', { maxLength: 300, placeholder: '来源平台内的挂牌编号或稳定身份', hint: record ? '原始挂牌身份创建后不可更改。' : '与平台共同确定原始挂牌；创建后不可更改。' })}</Col>
        <Col xs={24} md={12}>{textField('sourceListingUrl', { maxLength: 2048, placeholder: 'https://原始挂牌页面地址', hint: '记录原始HTTP(S)链接，不含用户名、密码或空格。' })}</Col>
        <Col xs={24} md={12}><Form.Item label={fieldLabels.sourceCollectedAt} htmlFor="sourceCollectedAt"><UtcDateTimeField id="sourceCollectedAt" label={fieldLabels.sourceCollectedAt} value={form.sourceCollectedAt} disabled={locked} onChange={value => change('sourceCollectedAt', value)} /></Form.Item></Col>
        <Col xs={24} md={12}><Form.Item label={fieldLabels.sourceUpdatedAt} htmlFor="sourceUpdatedAt"><UtcDateTimeField id="sourceUpdatedAt" label={fieldLabels.sourceUpdatedAt} value={form.sourceUpdatedAt} disabled={locked} onChange={value => change('sourceUpdatedAt', value)} /></Form.Item></Col>
      </Row>
    </Card>}
    <Card title="中文标题与车辆分类" className={styles.card} extra={<Tag>发布前完善</Tag>}>
      {dictionary.error && <Alert type="warning" showIcon title="品牌车型暂未读取成功" description="已有车辆名称会继续保留。可重新读取，或仅在确有新名称时新增。" action={<Button size="small" onClick={dictionary.reload}>重新读取</Button>} className={styles.inlineAlert} />}
      <Row gutter={[24, 0]}>
        <Col xs={24} md={12}><Form.Item label="品牌" required={required("makeName")} htmlFor="makeName" validateStatus={issues.some(issue => issue.key === 'makeName') ? 'error' : undefined} help={issues.some(issue => issue.key === 'makeName') ? '请选择或新增品牌' : undefined}>
          <Space.Compact className={styles.fullWidth}><Select id="makeName" aria-label="品牌" showSearch optionFilterProp="label" allowClear placeholder="搜索并选择品牌" value={form.makeId || undefined} disabled={locked} loading={dictionary.loading} options={identityOptions('make')} onChange={value => chooseIdentity('make', value)} className={styles.flexSelect} /><Button icon={<PlusOutlined />} aria-label="新增品牌" disabled={locked} onClick={() => { setNewIdentity('make'); setNewName(''); setNameError(''); }}>新增</Button></Space.Compact>
        </Form.Item></Col>
        <Col xs={24} md={12}><Form.Item label="车型" required={required("modelName")} htmlFor="modelName" validateStatus={issues.some(issue => issue.key === 'modelName') ? 'error' : undefined} help={issues.some(issue => issue.key === 'modelName') ? '请选择或新增车型' : undefined}>
          <Space.Compact className={styles.fullWidth}><Select id="modelName" aria-label="车型" showSearch optionFilterProp="label" allowClear placeholder={form.makeId ? '搜索该品牌车型' : '请先选择品牌'} value={form.modelId || undefined} disabled={locked || !form.makeId} loading={dictionary.loading} options={identityOptions('model')} onChange={value => chooseIdentity('model', value)} className={styles.flexSelect} /><Button icon={<PlusOutlined />} aria-label="新增车型" disabled={locked || !form.makeId} onClick={() => { setNewIdentity('model'); setNewName(''); setNameError(''); }}>新增</Button></Space.Compact>
        </Form.Item></Col>
        <Col xs={24} md={16}>{textField('title', { label: '标题原文', placeholder: '填写中文车型标题，保存后生成英俄译文' })}</Col>
        {form.titleLanguage.split('-')[0] !== 'zh' && <Col span={24}><Alert showIcon type="info" title="历史标题的原文语言未标为中文" description="如需更新中文展示，可在这里填写并保存中文标题。" /></Col>}
        <Col span={24}>{textField('description', { multiline: true, label: '车况描述', hint: '请使用中文描述车辆外观、内饰、维修及已知问题，将用于公开展示，发布时必填。' })}{form.descriptionLanguage.split('-')[0] !== 'zh' && <Alert showIcon type="info" title="历史车况的原文语言未标为中文" description="如需更新中文展示，可在这里填写并保存中文车况。" />}</Col>
        <Col xs={24} md={12}>{textField('trimName', { label: '配置名称', maxLength: 120, placeholder: '如长续航版、尊贵版' })}</Col>
        <Col xs={24} md={12}><Form.Item label="年款" htmlFor="modelYear" required={required('modelYear')} extra="年款与制造日期分别记录。">
          <DatePicker id="modelYear" aria-label="年款" picker="year" format="YYYY" inputReadOnly value={form.modelYear ? dayjs(form.modelYear) : null}
            disabled={locked} onChange={date => change('modelYear', date ? date.format('YYYY') : '')} />
        </Form.Item></Col>
      </Row>
    </Card>
    <Card title="基础事实" className={styles.card}>
      <Row gutter={[24, 0]}>
        {sourceKind !== 'manual' && <Col xs={24} md={8}>{selectField('powertrain', powertrainLabels)}</Col>}
        <Col xs={24} md={8}>{textField('mileageKm', { inputMode: 'numeric', hint: '确认为零时填写 0。' })}</Col>
        <Col xs={24} md={8}>{selectField('registrationStatus', { unknown: '未知', never_registered: '从未登记', registered: '已登记' })}</Col>
        <Col xs={24} md={12}><Form.Item label="制造日期" htmlFor="manufacturedAt" extra="按已知精度选择，未知可留空。">
          <PartialDateField id="manufacturedAt" label="制造日期" disabled={locked || isDemo}
            value={form.manufacturedAt ? { value: form.manufacturedAt, precision: form.manufacturedPrecision } : null}
            onChange={date => { setSuccess(''); setForm(current => ({ ...current, manufacturedAt: date?.value ?? '', manufacturedPrecision: date?.precision ?? current.manufacturedPrecision })); }} />
        </Form.Item></Col>
        <Col xs={24} md={12}><Form.Item label="首次登记日期" htmlFor="firstRegistration">
          <PartialDateField id="firstRegistration" label="首次登记日期" disabled={locked || isDemo}
            value={form.firstRegistration ? { value: form.firstRegistration, precision: form.registrationPrecision } : null}
            onChange={date => { setSuccess(''); setForm(current => ({ ...current, firstRegistration: date?.value ?? '', registrationPrecision: date?.precision ?? current.registrationPrecision })); }} />
        </Form.Item></Col>
      </Row>
    </Card>
  </div>;
  const configuration = <div className={styles.sectionStack} data-editor-section="configuration" tabIndex={-1}>
    <VehicleConfigurationEditor prompt={buildConfigurationAiPrompt(form)} value={form.configuration}
      onChange={value => { setConfigurationReview(null); change('configuration', value); }}
      onReview={() => setConfigurationReview({ input: form.configuration, confirmed: false })}
      showReview={showConfigurationReview} rows={configurationState.value?.items ?? null}
      errors={configurationState.errors} disabled={locked} requiredForPublish={!isDemo} />
    {sourceKind === 'manual' && <Space wrap>
      <Typography.Text type="secondary" id="powertrain" tabIndex={-1}>
        当前动力类型：{form.powertrain === 'unknown' ? '待从 AI 配置导入' : powertrainLabels[form.powertrain]}
      </Typography.Text>
      {form.powertrain !== 'unknown' && <Button size="small" disabled={locked || configurationInvalid} onClick={clearPowertrain}>
        清除动力类型
      </Button>}
    </Space>}
    {!isDemo && showConfigurationReview && <Card title="可用于筛选及费用参考的标准参数" className={styles.card}>
      <Space orientation="vertical" size="middle">
        {!!configurationFactIssues.length && <Alert showIcon type="error" title={configurationFactIssues.join('；')} />}
        {Object.keys(configurationFacts.fields).length > 0
          ? <Descriptions size="small" items={Object.entries(configurationFacts.fields).map(([key, value]) => ({ key, label: fieldLabels[key as keyof DraftForm], children: configurationFacts.labels[key as keyof typeof configurationFacts.labels] ?? value }))} />
          : <Typography.Text type="secondary">本次没有识别到要更新的标准参数。已保存的参数会保留。</Typography.Text>}
        {configChanged && (configurationConfirmed
          ? <Tag color="success">人工核对已完成</Tag>
          : <><Typography.Text>请核对上方解析结果及本次识别的标准参数。</Typography.Text>
            <Button type="primary" disabled={locked || configurationFactIssues.length > 0} onClick={confirmConfiguration}>人工核对无误</Button></>)}
      </Space>
    </Card>}
  </div>;
  const commercial = <div className={styles.sectionStack} data-editor-section="commercial" tabIndex={-1}>
    <Card title="公开价格" extra={isDemo ? <Tag color="gold">样例不报价</Tag> : <Tag>公开字段</Tag>} className={styles.card}>
      {isDemo ? <Alert type="info" showIcon title="展示样例不填写价格" description="公开数据保持待询价，不把展示样例当成可购买库存。" /> : <><Typography.Paragraph type="secondary">{isExternal ? '来源参考价格不代表本店报价或成交承诺。保留原币种与价格范围，缺少价格时选择待询价。' : '默认公开报价。可先保存未完成草稿；正式发布前填写正数金额，并核对币种。'}</Typography.Paragraph><Row gutter={[24, 0]}>
        <Col xs={24} md={8}>{selectField('priceKind', isExternal ? { on_request: '待询价', reference: '来源参考价格' } : { on_request: '待询价', asking: '公开报价', reference: '参考价格' })}</Col>
        {form.priceKind !== 'on_request' && <Col xs={24} md={8}>{textField('amount', { inputMode: 'numeric', hint: `单位 ${base.price.money?.amount ? form.currency : 'CNY'}，填写整数。` })}</Col>}
      </Row></>}
    </Card>
    <Card title="内部信息" extra={<Tag>仅员工可见</Tag>} className={styles.card}>
      <Typography.Paragraph type="secondary">采购成本、供应商联系方式和备注不会出现在公开车辆内容中。</Typography.Paragraph><Row gutter={[24, 0]}>
        <Col xs={24} md={12}>{textField('purchaseAmount', { inputMode: 'numeric', hint: `单位 ${base.internal.purchaseCost?.amount ? form.purchaseCurrency : 'CNY'}，填写整数。` })}</Col>
        <Col xs={24} md={12}>{textField('supplierContact', { maxLength: 1000 })}</Col><Col xs={24} md={12}>{textField('vin', { maxLength: 17 })}</Col>
      </Row>
    </Card>
    <Card title="内部备注" className={styles.card}>
      <Row gutter={[24, 0]}>
        <Col span={24}>{textField('notes', { multiline: true, hint: '仅员工可见。' })}</Col>
      </Row>
    </Card>
  </div>;
  const images = <div data-editor-section="images" tabIndex={-1}>{externalSourceChanged && <Alert type="info" showIcon title="来源资料尚未保存" description="请先保存来源资料，再上传图片，以便逐图对应正确的原始挂牌。" className={styles.feedback} />}{record ? <VehicleMediaEditor source={record.draft.source} vehicleId={record.id} value={extras.media} savedMediaIds={base.media.map(media => media.id)} onChange={media => { setExtras(previous => ({ ...previous, media })); setSuccess(''); }} onBusyChange={setMediaBusy} disabled={saving || uncertain || actionsBusy || lifecycleBusy || translationBusy || localizationLocked || conflict || externalSourceChanged} /> : <Card className={styles.card}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先保存车辆草稿，再添加图片" /><Typography.Paragraph type="secondary" className={styles.center}>图片需要归属到已保存的车辆。你可以先保存已有信息，再继续录入。</Typography.Paragraph></Card>}</div>;
  const currentPublicationIssues = record && publicationReadiness?.vehicleId === record.id && publicationReadiness.vehicleVersion === record.version
    ? publicationReadiness.issues.filter(issue => issue.stage === 'localization') : [];
  const localization = <div className={styles.sectionStack} data-editor-section="localization" tabIndex={-1}>
    {record && localizationOpened ? <VehicleTranslationWorkspace key={record.id} vehicle={record} hasUnsavedChanges={coreDirty}
      active={activeTab === 'localization'} publicationIssues={currentPublicationIssues} publicationFocus={publicationTranslationFocus}
      disabled={saving || uncertain || mediaBusy || actionsBusy || lifecycleBusy || conflict} onGuardChange={localizationGuardChanged} onBusyChange={setTranslationBusy}
      canAdoptVehicle={vehicle => !!acceptedRecord.current && acceptedRecord.current.id === vehicle.id && !acceptedRecord.current.deletedAt && vehicle.version >= acceptedRecord.current.version}
      onVehicleUpdated={accept} onConflict={() => { setConflict(true); void loadRemote(); }} />
      : <Alert showIcon type="info" title="先保存中文资料，再生成英俄译文" description="标题和车况描述在基础资料填写。多语页面引用已保存的原文。" />}
  </div>;
  const review = <div className={styles.sectionStack} data-editor-section="review" tabIndex={-1}>
    {record && activeTab === 'review' && <PublicationPreviewPanel vehicleId={record.id} version={record.version} locale={previewLocale} onLocaleChange={setPreviewLocale} hasUnsavedChanges={dirty} disabled={saving || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || localizationLocked || conflict} onRendered={setPreviewReceipt} />}
    {record ? <VehicleActions key={record.id} publicationTabActive={activeTab === 'review'} previewLocale={previewLocale} previewReceipt={previewReceipt}
      onIssue={focusPublicationIssue} onReadinessChange={setPublicationReadiness} vehicle={record} hasUnsavedChanges={dirty}
      disabled={saving || mediaBusy || lifecycleBusy || translationBusy || localizationLocked || conflict} onUpdated={acceptMutation}
      onConflict={() => { setConflict(true); void loadRemote(); }} onBusyChange={setActionsBusy} />
      : <Alert type="info" showIcon title="先保存草稿，再完成发布" description="图片、多语和库存信息完善后，在这里检查预览并发布。" />}
  </div>;

  return <section className={styles.page}>
    <Breadcrumb items={[{ title: <Link to="/vehicles">车辆工作台</Link> }, { title: record?.stockCode ?? '新建车辆' }]} />
    <header className={styles.heading}><div><Typography.Text type="secondary">车辆资料</Typography.Text><h1>{id ? '编辑车辆草稿' : '新建车辆'}</h1><Typography.Paragraph type="secondary" className={styles.noMargin}>填完基础资料后可保存草稿，再继续填写后续资料。</Typography.Paragraph></div><Space wrap><Tag color={isDemo ? 'gold' : isExternal ? 'blue' : undefined}>{isDemo ? '展示样例，非实际库存' : isExternal ? '外部来源资料，非自有库存' : '真实车源录入'}</Tag>{record && <><Tag color={record.publicationState === 'published' ? 'green' : undefined}>{publicationLabels[record.publicationState]}</Tag><Tag>{isDemo ? '非实际库存' : isExternal ? '外部库存未知' : availabilityLabels[record.availability]}</Tag></>}<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/vehicles')}>返回车辆列表</Button><div>{activeTab !== 'review' && <Button onClick={() => { openTab('review'); }}>进入发布预览</Button>}</div></Space></header>
    {record && <Card size="small" title="操作追溯" extra={<Button onClick={() => setHistoryOpen(true)}>操作记录</Button>}><ActivitySummary activity={record.activity} external={record.draft.source.kind === 'external'} /></Card>}
    <ActivityHistory target={historyOpen && record ? { kind: 'vehicle', id: record.id, label: record.stockCode } : null} onClose={() => setHistoryOpen(false)} />
    {record && <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} className={styles.metadata} items={[{ key: 'version', label: '草稿版本', children: record.version }, { key: 'updated', label: '最近修改', children: formatTime(record.updatedAt) }, { key: 'checked', label: '库存核验', children: isDemo ? '不适用（展示样例）' : isExternal ? '不适用（外部来源）' : formatTime(record.availabilityCheckedAt) }, ...(sourceReportUrl ? [{ key: 'report', label: '来源报告', children: <SourceReportLink url={sourceReportUrl} /> }] : [])]} />}
    {error && <Alert role="alert" type="error" showIcon title="草稿尚未保存" description={<><p>{error}</p>{issues.length > 0 && <Space wrap>{issues.map((issue, index) => <Button size="small" key={index} onClick={() => focusIssue(issue)}>{issue.label}：检查内容</Button>)}</Space>}</>} className={styles.feedback} />}
    {success && <Alert role="status" type="success" showIcon title={success} className={styles.feedback} />}
    {uncertain && <Alert type="warning" showIcon title="创建结果尚未确认" description="已保留这次创建的原请求，表单暂时锁定。重试会核对原结果，避免重复建车。" className={styles.feedback} />}
    {conflict && <Card title="车辆已被其他操作更新" className={styles.feedback}><Alert type="warning" showIcon title="当前输入已保留" description="请对照最新草稿。重新载入会明确放弃当前输入，不会覆盖服务端。" /><Space wrap className={styles.conflictActions}><Button onClick={() => void loadRemote()}>读取最新版本供比较</Button>{remote && <><Tag>服务端版本 {remote.version}</Tag><Button danger onClick={async () => { if (await confirm('放弃当前输入？', '重新载入会放弃当前未保存的输入，载入同事已保存的最新版本。', '放弃并载入最新草稿') && mounted.current) { accept(remote); setError(''); } }}>放弃当前输入，载入最新草稿</Button></>}</Space>{remote && (comparisonRows.length ? <Table size="small" rowKey="key" pagination={false} scroll={{ x: 600 }} dataSource={comparisonRows} columns={[{ title: '字段', dataIndex: 'label', width: 130 }, { title: '当前输入', dataIndex: 'local', render: value => <span className={styles.compareText}>{value}</span> }, { title: '服务端最新内容', dataIndex: 'remote', render: value => <span className={styles.compareText}>{value}</span> }]} /> : <Typography.Paragraph type="secondary">可编辑字段一致，版本、库存、图片或译文状态可能已经变化。</Typography.Paragraph>)}</Card>}
    <Form layout="vertical" onFinish={() => void save()} disabled={locked} requiredMark className={styles.form}>
      {(activeTab !== 'localization' || coreDirty || !record) && <div className={styles.saveBar}><div><Badge status={dirty ? 'warning' : 'success'} text={dirty ? '有未保存的输入' : record ? '已保存到草稿' : '填写后保存草稿'} /><Typography.Text type="secondary" className={styles.saveHint}>{entryIssues.length ? `请先补全：${entryIssues.map(key => fieldLabels[key]).join('、')}` : invalidPriceFields.length ? '请将价格和采购成本改为整数' : configurationInvalid ? '车辆配置格式有误，请到车辆配置页按提示修正后保存' : configurationNeedsConfirmation ? configurationReviewHint : localizationLocked ? '多语翻译有未处理的修改，请返回多语页面保存或放弃' : saving ? '正在保存，请稍候' : translationBusy ? '正在生成或核对机器译文' : lifecycleBusy ? '正在确认删除或恢复结果' : actionsBusy ? '正在确认发布或库存结果' : mediaBusy ? '正在处理图片' : '保存不会自动发布到公开页面'}</Typography.Text></div>{localizationLocked && activeTab !== 'localization' ? <Button onClick={() => { setLocalizationOpened(true); setActiveTab('localization'); }}>返回多语处理修改</Button>
        : (activeTab !== 'localization' || coreDirty || !record) && <Button type="primary" htmlType="submit" icon={dirty ? <SaveOutlined /> : <CheckCircleOutlined />} loading={saving} disabled={(!uncertain && (entryIssues.length > 0 || configurationNeedsConfirmation || configurationFactIssues.length > 0 || configurationInvalid || invalidPriceFields.length > 0)) || conflict || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || localizationLocked || (!!id && !coreDirty)}>{uncertain ? '重试原创建请求' : activeTab === 'localization' && record ? '保存基础资料' : '保存草稿'}</Button>}</div>}
      <Tabs activeKey={activeTab} onChange={key => openTab(key as TabKey)} destroyOnHidden={false} className={styles.tabs} items={[
        { key: 'basics', label: <span><FileTextOutlined /> 基础资料</span>, children: basics, forceRender: true },
        { key: 'configuration', label: <span><UnorderedListOutlined /> 车辆配置</span>, children: configuration, forceRender: true },
        { key: 'commercial', label: <span><UnorderedListOutlined /> 价格与内部信息</span>, children: commercial, forceRender: true },
        { key: 'images', label: <span><CloudUploadOutlined /> 图片管理 <Tag bordered={false}>{extras.media.length}</Tag></span>, children: images, forceRender: true },
        { key: 'localization', label: <span><GlobalOutlined /> 公开字段多语</span>, children: localization, forceRender: true },
        { key: 'review', label: <span><CheckCircleOutlined /> 发布预览</span>, children: review, forceRender: true },
      ]} />
      {nextStep && <footer className={styles.nextBar}>
        <Button loading={saving} disabled={mediaBusy || actionsBusy || lifecycleBusy || translationBusy || conflict || invalidPriceFields.length > 0}
          onClick={() => advance(nextStep.key)}>下一步：{nextStep.label}</Button>
      </footer>}
    </Form>
    {record && <div className={styles.lifecyclePanel}>
      {dirty && <Alert type="info" showIcon title="先保存或处理当前修改，再移入回收站" className={styles.feedback} />}
      <VehicleDeletionActions vehicle={record} isDeleted={false} disabled={dirty || saving || mediaBusy || actionsBusy || translationBusy || localizationLocked || conflict} onBusyChange={setLifecycleBusy} onDeleted={acceptMutation} onRestored={acceptMutation} onConflict={() => { setConflict(true); void loadRemote(); }} />
    </div>}
    {leaveDialog}
    <Modal open={newIdentity !== null} title={newIdentity === 'make' ? '新增品牌' : '新增车型'} okText={newIdentity === 'make' ? '添加品牌' : '添加车型'} cancelText="取消" onOk={addIdentity} onCancel={() => setNewIdentity(null)}><Typography.Paragraph type="secondary">只需填写名称。保存车辆草稿后，该名称会加入相应品牌车型选项。</Typography.Paragraph><Form layout="vertical"><Form.Item label={newIdentity === 'make' ? '品牌名称' : '车型名称'} validateStatus={nameError ? 'error' : undefined} help={nameError || undefined}><Input aria-label={newIdentity === 'make' ? '品牌名称' : '车型名称'} autoFocus value={newName} onChange={event => { setNewName(event.target.value); setNameError(''); }} maxLength={120} onPressEnter={addIdentity} /></Form.Item></Form></Modal>
  </section>;
}
