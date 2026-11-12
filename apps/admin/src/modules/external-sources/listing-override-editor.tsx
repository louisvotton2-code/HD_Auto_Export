import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Space, Typography } from 'antd';
import {
  ExternalFactsSchema, ExternalListingResponseSchema, ExternalOverrideResponseSchema, SaveExternalOverridesSchema,
  type ExternalListing, type ExternalTrialField, type Locale,
} from '@hd/contracts/admin';
import { ActionFeedback } from './action-feedback';
import { externalRoot, fieldLabels, languageLabels } from './external-labels';
import { FactOverrideInput, formatExternalFact, type FactField } from './fact-override-input';
import { useExternalAction } from './use-external-action';
import { useExternalGuard } from './external-workspace';
import { request } from '../../shared/api/client';
import styles from './listing-override-editor.module.css';

const factGroups: { label: string; fields: FactField[] }[] = [
  { label: '车辆识别', fields: ['make', 'model', 'trim', 'generation', 'modelYear', 'body'] },
  { label: '车况和登记', fields: ['mileageKm', 'manufacturedAt', 'firstRegistration', 'registrationStatus', 'location'] },
  { label: '动力和传动', fields: ['powertrain', 'engineCc', 'powerKw', 'transmission', 'drivetrain'] },
];
const textFields = ['title', 'model', 'description'] as const;
const locales: Locale[] = ['zh', 'en', 'ru'];

function factValue(facts: Record<string, unknown>, source: ExternalListing['source'], field: FactField) {
  return Object.hasOwn(facts, field) ? facts[field] : source?.facts[field];
}
function factStatus(facts: Record<string, unknown>, field: FactField) {
  return Object.hasOwn(facts, field) ? facts[field] === null ? '人工修订为未知' : '人工修订' : '跟随来源';
}
function comparisonFact(facts: Record<string, unknown>, source: ExternalListing['source'], field: FactField) {
  const value = factValue(facts, source, field);
  let display = formatExternalFact(field, value);
  if (value && typeof value === 'object') {
    if ('id' in value) display += `（编号：${String(value.id)}）`;
    if ('precision' in value) display += `（${{ year: '年', month: '年月', day: '年月日' }[value.precision as 'year' | 'month' | 'day']}）`;
    if ('country' in value) {
      const location = value as { country: string; city: string | null; displayName: string | null };
      display = [location.country, location.city, location.displayName].filter(Boolean).join(' · ');
    }
  }
  return `${factStatus(facts, field)} · ${display}`;
}
function comparisonText(items: ExternalListing['overrides']['text'], hashes: ExternalListing['sourceHashes'], field: ExternalTrialField, locale: Locale) {
  const item = items.find(value => value.field === field && value.locale === locale);
  return item ? `${item.text}${item.sourceHash !== hashes[field] ? '（原文已变化，待核对）' : ''}` : '未设人工文案，跟随自动展示';
}

export function ListingOverrideEditor({ listing, initialLocale, onClose, onRefresh }: {
  listing: ExternalListing; initialLocale: Locale; onClose: () => void; onRefresh: () => void;
}) {
  const action = useExternalAction('PUT', ExternalOverrideResponseSchema);
  const { modal, message } = App.useApp();
  const [facts, setFacts] = useState<Record<string, unknown>>({ ...listing.overrides.facts });
  const [text, setText] = useState(listing.overrides.text);
  const [hidden, setHidden] = useState(listing.overrides.hidden);
  const [invalid, setInvalid] = useState('');
  const [latest, setLatest] = useState<ExternalListing>();
  const [checking, setChecking] = useState(false);
  const [opened, setOpened] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const modelWarning = useRef<HTMLDivElement>(null);
  const locked = action.busy || action.uncertain;
  const editorDisabled = locked || !opened;
  const conflict = action.errorCode === 'VERSION_CONFLICT';
  const dirty = JSON.stringify({ hidden, facts, text }) !== JSON.stringify(listing.overrides);
  const modelBindingChanged = (['make', 'model'] as const).some(key => JSON.stringify(facts[key]) !== JSON.stringify(listing.overrides.facts[key]));
  const changedModelText = text.some(item => item.field === 'model' && !listing.overrides.text.some(saved =>
    saved.field === item.field && saved.locale === item.locale && saved.sourceHash === item.sourceHash && saved.text === item.text));
  const splitModelEdit = modelBindingChanged && changedModelText;
  const orderedLocales = [initialLocale, ...locales.filter(locale => locale !== initialLocale)];
  useExternalGuard(dirty);
  useEffect(() => { if (action.error) feedback.current?.scrollIntoView({ block: 'center' }); }, [action.error]);
  useEffect(() => { if (splitModelEdit) modelWarning.current?.scrollIntoView({ block: 'center' }); }, [splitModelEdit]);

  async function submit(retry = false) {
    if (!retry && (conflict || splitModelEdit || editorDisabled)) return;
    const parsed = SaveExternalOverridesSchema.safeParse({ version: listing.version, overrides: { hidden, facts, text } });
    if (!retry && !parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue.path.map(String);
      const entry = path[1] === 'text' ? text[Number(path[2])] : undefined;
      const label = path[1] === 'facts' ? fieldLabels[path[2]] : entry ? `${fieldLabels[entry.field]} · ${languageLabels[entry.locale]}` : '文案';
      setInvalid(`${label ?? '修订'}内容格式有误，请核对后提交。`);
      document.getElementById(path[1] === 'facts' ? `override-fact-${path[2]}` : entry ? `override-text-${entry.field}-${entry.locale}` : '')?.scrollIntoView({ block: 'center' });
      return;
    }
    setInvalid('');
    const response = await action.execute(retry ? undefined : {
      path: `${externalRoot}/listings/${encodeURIComponent(listing.id)}/overrides`, body: JSON.stringify(parsed.data),
      matches: ({ data }) => data.id === listing.id && data.version >= listing.version,
    });
    if (response) {
      void message.success('已保存人工修订');
      onRefresh();
    }
  }
  async function compare() {
    setChecking(true);
    setInvalid('');
    try {
      const { data } = await request(`${externalRoot}/listings/${encodeURIComponent(listing.id)}?locale=zh`, ExternalListingResponseSchema, { signal: AbortSignal.timeout(15_000) });
      if (data.id !== listing.id || data.version < listing.version) throw new Error('服务返回的挂牌版本不符。');
      setLatest(data);
    } catch (failure) {
      setInvalid(failure instanceof Error ? failure.message : '无法读取当前版本。');
    } finally { setChecking(false); }
  }
  async function discard(refresh = false) {
    if ((dirty || action.uncertain) && !await modal.confirm({
      title: refresh ? '放弃当前输入并核对服务端？' : '放弃当前输入？',
      okText: '确认放弃', cancelText: '继续编辑',
    })) return;
    if (refresh) onRefresh();
    else onClose();
  }
  function removeFact(field: FactField) {
    setFacts(current => { const next = { ...current }; delete next[field]; return next; });
  }
  function changeText(field: ExternalTrialField, locale: Locale, value: string) {
    const sourceHash = listing.sourceHashes[field];
    if (!sourceHash) return;
    setText(items => {
      const next = items.filter(item => item.field !== field || item.locale !== locale);
      return value ? [...next, { field, locale, sourceHash, text: value }] : next;
    });
  }

  return <Modal open afterOpenChange={setOpened} width={1180} title="人工修订挂牌" okText="保存修订" cancelText="取消"
    styles={{ body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto', paddingInlineEnd: 4 } }}
    style={{ top: 24 }} closable={!locked} keyboard={!locked} mask={{ closable: false }} confirmLoading={action.busy}
    okButtonProps={{ disabled: editorDisabled || !dirty || conflict || splitModelEdit }} cancelButtonProps={{ disabled: locked }}
    onCancel={() => { if (!locked) void discard(); }} onOk={() => void submit()}>
    <Form layout="vertical" disabled={editorDisabled}>
      <div className={styles.header}>
        <div>
          <Typography.Text strong>{listing.vehicle?.content.title.text ?? listing.source?.copy.title?.original.text ?? listing.id}</Typography.Text>
          <div><Typography.Text type="secondary">管理版本 {listing.version} · 来源版本 {listing.sourceRevision}</Typography.Text></div>
        </div>
        <Checkbox checked={hidden} disabled={editorDisabled || listing.state === 'withdrawn'} onChange={event => setHidden(event.target.checked)}>从公开目录隐藏</Checkbox>
      </div>
      <p className={styles.help}>直接修改需要更正的内容，最后统一保存。未修改的事实继续跟随来源；“修订为未知”会保留人工清空，“恢复跟随来源”会移除人工修订。</p>
      {factGroups.map(group => <section key={group.label} className={styles.section} aria-label={group.label}>
        <Typography.Title level={5}>{group.label}</Typography.Title>
        <div className={styles.factGrid}>{group.fields.map(field => {
          const present = Object.hasOwn(facts, field);
          return <section key={field} id={`override-fact-${field}`} aria-label={`${fieldLabels[field]}人工修订`} className={styles.fact}>
            <div className={styles.fieldHeader}><Typography.Text strong>{fieldLabels[field]}</Typography.Text><span className={present ? styles.manual : styles.follow}>{factStatus(facts, field)}</span></div>
            <FactOverrideInput field={field} value={factValue(facts, listing.source, field)} disabled={editorDisabled}
              onChange={value => setFacts(current => ({ ...current, [field]: value }))} />
            <div className={styles.source}>来源值 · {formatExternalFact(field, listing.source?.facts[field])}</div>
            <Space wrap size={4}>
              {ExternalFactsSchema.shape[field].safeParse(null).success && <Button size="small" disabled={editorDisabled || present && facts[field] === null} onClick={() => setFacts(current => ({ ...current, [field]: null }))}>修订为未知</Button>}
              <Button size="small" disabled={editorDisabled || !present} onClick={() => removeFact(field)}>恢复跟随来源</Button>
            </Space>
          </section>;
        })}</div>
      </section>)}
      <section className={styles.section} aria-label="公开文案">
        <Typography.Title level={5}>公开文案 · 中英俄</Typography.Title>
        <p className={styles.help}>直接填写人工文案可替代自动展示；清空或移除该语言的人工文案后恢复自动展示。未填写的语言不会自动复制其他语言。</p>
        {textFields.map(field => <section key={field} className={styles.copyGroup} aria-label={`${fieldLabels[field]}三语文案`}>
          <Typography.Title level={5}>{fieldLabels[field]}</Typography.Title>
          <div className={styles.original}><strong>来源原文</strong><div>{listing.source?.copy[field]?.original.text ?? '来源未提供原文'}</div></div>
          {field === 'model' && modelBindingChanged && <Alert type="warning" title="请先保存品牌或车型事实，再核对当前车型原文。" />}
          <div className={styles.textGrid}>{orderedLocales.map(locale => {
            const currentText = text.find(item => item.field === field && item.locale === locale);
            const sourceHash = listing.sourceHashes[field];
            const label = `${fieldLabels[field]} · ${languageLabels[locale]}人工文案`;
            return <section key={locale} id={`override-text-${field}-${locale}`} className={styles.translation} aria-label={label}>
              <label htmlFor={`override-input-${field}-${locale}`} className={styles.textLabel}>{languageLabels[locale]}</label>
              {currentText && currentText.sourceHash !== sourceHash && <Alert type="warning" title="原文已变化，请核对后重新填写文案。" />}
              <Input.TextArea id={`override-input-${field}-${locale}`} aria-label={label} value={currentText?.text ?? ''}
                disabled={!sourceHash || editorDisabled || field === 'model' && modelBindingChanged}
                placeholder={sourceHash ? '未设人工文案，当前跟随自动展示' : '缺少来源原文，暂不能新增人工文案'}
                showCount maxLength={{ title: 500, model: 120, description: 2000 }[field]} rows={field === 'description' ? 4 : 2}
                onChange={event => changeText(field, locale, event.target.value)} />
              <div className={styles.source}>供应商译文 · {listing.source?.copy[field]?.translations[locale]?.text ?? '未提供'}</div>
              {currentText && <Button type="link" size="small" disabled={editorDisabled} onClick={() => setText(items => items.filter(item => item.field !== field || item.locale !== locale))}>移除此语言的人工文案</Button>}
            </section>;
          })}</div>
        </section>)}
      </section>
    </Form>
    {splitModelEdit && <div ref={modelWarning}><Alert type="warning" showIcon title="本次品牌或车型事实修改会改变车型译文的来源绑定。"
      description={<Space wrap><span>可撤销事实修改，或保留已保存的车型译文后先提交事实。</span>
        <Button disabled={locked} onClick={() => setText(items => [
          ...items.filter(item => item.field !== 'model'), ...listing.overrides.text.filter(item => item.field === 'model'),
        ])}>保留已保存的车型译文</Button>
      </Space>} /></div>}
    {invalid && <Alert type="error" title={invalid} />}
    <div ref={feedback}><ActionFeedback {...action} retry={() => void submit(true)} reconcile={() => void discard(true)} /></div>
    {conflict && !action.uncertain && <section className={styles.section} aria-label="版本冲突核对">
      <p>当前输入已保留。读取最新版本后，可逐项核对所有事实和三语文案；不会自动覆盖当前输入。</p>
      <Button loading={checking} onClick={() => void compare()}>核对最新版本</Button>
      {latest && <>
        <Alert type="warning" title={`当前版本 ${latest.version}，本次编辑基于版本 ${listing.version}`} />
        <div className={styles.comparisonScroll} tabIndex={0} role="region" aria-label="全部修订对比，可横向滚动"><table className={styles.comparison}>
          <thead><tr><th>字段</th><th>当前输入</th><th>服务端最新内容</th></tr></thead>
          <tbody>
            <tr><th scope="row">从公开目录隐藏</th><td>{hidden ? '是' : '否'}</td><td>{latest.overrides.hidden ? '是' : '否'}</td></tr>
            {factGroups.flatMap(group => group.fields).map(field => <tr key={field}><th scope="row">{fieldLabels[field]}</th><td>{comparisonFact(facts, listing.source, field)}</td><td>{comparisonFact(latest.overrides.facts, latest.source, field)}</td></tr>)}
            {textFields.flatMap(field => locales.map(locale => <tr key={`${field}:${locale}`}><th scope="row">{fieldLabels[field]} · {languageLabels[locale]}</th><td>{comparisonText(text, listing.sourceHashes, field, locale)}</td><td>{comparisonText(latest.overrides.text, latest.sourceHashes, field, locale)}</td></tr>))}
          </tbody>
        </table></div>
        <Button onClick={() => void discard(true)}>放弃输入并重新读取挂牌</Button>
      </>}
    </section>}
  </Modal>;
}
