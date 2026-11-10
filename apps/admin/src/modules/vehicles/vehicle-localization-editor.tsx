import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Col, Collapse, Form, Input, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { GlobalOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  DisplayTranslationSuggestionsResponseSchema, GenerateDisplayTranslationsSchema, getDisplayTextLimit,
  VehicleLocalizationResponseSchema, type AdminVehicle, type DisplayField, type Drivetrain, type LocalizationData, type VehicleLocalization,
} from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { readVehicleLifecycle } from '../../shared/api/vehicle-lifecycle';
import {
  applyDisplaySuggestions, assertLocalizationReadNotOlder, assertLocalizationSnapshot, changeDisplayLanguage, displayFieldLabel, displayLocaleLabels, displayLocales,
  displayReviewState, drivetrainLabels, editDisplayTranslation, localizationChanged, localizationComparison, localizationSaveRequest, LocalizationContextChanged, reviewDisplayTranslation,
} from './vehicle-localization-model';

export type LocalizationGuard = { dirty: boolean; busy: boolean; uncertain: boolean };
type Props = {
  vehicle: AdminVehicle; hasUnsavedChanges: boolean; disabled?: boolean;
  onGuardChange: (guard: LocalizationGuard) => void;
  canAdoptVehicle: (vehicle: AdminVehicle) => boolean;
  onVehicleUpdated: (vehicle: AdminVehicle) => void; onConflict: () => void;
};
type Session = {
  base: VehicleLocalization | null; data: LocalizationData | null; remote: VehicleLocalization | null;
  phase: 'idle' | 'loading' | 'saving' | 'generating'; uncertain: 'save' | 'generate' | null; conflict: boolean;
};
type Intent = { operation: 'save' | 'generate'; body: string; key: string; base: VehicleLocalization; refs: string[]; startedAt: number };
const emptySession: Session = { base: null, data: null, remote: null, phase: 'loading', uncertain: null, conflict: false };
const reviewLabels = { empty: '未填写', pending: '待审核', approved: '已审核', stale: '需重新审核' };
const kindLabels = { original: '原文', machine: '机器译文', human: '人工编辑' };

export function VehicleLocalizationEditor(props: Props) {
  const { modal, message } = App.useApp();
  const [session, setSession] = useState<Session>(emptySession);
  const sessionRef = useRef(session);const latest = useRef(props);latest.current = props;
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');const [notice, setNotice] = useState('');
  const mounted = useRef(false);const epoch = useRef(0);const running = useRef(false);
  const intent = useRef<Intent | null>(null);const generationId = useRef<string | null>(null);
  const path = `/api/v1/admin/vehicles/${encodeURIComponent(props.vehicle.id)}/localization`;
  const dirty = localizationChanged(session.base, session.data);
  const busy = session.phase !== 'idle';
  const staleBase = !!session.base && (session.base.vehicleId !== props.vehicle.id || session.base.vehicleVersion < props.vehicle.version);
  const locked = !!props.disabled || props.hasUnsavedChanges || busy || !!session.uncertain || session.conflict || staleBase;
  function update(patch: Partial<Session>) {
    const next = { ...sessionRef.current, ...patch };sessionRef.current = next;setSession(next);
    latest.current.onGuardChange({ dirty: localizationChanged(next.base, next.data), busy: next.phase !== 'idle', uncertain: !!next.uncertain || next.conflict });
  }
  function accept(value: VehicleLocalization) {
    generationId.current = value.data.facts.generation?.id ?? generationId.current;
    update({ base: value, data: structuredClone(value.data), remote: null, uncertain: null, conflict: false });
    setSelected([]);intent.current = null;
  }
  function current(token: number) { return mounted.current && epoch.current === token; }
  function assertFresh(fresh: { vehicle: AdminVehicle; localization: VehicleLocalization }) {
    assertLocalizationReadNotOlder(latest.current.vehicle, fresh.vehicle, fresh.localization, sessionRef.current.base);
    // The parent ref also sees an accepted save before React has rendered its newer props here.
    if (!latest.current.canAdoptVehicle(fresh.vehicle)) throw new LocalizationContextChanged('车辆已保存了更新版本，已忽略旧读取。请重新读取多语资料。');
  }
  async function readFresh(signal: AbortSignal) {
    const lifecycle = await readVehicleLifecycle(latest.current.vehicle.id, signal);
    if (lifecycle.isDeleted) throw new LocalizationContextChanged('车辆已移入回收站，当前多语输入已保留。');
    const localization = (await request(path, VehicleLocalizationResponseSchema, { signal })).data;
    if (localization.vehicleId !== lifecycle.vehicle.id || localization.vehicleVersion !== lifecycle.vehicle.version) throw new LocalizationContextChanged('读取期间车辆又发生变化，请重新核对最新版本。');
    const fresh = { vehicle: lifecycle.vehicle, localization };assertFresh(fresh);return fresh;
  }
  async function load() {
    if (running.current) return;
    const token = ++epoch.current;running.current = true;setError('');update({ phase: 'loading' });
    try {
      const fresh = await readFresh(AbortSignal.timeout(35_000));
      if (!current(token)) return;
      if (latest.current.hasUnsavedChanges) throw new LocalizationContextChanged('车辆有未保存输入，请先保存车辆资料，再读取对应多语资料。');
      assertFresh(fresh);
      accept(fresh.localization);
      latest.current.onVehicleUpdated(fresh.vehicle);
    } catch (failure) {
      if (current(token)) setError(failure instanceof Error ? failure.message : '多语资料读取失败，请重新读取。');
    } finally { if (current(token)) { running.current = false;update({ phase: 'idle' }); } }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false;epoch.current++;latest.current.onGuardChange({ dirty: false, busy: false, uncertain: false }); };
  }, []);
  useEffect(() => {
    if (sessionRef.current.base?.vehicleId === props.vehicle.id && sessionRef.current.base.vehicleVersion === props.vehicle.version) return;
    if (localizationChanged(sessionRef.current.base, sessionRef.current.data) || sessionRef.current.uncertain || running.current) return;
    void load();
    // The callback reads current props through refs; version changes trigger one fresh, guarded read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.vehicle.id, props.vehicle.version]);
  function changeData(data: LocalizationData) {
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || sessionRef.current.uncertain || sessionRef.current.conflict) return;
    update({ data });setError('');setNotice('');
  }
  function changeField(field: DisplayField) {
    const data = sessionRef.current.data;if (data) changeData({ ...data, fields: data.fields.map(item => item.ref === field.ref ? field : item) });
  }
  async function compareRemote() {
    const token = epoch.current;const base = sessionRef.current.base;
    try {
      const fresh = await readFresh(AbortSignal.timeout(35_000));
      if (current(token) && sessionRef.current.base === base) { assertFresh(fresh);update({ remote: fresh.localization }); }
    } catch { if (current(token) && sessionRef.current.base === base) setError('最新版本暂未读取成功，当前输入仍保留。请稍后重新比较。'); }
  }
  async function save(retry = false) {
    const state = sessionRef.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || !state.base || !state.data || state.base.vehicleVersion !== latest.current.vehicle.version || state.conflict || (!retry && state.uncertain)) return;
    if (!retry) {
      try {
        const body = JSON.stringify(localizationSaveRequest(state.base, state.data));
        intent.current = { operation: 'save', body, key: '', base: structuredClone(state.base), refs: [], startedAt: Date.now() };
      } catch { setError('请检查多语资料：展示文本最多500字，代系名称最多120字，空译文请保持未填写。');return; }
    }
    const attempt = intent.current;if (!attempt || attempt.operation !== 'save') return;
    const token = epoch.current;const wasUncertain = state.uncertain === 'save';let committed = false;
    running.current = true;setError('');setNotice('');update({ phase: 'saving' });
    try {
      const deadline = AbortSignal.timeout(35_000);
      const receipt = (await request(path, VehicleLocalizationResponseSchema, { method: 'PUT', body: attempt.body, signal: deadline })).data;
      committed = true;
      const fresh = await readFresh(deadline);
      if (!current(token)) return;
      assertFresh(fresh);
      if (fresh.localization.vehicleVersion !== receipt.vehicleVersion || fresh.localization.revision !== receipt.revision || JSON.stringify(fresh.localization.data) !== JSON.stringify(receipt.data)) throw new LocalizationContextChanged('保存已提交，但最新资料又发生变化。当前输入已保留，请比较服务端版本。');
      accept(fresh.localization);latest.current.onVehicleUpdated(fresh.vehicle);
      setNotice('多语展示资料已保存，尚未自动发布。代系对应字段已重新读取。');void message.success('多语展示资料已保存，请核对后单独发布。');
    } catch (failure) {
      if (!current(token)) return;
      const conflict = failure instanceof LocalizationContextChanged || failure instanceof ApiClientError && [404, 409].includes(failure.status);
      const uncertain = wasUncertain || committed || !(failure instanceof ApiClientError && [400, 401, 403, 404, 409, 413, 422].includes(failure.status));
      setError(failure instanceof Error ? failure.message : '保存结果未确认，输入与原请求已保留。');
      update({ conflict, uncertain: uncertain ? 'save' : null });
      if (!uncertain) intent.current = null;
      if (conflict) { latest.current.onConflict();await compareRemote(); }
      void message.warning(conflict ? '多语资料未覆盖新版本，当前输入已保留。' : '请核对多语保存结果，当前输入已保留。');
    } finally { if (current(token)) { running.current = false;update({ phase: 'idle' }); } }
  }
  async function generate(retry = false) {
    const state = sessionRef.current;
    if (running.current || latest.current.disabled || latest.current.hasUnsavedChanges || !state.base || !state.data || state.base.vehicleVersion !== latest.current.vehicle.version || localizationChanged(state.base, state.data) || state.conflict || (!retry && state.uncertain)) return;
    if (!retry) {
      try {
        const body = JSON.stringify(GenerateDisplayTranslationsSchema.parse({ vehicleVersion: state.base.vehicleVersion, revision: state.base.revision, refs: selected }));
        if (selected.some(ref => state.base!.data.fields.find(field => field.ref === ref)?.sourceLanguage.split('-')[0] !== 'zh')) throw new Error();
        intent.current = { operation: 'generate', body, key: crypto.randomUUID(), base: structuredClone(state.base), refs: [...selected], startedAt: Date.now() };
      } catch { setError('请选择1至10个已保存的中文来源字段。');return; }
    }
    const attempt = intent.current;if (!attempt || attempt.operation !== 'generate') return;
    if (Date.now() - attempt.startedAt >= 24 * 60 * 60 * 1000) { setError('原翻译请求已超过24小时，请结束本次生成并核对资料后重新选择。');return; }
    const token = epoch.current;const wasUncertain = state.uncertain === 'generate';let receiptAccepted = false;
    running.current = true;setError('');setNotice('');update({ phase: 'generating' });
    try {
      const deadline = AbortSignal.timeout(35_000);
      const suggestion = (await request(`${path}/translation-suggestions`, DisplayTranslationSuggestionsResponseSchema, { method: 'POST', body: attempt.body, headers: { 'Idempotency-Key': attempt.key }, signal: deadline })).data;
      receiptAccepted = true;const fresh = await readFresh(deadline);
      if (!current(token)) return;
      assertFresh(fresh);
      assertLocalizationSnapshot(attempt.base, fresh.localization);
      if (latest.current.hasUnsavedChanges || latest.current.vehicle.id !== attempt.base.vehicleId || latest.current.vehicle.version !== attempt.base.vehicleVersion || !sessionRef.current.data) throw new LocalizationContextChanged('当前车辆输入已变化，旧建议没有覆盖。');
      const result = applyDisplaySuggestions(fresh.localization, sessionRef.current.data, suggestion, attempt.refs);
      intent.current = null;update({ data: result.data, uncertain: null });
      const text = result.applied ? `已填入${result.applied}项待审核内容，请明确保存多语资料。已保留${result.protected}项人工或已审核内容。` : '已有人工或已审核内容已保留，没有覆盖当前译文。';
      setNotice(text);void message.success(text);
    } catch (failure) {
      if (!current(token)) return;
      const changed = failure instanceof LocalizationContextChanged;
      const definite = changed || failure instanceof ApiClientError && ([400, 401, 403, 404, 409, 413, 422, 429].includes(failure.status) || ['TRANSLATION_DISABLED', 'TRANSLATION_SOURCE_UNSUPPORTED', 'TRANSLATION_QUOTA_EXCEEDED'].includes(failure.code));
      const keep = !changed && (wasUncertain || receiptAccepted || !definite);
      setError(failure instanceof Error ? failure.message : '生成结果未确认，原请求已保留。');update({ uncertain: keep ? 'generate' : null });
      if (!keep) intent.current = null;
      if (changed || failure instanceof ApiClientError && [404, 409].includes(failure.status) && !keep) { update({ conflict: true });latest.current.onConflict();await compareRemote(); }
    } finally { if (current(token)) { running.current = false;update({ phase: 'idle' }); } }
  }
  function discard() {
    if (running.current) return;
    modal.confirm({ title: '放弃多语修改并重新读取？', content: '将放弃本页未保存的多语输入和原请求恢复入口。已在服务端完成的保存不会撤销。', okText: '放弃修改并重新读取', cancelText: '保留输入', okButtonProps: { danger: true }, onOk: () => {
      if (!mounted.current) return;
      epoch.current++;intent.current = null;update({ ...emptySession, phase: 'idle' });setNotice('');void load();
    } });
  }
  const data = session.data;const eligible = session.base?.data.fields.filter(field => field.sourceLanguage.split('-')[0] === 'zh') ?? [];
  const comparison = data && session.remote ? localizationComparison(data, session.remote.data, props.vehicle) : [];
  return <Form component={false} disabled={locked}><Space orientation="vertical" size="large" style={{ width: '100%', minWidth: 0 }}>
    <Alert showIcon type="info" title="公开字段多语资料独立保存" description="品牌、车型、配置、所在地、费用说明和图片说明分别对应已保存来源。未知保持未知；机器建议只填入本页，审核、保存与发布分别操作。" />
    {props.hasUnsavedChanges && <Alert showIcon type="warning" title="请先保存车辆资料，再编辑公开字段多语" />}
    {staleBase && <Alert showIcon type="warning" title="车辆版本已更新，请重新读取多语资料" description="旧多语读取未覆盖当前车辆。未保存输入仍保留；如需放弃，请使用下方的明确放弃操作。" action={<Button disabled={busy || dirty || !!session.uncertain || props.hasUnsavedChanges} onClick={() => void load()}>重新读取多语资料</Button>} />}
    {error && <Alert showIcon type="error" title={error} />}
    {notice && <Alert showIcon type="success" title={notice} />}
    {!data || !session.base ? <Card loading={session.phase === 'loading'}><Typography.Paragraph>多语资料尚未读取，未将其视为空数据。</Typography.Paragraph><Button icon={<ReloadOutlined />} disabled={busy || props.hasUnsavedChanges} onClick={() => void load()}>重新读取多语资料</Button></Card> : <>
      <Card title="代系与驱动形式">
        {session.base.revision === 0 && <Alert showIcon type="info" title="展示资料尚未初始化" description="可以先保存已知事实；未明确的来源语言保持未知。建立展示资料后，发布前需逐项核对非空字段的三语内容。" style={{ marginBottom: 12 }} />}
        <Typography.Paragraph type="secondary">仅填写已经确认的事实。新建或修改代系后，先保存，再读取它对应的多语字段；不从标题推测代系或驱动形式。</Typography.Paragraph>
        <Row gutter={[16, 0]}><Col xs={24} md={12}><Form.Item label="代系名称" htmlFor="localization-generation"><Input id="localization-generation" aria-label="代系名称" maxLength={120} value={data.facts.generation?.name ?? ''} disabled={locked} placeholder="未知留空" onChange={event => {
          const name = event.target.value;if (name.trim() && !generationId.current) generationId.current = `manual_${crypto.randomUUID().replaceAll('-', '')}`;
          changeData({ ...data, facts: { ...data.facts, generation: name.trim() ? { id: data.facts.generation?.id ?? generationId.current!, name } : null } });
        }} /></Form.Item></Col><Col xs={24} md={12}><Form.Item label="驱动形式" htmlFor="localization-drivetrain"><Select id="localization-drivetrain" aria-label="驱动形式" value={data.facts.drivetrain ?? ''} disabled={locked} options={[{ value: '', label: '未知 / 未填写' }, ...Object.entries(drivetrainLabels).map(([value, label]) => ({ value, label }))]} onChange={value => changeData({ ...data, facts: { ...data.facts, drivetrain: value ? value as Drivetrain : null } })} /></Form.Item></Col></Row>
      </Card>
      <Card title={<Space wrap><GlobalOutlined />展示字段机器建议</Space>}>
        <Typography.Paragraph type="secondary">仅对已保存且明确为中文的来源生成英俄。每次选择1至10项，人工或已审核译文保持。旧来源语言未明确时，请先逐项确认并保存。</Typography.Paragraph>
        <Space wrap style={{ marginBottom: 12 }}><Button disabled={locked || dirty || !eligible.length} onClick={() => setSelected(eligible.slice(0, 10).map(field => field.ref))}>选择前10个中文字段</Button><Button disabled={locked || !selected.length} onClick={() => setSelected([])}>清空选择</Button><Typography.Text>已选择 {selected.length} / 10 项</Typography.Text></Space>
        <Checkbox.Group aria-label="选择展示翻译字段" value={selected} disabled={locked || dirty} options={eligible.map(field => ({ value: field.ref, label: displayFieldLabel(field, data.fields, props.vehicle) }))} onChange={values => { if (values.length <= 10) setSelected(values);else void message.warning('每次最多选择10个展示字段。'); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }} />
        {dirty && <Alert showIcon type="info" title="请先保存多语修改，再生成新建议" style={{ marginBottom: 12 }} />}
        {session.uncertain === 'generate' ? <Space wrap><Button loading={session.phase === 'generating'} disabled={!!props.disabled || props.hasUnsavedChanges || busy} onClick={() => void generate(true)}>重试原展示翻译请求</Button><Button disabled={busy} onClick={() => { intent.current = null;update({ uncertain: null });setError('');setNotice('已结束本次生成，已保存的多语资料未更改。'); }}>结束本次展示生成</Button></Space> : <Button type="primary" icon={<GlobalOutlined />} loading={session.phase === 'generating'} disabled={locked || dirty || !selected.length} onClick={() => void generate()}>生成所选展示字段英俄译文</Button>}
      </Card>
      {!!session.base.retiredFieldCount && <Alert showIcon type="info" title={`另有${session.base.retiredFieldCount}项旧来源记录已失效保留，不会按图片排序或费用位置重新套用。`} />}
      <Collapse defaultActiveKey={data.fields[0] ? [data.fields[0].ref] : []} items={data.fields.map(field => {
        const saved = session.base!.data.fields.find(item => item.ref === field.ref)!;const label = displayFieldLabel(field, data.fields, props.vehicle);
        const sourceChanged = field.sourceLanguage !== saved.sourceLanguage;const approved = displayLocales.filter(locale => displayReviewState(field, saved, locale) === 'approved').length;
        const languageOptions = [{ value: 'und', label: '未明确，请选择' }, { value: 'zh', label: '中文' }, { value: 'en', label: '英文' }, { value: 'ru', label: '俄文' }];
        if (!languageOptions.some(option => option.value === field.sourceLanguage)) languageOptions.push({ value: field.sourceLanguage, label: field.sourceLanguage });
        return { key: field.ref, label: <Space wrap>{label}<Tag>{approved} / 3 已审核</Tag></Space>, children: <Space orientation="vertical" style={{ width: '100%' }}>
          <Form.Item label={`${label}原文`}><Input.TextArea aria-label={`${label}原文`} readOnly value={field.sourceText} autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
          <Form.Item label={`${label}来源语言`}><Select aria-label={`${label}来源语言`} value={field.sourceLanguage} options={languageOptions} disabled={locked} onChange={value => changeField(changeDisplayLanguage(field, value))} style={{ width: '100%' }} /></Form.Item>
          {sourceChanged && <Alert showIcon type="warning" title="来源语言已修改，请先保存，再审核对应新版本译文" />}
          <Row gutter={[16, 16]} style={{ width: '100%', margin: 0 }}>{displayLocales.map(locale => {
            const value = field.translations[locale];const state = displayReviewState(field, saved, locale);const limit = getDisplayTextLimit(field.ref);
            return <Col xs={24} lg={8} key={locale}><Card size="small" title={displayLocaleLabels[locale]} extra={<Tag color={state === 'approved' ? 'success' : state === 'stale' ? 'warning' : 'default'}>{reviewLabels[state]}</Tag>}>
              <Form.Item label={`${displayLocaleLabels[locale]}${label}`} extra={(value?.text.length ?? 0) > limit ? `已超过${limit}字上限，请核对内容；不会自动截断。` : `最多${limit}字，还可输入${limit - (value?.text.length ?? 0)}字`}><Input.TextArea aria-label={`${displayLocaleLabels[locale]}${label}`} maxLength={limit} autoSize={{ minRows: 2, maxRows: 6 }} value={value?.text ?? ''} disabled={locked} onChange={event => changeField(editDisplayTranslation(field, saved, locale, event.target.value))} /></Form.Item>
              <Typography.Paragraph type="secondary">{value ? `${kindLabels[value.kind]} · 对应原文 v${value.sourceVersion}` : '未填写'} · 当前原文 v{field.sourceVersion}</Typography.Paragraph>
              {locale === field.sourceLanguage.split('-')[0] && <Button type="link" disabled={locked} onClick={() => changeField(editDisplayTranslation(field, saved, locale, field.sourceText))}>{displayLocaleLabels[locale]}{label}使用原文</Button>}
              <Checkbox checked={state === 'approved'} disabled={locked || sourceChanged || field.sourceLanguage.split('-')[0] === 'und' || !value?.text.trim()} onChange={event => changeField(reviewDisplayTranslation(field, saved, locale, event.target.checked))}>{displayLocaleLabels[locale]}{label}已审核</Checkbox>
            </Card></Col>;
          })}</Row>
        </Space> };
      })} />
      {session.conflict && <Alert showIcon type="warning" title="多语资料版本冲突，当前输入已保留" description={`本地车辆版本 ${session.base.vehicleVersion} / 多语修订 ${session.base.revision}${session.remote ? `；服务端车辆版本 ${session.remote.vehicleVersion} / 多语修订 ${session.remote.revision}` : ''}`} action={<Button disabled={busy} onClick={() => void compareRemote()}>比较最新多语资料</Button>} />}
      {session.remote && <Table size="small" pagination={false} rowKey="key" dataSource={comparison} columns={[{ dataIndex: 'label', title: '字段' }, { dataIndex: 'local', title: '当前输入' }, { dataIndex: 'remote', title: '服务端最新' }]} scroll={{ x: 520 }} />}
      {session.uncertain === 'save' && <Alert showIcon type="warning" title="多语保存结果尚未确认" description="原请求和版本已保留。重试不会提升版本覆盖新资料；也可比较服务端结果后明确放弃本地输入。" />}
      <Space wrap><Button type="primary" icon={<SaveOutlined />} loading={session.phase === 'saving'} disabled={!!props.disabled || props.hasUnsavedChanges || busy || session.conflict || staleBase || (!session.uncertain && !dirty && session.base.revision !== 0) || session.uncertain === 'generate'} onClick={() => void save(session.uncertain === 'save')}>{session.uncertain === 'save' ? '重试原多语保存请求' : '保存多语展示资料'}</Button><Button icon={<ReloadOutlined />} disabled={busy} onClick={discard}>放弃修改并重新读取多语资料</Button></Space>
    </>}
  </Space></Form>;
}
