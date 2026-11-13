import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Badge, Breadcrumb, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Radio, Row, Select, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, CloudUploadOutlined, FileTextOutlined, GlobalOutlined, PlusOutlined, SaveOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { AdminVehicleResponseSchema, CurrencySchema, VehicleDraftWriteSchema, type AdminVehicle, type ConfirmPublicationPreviewRequest, type VehicleDraftInput } from '@hd/contracts/admin';
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
import { VehicleTranslationWorkspace, type TranslationWorkspaceGuard as LocalizationGuard } from './vehicle-translation-workspace';
import { brandIdentityOptions } from './vehicle-localization-model';
import { modelIdentityOptions } from './model-suggestions';
import styles from './vehicle-editor.module.css';
import { externalSourceFormKeys, formForDemo, formForExternal, hasDemoRestrictedValues, sourceForKind } from './vehicle-editor-helpers';
import { configurationFormState } from './configuration-form';
import { VehicleConfigurationEditor } from './vehicle-configuration-editor';

type TabKey = 'basics' | 'configuration' | 'commercial' | 'images' | 'review' | 'localization';
type SourceKind = VehicleDraftInput['source']['kind'];
type FieldIssue = { key?: keyof DraftForm; label: string; tab: TabKey };
type CreateAttempt = { key: string; body: string; startedAt: number };
const blank = emptyDraft();
const countries = [
  { value: 'CN', label: '中国' }, { value: 'KR', label: '韩国' }, { value: 'JP', label: '日本' },
  { value: 'AE', label: '阿联酋' }, { value: 'DE', label: '德国' }, { value: 'US', label: '美国' },
  { value: 'RU', label: '俄罗斯' }, { value: 'KZ', label: '哈萨克斯坦' }, { value: 'UZ', label: '乌兹别克斯坦' },
  { value: 'GE', label: '格鲁吉亚' }, { value: 'AM', label: '亚美尼亚' }, { value: 'KG', label: '吉尔吉斯斯坦' },
  { value: 'GB', label: '英国' }, { value: 'AL', label: '阿尔巴尼亚' },
];

function tabForField(key?: keyof DraftForm, path = ''): TabKey {
  if (key === 'configuration') return 'configuration';
  if (path.replace(/^draft\./, '').startsWith('localization')) return 'localization';
  if (path.includes('media')) return 'images';
  if (path.includes('translations')) return 'localization';
  if (key && ['priceKind', 'amount', 'currency', 'includes', 'description', 'descriptionLanguage', 'purchaseAmount', 'purchaseCurrency', 'supplierContact', 'vin', 'notes'].includes(key)) return 'commercial';
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
  const { modal, message } = App.useApp();
  const dictionary = useVehicleDictionary();
  const [record, setRecord] = useState<AdminVehicle | null>(null);
  const [publishTarget, setPublishTarget] = useState<HTMLDivElement | null>(null);
  const [previewLocale, setPreviewLocale] = useState<Locale>('zh');
  const [previewOpened, setPreviewOpened] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<ConfirmPublicationPreviewRequest | null>(null);
  const acceptedRecord = useRef<AdminVehicle | null>(null);
  const reportRefresh = useRef<AbortController | null>(null);
  const reportSession = useRef(0);
  const reportAllowed = useRef(true);
  const [reportAccessExpired, setReportAccessExpired] = useState(false);
  const [base, setBase] = useState<VehicleDraftInput>(blank);
  const [form, setForm] = useState<DraftForm>(() => draftToForm(blank));
  const configurationState = useMemo(() => configurationFormState(form.configuration), [form.configuration]);
  const configurationInvalid = configurationState.errors.length > 0;
  const [sourceKind, setSourceKind] = useState<SourceKind | undefined>();
  const [extras, setExtras] = useState(() => ({ media: blank.media, content: blank.content }));
  const [mediaBusy, setMediaBusy] = useState(false);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [localizationGuard, setLocalizationGuard] = useState<LocalizationGuard>({ dirty: false, busy: false, uncertain: false });
  const localizationGuardRef = useRef(localizationGuard);
  const [localizationOpened, setLocalizationOpened] = useState(false);
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
  const [activeTab, setActiveTab] = useState<TabKey>('basics');
  const [newIdentity, setNewIdentity] = useState<'make' | 'model' | null>(null);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const attempt = useRef<CreateAttempt | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const coreDirty = JSON.stringify(form) !== JSON.stringify(draftToForm(base)) || JSON.stringify(extras) !== JSON.stringify({ media: base.media, content: base.content }) || sourceKind !== (id ? base.source.kind : undefined) || uncertain;
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
  const externalSourceChanged = isExternal && externalSourceFormKeys.some(key => form[key] !== draftToForm(base)[key]);
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

  useEffect(() => { setPreviewOpened(false); setPreviewReceipt(null); }, [id]);

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
      const draft = emptyDraft(); acceptedRecord.current = null;setRecord(null); setBase(draft); setForm(draftToForm(draft)); setSourceKind(undefined); setExtras({ media: draft.media, content: draft.content }); setLoading(false);
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
  async function chooseSource(next: SourceKind) {
    if (record || locked || next === sourceKind) return;
    if (next === 'demo') {
      const restrictedForm = !sourceKind && form.registrationStatus === 'registered' ? { ...form, registrationStatus: 'unknown' as const } : form;
      if ((sourceKind === 'manual' || hasDemoRestrictedValues(restrictedForm)) && !await confirm('切换为展示样例？', '展示样例不代表实际库存。将清空公开价格、制造与首次登记日期、里程、所在地和VIN，取消实际库存核验。车型规格与图片继续保留。', '切换并清空实车信息')) return;
      if (!mounted.current) return;
      setForm(current => formForDemo(current));
    }
    if (next === 'external' && form.priceKind === 'asking') {
      if (!await confirm('切换为外部挂牌资料？', '第三方挂牌不代表自有库存。当前公开报价会改为来源参考价，不会自动核验库存或改变已观察到的车辆事实。', '改为来源参考价')) return;
      if (!mounted.current) return;
      setForm(current => formForExternal(current));
    }
    if (next === 'manual' && (!sourceKind || sourceKind === 'demo')) {
      setForm(current => ({ ...current, country: current.country || 'CN', registrationStatus: sourceKind === 'demo' ? 'registered' : current.registrationStatus, priceKind: current.priceKind === 'on_request' ? 'asking' : current.priceKind }));
    }
    if (next === 'external' && sourceKind === 'demo') setForm(current => ({ ...current, registrationStatus: 'registered' }));
    setSourceKind(next); setSuccess('');
  }
  async function loadRemote() {
    if (!id) return;
    try { const response = await request(`/api/v1/admin/vehicles/${encodeURIComponent(id)}?includeDeleted=true`, AdminVehicleResponseSchema); if (mounted.current) setRemote(response.data); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '读取最新版本失败，当前输入已保留。'); }
  }
  function focusIssue(issue: FieldIssue) {
    if (issue.tab === 'localization') setLocalizationOpened(true);
    if (issue.tab === 'review') setPreviewOpened(true);
    setActiveTab(issue.tab);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const node = issue.key ? document.getElementById(issue.key) : document.querySelector(`[data-editor-section="${issue.tab}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (node instanceof HTMLElement) node.focus();
    }));
  }
  async function save() {
    const guard = localizationGuardRef.current;
    if (inFlight.current || conflict || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || isDeleted || guard.dirty || guard.busy || guard.uncertain || id && !coreDirty) return;
    setError(''); setIssues([]); setSuccess('');
    if (!sourceKind) { setError('请先选择真实车源、展示样例或外部挂牌资料，再保存草稿。'); setActiveTab('basics'); return; }
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
        const sourceForm = isDemo ? formForDemo(form) : isExternal ? formForExternal(form) : form;
        const draft = formToDraft({ ...base, ...extras, source: sourceForKind(sourceKind, sourceForm, base.source) }, sourceForm);
        const writeDraft = VehicleDraftWriteSchema.parse({ ...draft,
          configuration: sourceForm.configuration === draftToForm(base).configuration ? draft.configuration : sourceForm.configuration,
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
      if (id) acceptMutation(response.data); else accept(response.data);
      setSuccess(publicContentCurrent ? '草稿已保存，对外内容已是最新，无需重复发布。' : '草稿已保存，尚未发布这些修改。');
      void message.success(publicContentCurrent ? '资料已保存，公开内容无需重复发布。' : '草稿已保存。下一步可生成译文、检查图片并单独发布。');
      if (!id) { inFlight.current = false; navigate(`/vehicles/${encodeURIComponent(response.data.id)}`, { replace: true }); }
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
    const invalid = issues.some(issue => issue.key === key);
    const label = options.label ?? fieldLabels[key];
    const attrs = { id: key, name: key, value: form[key], disabled: locked || (isDemo && ['mileageKm', 'manufacturedAt', 'firstRegistration', 'vin'].includes(key)) || (!!record && isExternal && ['sourcePlatformId', 'sourceExternalId'].includes(key)), onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      change(key, event.target.value as DraftForm[typeof key]);
      if (key === 'trimName' && event.target.value && !form.trimId) change('trimId', `manual_${crypto.randomUUID().replaceAll('-', '')}`);
      if (key === 'trimName' && !event.target.value) change('trimId', '');
    }, 'aria-label': label, 'aria-invalid': invalid, maxLength: options.maxLength ?? 10000, placeholder: options.placeholder };
    return <Form.Item label={label} required={required(key)} htmlFor={key} validateStatus={invalid ? 'error' : undefined} help={invalid ? '请检查此项内容或格式' : undefined} extra={options.hint} key={key}>
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
  const currencyOptions = Object.fromEntries(CurrencySchema.options.map(value => [value, value]));
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
    <Card title="资料类型" className={styles.card}>
      <Form.Item label="车源类型" required help={!sourceKind && error ? '请选择资料类型' : undefined} validateStatus={!sourceKind && error ? 'error' : undefined}>
        <Radio.Group value={sourceKind} onChange={event => void chooseSource(event.target.value as SourceKind)} disabled={locked || !!record} className={styles.sourceChoices}>
          <Radio.Button value="manual">真实车源录入</Radio.Button><Radio.Button value="demo">展示样例，非实际库存</Radio.Button><Radio.Button value="external">外部挂牌资料</Radio.Button>
        </Radio.Group>
      </Form.Item>
      {record && <Typography.Paragraph type="secondary">创建后资料类型不可更改。如需另一种类型，请另建车辆记录。</Typography.Paragraph>}
      {isDemo ? <Alert type="warning" showIcon title="展示样例，不代表实际库存" description="样例仅用于展示车型，不展示价格，不进行真实库存核验；制造／登记日期、里程、所在地及VIN保持未知。" /> : isExternal ? <Alert type="info" showIcon title="外部来源资料，非自有库存" description="记录第三方挂牌及采集时间，不代表拥有该车或已核验现货。价格仅作来源参考，未知事实保持未填写；库存状态始终未知。员工发布前同样需要完整车辆资料、采购成本、当前三语译文和预览确认。" /> : <Typography.Paragraph type="secondary" className={styles.noMargin}>草稿可以先保存。正式发布前，请核实车辆事实、图片权属与实际库存，完善三语译文并确认发布预览。</Typography.Paragraph>}
    </Card>
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
        {form.titleLanguage.split('-')[0] !== 'zh' && <Col span={24}><Alert showIcon type="warning" title="请先将历史标题整理为中文" description="在基础资料修改标题后再保存，之后即可生成英俄译文。" /></Col>}
        <Col xs={24} md={12}>{textField('trimName', { label: '配置名称', maxLength: 120, placeholder: '如长续航版、尊贵版' })}</Col>
        <Col xs={24} md={12}><Form.Item label="年款" htmlFor="modelYear" required={required('modelYear')} extra="年款与制造日期分别记录。">
          <DatePicker id="modelYear" aria-label="年款" picker="year" format="YYYY" inputReadOnly value={form.modelYear ? dayjs(form.modelYear) : null}
            disabled={locked} onChange={date => change('modelYear', date ? date.format('YYYY') : '')} />
        </Form.Item></Col>
      </Row>
    </Card>
    <Card title="基础事实" className={styles.card}>
      <Row gutter={[24, 0]}>
        <Col xs={24} md={8}>{selectField('powertrain', powertrainLabels)}</Col>
        <Col xs={24} md={8}>{textField('mileageKm', { inputMode: 'numeric', hint: '未知留空，确认为零时填写0。' })}</Col>
        <Col xs={24} md={8}>{selectField('registrationStatus', { unknown: '未知', never_registered: '从未登记', registered: '已登记' })}</Col>
        <Col xs={24} md={8}>{textField('engineCc', { inputMode: 'numeric' })}</Col>
        <Col xs={24} md={8}>{textField('powerKw', { inputMode: 'decimal' })}</Col>
        <Col xs={24} md={8}>{textField('powerHp', { inputMode: 'decimal', hint: '仅填写资料直接给出的 hp。未知留空，不按 kW 换算。' })}</Col>
        <Col xs={24} md={8}>{selectField('transmission', { '': '未填写', manual: '手动', automatic: '自动', cvt: '无级变速', dct: '双离合', other: '其他', unknown: '未知' })}</Col>
        <Col xs={24} md={8}>{selectField('body', { '': '未填写', hatchback: '掀背', suv: 'SUV', sedan: '轿车', wagon: '旅行车', coupe: '轿跑', convertible: '敞篷', van: '厢式车', pickup: '皮卡', other: '其他', unknown: '未知' })}</Col>
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
        <Col xs={24} md={8}><Form.Item label="所在地国家" htmlFor="country" extra={isDemo ? '样例可留空，不推测所在地。' : '正式发布前核实。'} validateStatus={issues.some(issue => issue.key === 'country') ? 'error' : undefined} help={issues.some(issue => issue.key === 'country') ? '请选择实际所在地' : undefined}><Select id="country" aria-label="所在地国家" showSearch optionFilterProp="label" allowClear placeholder={isDemo ? "展示样例不填写所在地" : "选择国家"} disabled={locked || isDemo} value={form.country || undefined} options={countries.some(country => country.value === form.country) || !form.country ? countries : [...countries, { value: form.country, label: form.country }]} onChange={value => change('country', value ?? '')} /></Form.Item></Col>
      </Row>
    </Card>
  </div>;
  const configuration = <div className={styles.sectionStack} data-editor-section="configuration" tabIndex={-1}><VehicleConfigurationEditor value={form.configuration} onChange={value => change('configuration', value)} rows={configurationState.value?.items ?? null} errors={configurationState.errors} disabled={locked} requiredForPublish={!isDemo} /></div>;
  const commercial = <div className={styles.sectionStack} data-editor-section="commercial" tabIndex={-1}>
    <Card title="公开价格" extra={isDemo ? <Tag color="gold">样例不报价</Tag> : <Tag>公开字段</Tag>} className={styles.card}>
      {isDemo ? <Alert type="info" showIcon title="展示样例不填写价格" description="公开数据保持待询价，不把展示样例当成可购买库存。" /> : <><Typography.Paragraph type="secondary">{isExternal ? '来源参考价格不代表本店报价或成交承诺。保留原币种与价格范围，缺少价格时选择待询价。' : '默认公开报价。可先保存未完成草稿；正式发布前填写正数金额，并核对币种。'}</Typography.Paragraph><Row gutter={[24, 0]}>
        <Col xs={24} md={8}>{selectField('priceKind', isExternal ? { on_request: '待询价', reference: '来源参考价格' } : { on_request: '待询价', asking: '公开报价', reference: '参考价格' })}</Col>
        {form.priceKind !== 'on_request' && <><Col xs={24} md={8}>{textField('amount', { inputMode: 'decimal', hint: '最多两位小数，不使用千位分隔符。' })}</Col><Col xs={24} md={8}>{selectField('currency', currencyOptions)}</Col></>}
      </Row></>}
    </Card>
    <Card title="内部信息" extra={<Tag>仅员工可见</Tag>} className={styles.card}>
      <Typography.Paragraph type="secondary">采购成本、供应商联系方式和备注不会出现在公开车辆内容中。</Typography.Paragraph><Row gutter={[24, 0]}>
        <Col xs={24} md={12}>{textField('purchaseAmount', { inputMode: 'decimal' })}</Col><Col xs={24} md={12}>{selectField('purchaseCurrency', currencyOptions)}</Col>
        <Col xs={24} md={12}>{textField('supplierContact', { maxLength: 1000 })}</Col><Col xs={24} md={12}>{textField('vin', { maxLength: 17 })}</Col>
      </Row>
    </Card>
    <Card title="车况描述与内部备注" className={styles.card}>
      <Row gutter={[24, 0]}>
        <Col span={24}>{textField('description', { multiline: true, label: '车况描述', hint: '请使用中文描述车辆外观、内饰、维修及已知问题，将用于公开展示，发布时必填。' })}{form.descriptionLanguage.split('-')[0] !== 'zh' && <Alert showIcon type="warning" title="请先将历史车况描述整理为中文，再保存生成翻译" />}</Col>
        <Col span={24}>{textField('notes', { multiline: true, hint: '仅员工可见。' })}</Col>
      </Row>
    </Card>
  </div>;
  const images = <div data-editor-section="images" tabIndex={-1}>{externalSourceChanged && <Alert type="info" showIcon title="来源资料尚未保存" description="请先保存来源资料，再上传图片，以便逐图对应正确的原始挂牌。" className={styles.feedback} />}{record ? <VehicleMediaEditor source={record.draft.source} vehicleId={record.id} value={extras.media} savedMediaIds={base.media.map(media => media.id)} onChange={media => { setExtras(previous => ({ ...previous, media })); setSuccess(''); }} onBusyChange={setMediaBusy} disabled={saving || uncertain || actionsBusy || lifecycleBusy || translationBusy || localizationLocked || conflict || externalSourceChanged} /> : <Card className={styles.card}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先保存车辆草稿，再添加图片" /><Typography.Paragraph type="secondary" className={styles.center}>图片需要归属到已保存的车辆。你可以先保存已有信息，再继续录入。</Typography.Paragraph></Card>}</div>;
  const localization = <div className={styles.sectionStack} data-editor-section="localization" tabIndex={-1}>
    {record && localizationOpened ? <VehicleTranslationWorkspace key={record.id} vehicle={record} hasUnsavedChanges={coreDirty}
      disabled={saving || uncertain || mediaBusy || actionsBusy || lifecycleBusy || conflict} onGuardChange={localizationGuardChanged} onBusyChange={setTranslationBusy}
      canAdoptVehicle={vehicle => !!acceptedRecord.current && acceptedRecord.current.id === vehicle.id && !acceptedRecord.current.deletedAt && vehicle.version >= acceptedRecord.current.version}
      onVehicleUpdated={accept} onConflict={() => { setConflict(true); void loadRemote(); }} />
      : <Alert showIcon type="info" title="先保存中文资料，再生成英俄译文" description="标题在基础资料填写，车况描述在价格与内部信息填写，这里会直接引用已保存内容。" />}
  </div>;
  const review = <div className={styles.sectionStack} data-editor-section="review" tabIndex={-1}>
    {record && previewOpened && <PublicationPreviewPanel vehicleId={record.id} version={record.version} locale={previewLocale} onLocaleChange={setPreviewLocale} hasUnsavedChanges={dirty} disabled={saving || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || localizationLocked || conflict} onRendered={setPreviewReceipt} />}
    {record ? <VehicleActions publicationTabActive={activeTab === 'review'} publishTarget={publishTarget} previewLocale={previewLocale} previewReceipt={previewReceipt} onIssue={issue => { if (issue.stage === 'preview') { setPreviewOpened(true); setActiveTab('review'); } else focusIssue(issueForPath(issue.path)); }} vehicle={record} hasUnsavedChanges={dirty} disabled={saving || mediaBusy || lifecycleBusy || translationBusy || localizationLocked || conflict} onUpdated={acceptMutation} onConflict={() => { setConflict(true); void loadRemote(); }} onLocalizationIssue={() => { setLocalizationOpened(true);setActiveTab('localization'); }} onBusyChange={setActionsBusy} /> : <Alert type="info" showIcon title="先保存草稿，再完成发布" description="图片、多语和库存信息完善后，在这里检查预览并发布。" />}
  </div>;

  return <section className={styles.page}>
    <Breadcrumb items={[{ title: <Link to="/vehicles">车辆工作台</Link> }, { title: record?.stockCode ?? '新建车辆' }]} />
    <header className={styles.heading}><div><Typography.Text type="secondary">车辆资料</Typography.Text><h1>{id ? '编辑车辆草稿' : '新建车辆'}</h1><Typography.Paragraph type="secondary" className={styles.noMargin}>资料先存草稿，核对后单独发布。随时切换下方分组继续录入。</Typography.Paragraph></div><Space wrap><Tag color={isDemo ? 'gold' : isExternal ? 'blue' : undefined}>{isDemo ? '展示样例，非实际库存' : isExternal ? '外部来源资料，非自有库存' : sourceKind === 'manual' ? '真实车源录入' : '待选择类型'}</Tag>{record && <><Tag color={record.publicationState === 'published' ? 'green' : undefined}>{publicationLabels[record.publicationState]}</Tag><Tag>{isDemo ? '非实际库存' : isExternal ? '外部库存未知' : availabilityLabels[record.availability]}</Tag></>}<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/vehicles')}>返回车辆列表</Button><div ref={setPublishTarget}>{activeTab !== 'review' && <Button onClick={() => { setPreviewOpened(true); setActiveTab('review'); }}>进入发布预览</Button>}{!record && activeTab === 'review' && <Space orientation="vertical" size={4}><Button className={styles.publishIncomplete} disabled>请完善信息</Button><Button size="small" onClick={() => { setActiveTab("basics"); void message.info("可先保存草稿，再添加图片、完善多语并检查发布预览。"); }}>查看发布要求</Button></Space>}</div></Space></header>
    {record && <Card size="small" title="操作追溯" extra={<Button onClick={() => setHistoryOpen(true)}>操作记录</Button>}><ActivitySummary activity={record.activity} external={record.draft.source.kind === 'external'} /></Card>}
    <ActivityHistory target={historyOpen && record ? { kind: 'vehicle', id: record.id, label: record.stockCode } : null} onClose={() => setHistoryOpen(false)} />
    {record && <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} className={styles.metadata} items={[{ key: 'version', label: '草稿版本', children: record.version }, { key: 'updated', label: '最近修改', children: formatTime(record.updatedAt) }, { key: 'checked', label: '库存核验', children: isDemo ? '不适用（展示样例）' : isExternal ? '不适用（外部来源）' : formatTime(record.availabilityCheckedAt) }, ...(sourceReportUrl ? [{ key: 'report', label: '来源报告', children: <SourceReportLink url={sourceReportUrl} /> }] : [])]} />}
    {error && <Alert role="alert" type="error" showIcon title="草稿尚未保存" description={<><p>{error}</p>{issues.length > 0 && <Space wrap>{issues.map((issue, index) => <Button size="small" key={index} onClick={() => focusIssue(issue)}>{issue.label}：检查内容</Button>)}</Space>}</>} className={styles.feedback} />}
    {success && <Alert role="status" type="success" showIcon title={success} className={styles.feedback} />}
    {uncertain && <Alert type="warning" showIcon title="创建结果尚未确认" description="已保留这次创建的原请求，表单暂时锁定。重试会核对原结果，避免重复建车。" className={styles.feedback} />}
    {conflict && <Card title="车辆已被其他操作更新" className={styles.feedback}><Alert type="warning" showIcon title="当前输入已保留" description="请对照最新草稿。重新载入会明确放弃当前输入，不会覆盖服务端。" /><Space wrap className={styles.conflictActions}><Button onClick={() => void loadRemote()}>读取最新版本供比较</Button>{remote && <><Tag>服务端版本 {remote.version}</Tag><Button danger onClick={async () => { if (await confirm('放弃当前输入？', '重新载入会放弃当前未保存的输入，载入同事已保存的最新版本。', '放弃并载入最新草稿') && mounted.current) { accept(remote); setError(''); } }}>放弃当前输入，载入最新草稿</Button></>}</Space>{remote && (comparisonRows.length ? <Table size="small" rowKey="key" pagination={false} scroll={{ x: 600 }} dataSource={comparisonRows} columns={[{ title: '字段', dataIndex: 'label', width: 130 }, { title: '当前输入', dataIndex: 'local', render: value => <span className={styles.compareText}>{value}</span> }, { title: '服务端最新内容', dataIndex: 'remote', render: value => <span className={styles.compareText}>{value}</span> }]} /> : <Typography.Paragraph type="secondary">可编辑字段一致，版本、库存、图片或译文状态可能已经变化。</Typography.Paragraph>)}</Card>}
    <Form layout="vertical" onFinish={() => void save()} disabled={locked} requiredMark className={styles.form}>
      <Tabs activeKey={activeTab} onChange={key => { setActiveTab(key as TabKey);if (key === 'localization') setLocalizationOpened(true);if (key === 'review') setPreviewOpened(true); }} destroyOnHidden={false} className={styles.tabs} items={[
        { key: 'basics', label: <span><FileTextOutlined /> 基础资料</span>, children: basics, forceRender: true },
        { key: 'configuration', label: <span><UnorderedListOutlined /> 车辆配置</span>, children: configuration, forceRender: true },
        { key: 'commercial', label: <span><UnorderedListOutlined /> 价格与内部信息</span>, children: commercial, forceRender: true },
        { key: 'images', label: <span><CloudUploadOutlined /> 图片管理 <Tag bordered={false}>{extras.media.length}</Tag></span>, children: images, forceRender: true },
        { key: 'localization', label: <span><GlobalOutlined /> 公开字段多语</span>, children: localization, forceRender: true },
        { key: 'review', label: <span><CheckCircleOutlined /> 发布预览</span>, children: review, forceRender: true },
      ]} />
      {(activeTab !== 'localization' || coreDirty || !record) && <footer className={styles.saveBar}><div><Badge status={dirty ? 'warning' : 'success'} text={dirty ? '有未保存的输入' : record ? '已保存到草稿' : '填写后保存草稿'} /><Typography.Text type="secondary" className={styles.saveHint}>{configurationInvalid ? '车辆配置格式有误，请到车辆配置页按提示修正后保存' : localizationLocked ? '多语翻译有未处理的修改，请返回多语页面保存或放弃' : saving ? '正在保存，请稍候' : translationBusy ? '正在生成或核对机器译文' : lifecycleBusy ? '正在确认删除或恢复结果' : actionsBusy ? '正在确认发布或库存结果' : mediaBusy ? '正在处理图片' : '保存不会自动发布到公开页面'}</Typography.Text></div>{localizationLocked && activeTab !== 'localization' ? <Button onClick={() => { setLocalizationOpened(true); setActiveTab('localization'); }}>返回多语处理修改</Button>
        : (activeTab !== 'localization' || coreDirty || !record) && <Button type="primary" htmlType="submit" icon={dirty ? <SaveOutlined /> : <CheckCircleOutlined />} loading={saving} disabled={configurationInvalid || conflict || mediaBusy || actionsBusy || lifecycleBusy || translationBusy || localizationLocked || (!!id && !coreDirty)}>{uncertain ? '重试原创建请求' : activeTab === 'localization' && record ? '保存基础资料' : '保存草稿'}</Button>}</footer>}
    </Form>
    {record && <div className={styles.lifecyclePanel}>
      {dirty && <Alert type="info" showIcon title="先保存或处理当前修改，再移入回收站" className={styles.feedback} />}
      <VehicleDeletionActions vehicle={record} isDeleted={false} disabled={dirty || saving || mediaBusy || actionsBusy || translationBusy || localizationLocked || conflict} onBusyChange={setLifecycleBusy} onDeleted={acceptMutation} onRestored={acceptMutation} onConflict={() => { setConflict(true); void loadRemote(); }} />
    </div>}
    {leaveDialog}
    <Modal open={newIdentity !== null} title={newIdentity === 'make' ? '新增品牌' : '新增车型'} okText={newIdentity === 'make' ? '添加品牌' : '添加车型'} cancelText="取消" onOk={addIdentity} onCancel={() => setNewIdentity(null)}><Typography.Paragraph type="secondary">只需填写名称。保存车辆草稿后，该名称会加入相应品牌车型选项。</Typography.Paragraph><Form layout="vertical"><Form.Item label={newIdentity === 'make' ? '品牌名称' : '车型名称'} validateStatus={nameError ? 'error' : undefined} help={nameError || undefined}><Input aria-label={newIdentity === 'make' ? '品牌名称' : '车型名称'} autoFocus value={newName} onChange={event => { setNewName(event.target.value); setNameError(''); }} maxLength={120} onPressEnter={addIdentity} /></Form.Item></Form></Modal>
  </section>;
}
