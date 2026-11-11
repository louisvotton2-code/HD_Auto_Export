import { useState } from 'react';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Space, Typography } from 'antd';
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
import styles from './external-sources.module.css';

const factGroups: { label: string; fields: FactField[] }[] = [
  { label: '车辆识别', fields: ['make', 'model', 'trim', 'generation', 'modelYear', 'body'] },
  { label: '车况和登记', fields: ['mileageKm', 'manufacturedAt', 'firstRegistration', 'registrationStatus', 'location'] },
  { label: '动力和传动', fields: ['powertrain', 'engineCc', 'powerKw', 'transmission', 'drivetrain'] },
];
const factOptions = factGroups.map(group => ({
  label: group.label, options: group.fields.map(value => ({ value, label: fieldLabels[value] })),
}));
const textFields = ['title', 'model', 'description'] as const;
const fieldPopupContainer = (trigger: HTMLElement) => trigger.parentElement ?? trigger;

export function ListingOverrideEditor({ listing, initialLocale, onClose, onRefresh }: {
  listing: ExternalListing; initialLocale: Locale; onClose: () => void; onRefresh: () => void;
}) {
  const action = useExternalAction('PUT', ExternalOverrideResponseSchema);
  const { modal, message } = App.useApp();
  const [facts, setFacts] = useState<Record<string, unknown>>({ ...listing.overrides.facts });
  const [text, setText] = useState(listing.overrides.text);
  const [hidden, setHidden] = useState(listing.overrides.hidden);
  const [fact, setFact] = useState<FactField>('modelYear');
  const [field, setField] = useState<ExternalTrialField>('title');
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [invalid, setInvalid] = useState('');
  const [latest, setLatest] = useState<ExternalListing>();
  const [checking, setChecking] = useState(false);
  const [opened, setOpened] = useState(false);
  const present = Object.hasOwn(facts, fact);
  const currentText = text.find(item => item.field === field && item.locale === locale);
  const sourceHash = listing.sourceHashes[field];
  const locked = action.busy || action.uncertain;
  const editorDisabled = locked || !opened;
  const conflict = action.errorCode === 'VERSION_CONFLICT';
  const dirty = JSON.stringify({ hidden, facts, text }) !== JSON.stringify(listing.overrides);
  const modelBindingChanged = (['make', 'model'] as const).some(key => JSON.stringify(facts[key]) !== JSON.stringify(listing.overrides.facts[key]));
  const changedModelText = text.some(item => item.field === 'model' && !listing.overrides.text.some(saved =>
    saved.field === item.field && saved.locale === item.locale && saved.sourceHash === item.sourceHash && saved.text === item.text));
  const splitModelEdit = modelBindingChanged && changedModelText;
  useExternalGuard(dirty);

  async function submit(retry = false) {
    if (!retry && (conflict || splitModelEdit)) return;
    const parsed = SaveExternalOverridesSchema.safeParse({ version: listing.version, overrides: { hidden, facts, text } });
    if (!retry && !parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue.path.map(String);
      const label = path[1] === 'facts' ? fieldLabels[path[2]] : '译文';
      setInvalid(`${label ?? '修订'}内容格式有误，请核对后提交。`);
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
  function removeFact() {
    const next = { ...facts };
    delete next[fact];
    setFacts(next);
  }
  function changeText(value: string) {
    if (!sourceHash) return;
    const next = text.filter(item => item.field !== field || item.locale !== locale);
    setText(value ? [...next, { field, locale, sourceHash, text: value }] : next);
  }

  return <Modal open afterOpenChange={setOpened} width={940} title="人工修订挂牌" okText="保存修订" cancelText="取消"
    closable={!locked} keyboard={!locked} mask={{ closable: false }} confirmLoading={action.busy}
    okButtonProps={{ disabled: editorDisabled || !dirty || conflict || splitModelEdit }} cancelButtonProps={{ disabled: locked }}
    onCancel={() => { if (!locked) void discard(); }} onOk={() => void submit()}>
    <Form layout="vertical" disabled={editorDisabled}>
      <div className={styles.editHeader}>
        <div>
          <Typography.Text strong>{listing.vehicle?.content.title.text ?? listing.source?.copy.title?.original.text ?? listing.id}</Typography.Text>
          <div><Typography.Text type="secondary">管理版本 {listing.version} · 来源版本 {listing.sourceRevision}</Typography.Text></div>
        </div>
        <Checkbox checked={hidden} disabled={listing.state === 'withdrawn'} onChange={event => setHidden(event.target.checked)}>从公开目录隐藏</Checkbox>
      </div>
      <div className={styles.editGrid}>
        <section className={styles.editSection}>
          <Typography.Title level={5}>车辆事实</Typography.Title>
          <Form.Item label="事实字段">
            <Select aria-label="事实字段" virtual={false} getPopupContainer={fieldPopupContainer} value={fact} onChange={setFact}
              showSearch={{ optionFilterProp: 'label' }} options={factOptions} />
          </Form.Item>
          <Form.Item label={`人工修订 · ${fieldLabels[fact]}`}>
            <Space orientation="vertical" align="start">
              <Typography.Text type="secondary" className={styles.sourceValue}>来源值 · {formatExternalFact(fact, listing.source?.facts[fact])}</Typography.Text>
              <FactOverrideInput field={fact} value={present ? facts[fact] : listing.source?.facts[fact]} onChange={value => setFacts(current => ({ ...current, [fact]: value }))} />
              <Space wrap>
                {ExternalFactsSchema.shape[fact].safeParse(null).success && <Button onClick={() => setFacts(current => ({ ...current, [fact]: null }))}>修订为未知</Button>}
                <Button disabled={!present} onClick={removeFact}>恢复跟随来源</Button>
              </Space>
              <Typography.Text type="secondary">{present ? '已设置人工修订' : '当前跟随来源'}</Typography.Text>
            </Space>
          </Form.Item>
        </section>
        <section className={styles.editSection}>
          <Typography.Title level={5}>公开文案</Typography.Title>
          <Form.Item label="字段和语言">
            <Space wrap>
              <Select aria-label="译文修订字段" virtual={false} getPopupContainer={fieldPopupContainer} value={field} onChange={setField}
                options={textFields.map(value => ({ value, label: fieldLabels[value] }))} />
              <Select aria-label="译文修订语言" value={locale} onChange={setLocale}
                options={Object.entries(languageLabels).map(([value, label]) => ({ value, label }))} />
            </Space>
          </Form.Item>
          <Form.Item label="人工译文">
            {currentText && currentText.sourceHash !== sourceHash && <Alert type="warning" title="原文已变化，请核对后重新填写译文。" />}
            <div className={styles.sourceValue}>
              <Typography.Text type="secondary">来源原文</Typography.Text>
              <div>{listing.source?.copy[field]?.original.text ?? '来源未提供原文'}</div>
              {listing.source?.copy[field]?.translations[locale] && <div>供应商译文 · {listing.source.copy[field]?.translations[locale]?.text}</div>}
            </div>
            {field === 'model' && modelBindingChanged && <Alert type="warning" title="请先保存品牌或车型事实，再核对当前车型原文。" />}
            <Input.TextArea aria-label="人工译文" value={currentText?.text ?? ''} disabled={!sourceHash || editorDisabled || (field === 'model' && modelBindingChanged)}
              showCount maxLength={{ title: 500, model: 120, description: 2000 }[field]} onChange={event => changeText(event.target.value)} rows={3} />
            {currentText && <Button type="link" onClick={() => setText(items => items.filter(item => item.field !== field || item.locale !== locale))}>移除此语言的人工译文</Button>}
          </Form.Item>
        </section>
      </div>
    </Form>
    {splitModelEdit && <Alert type="warning" showIcon title="本次品牌或车型事实修改会改变车型译文的来源绑定。"
      description={<Space wrap><span>可撤销事实修改，或保留已保存的车型译文后先提交事实。</span>
        <Button disabled={locked} onClick={() => setText(items => [
          ...items.filter(item => item.field !== 'model'), ...listing.overrides.text.filter(item => item.field === 'model'),
        ])}>保留已保存的车型译文</Button>
      </Space>} />}
    {invalid && <Alert type="error" title={invalid} />}
    <ActionFeedback {...action} retry={() => void submit(true)} reconcile={() => void discard(true)} />
    {conflict && !action.uncertain && <Space orientation="vertical" align="start">
      <Button loading={checking} onClick={() => void compare()}>核对最新版本</Button>
      {latest && <Alert type="warning" title={`当前版本 ${latest.version}，本次编辑基于版本 ${listing.version}`}
        description={<div>
          <p>当前{fieldLabels[fact]}：{formatExternalFact(fact, Object.hasOwn(latest.overrides.facts, fact) ? latest.overrides.facts[fact] : latest.source?.facts[fact])}</p>
          <p>当前人工译文：{latest.overrides.text.find(item => item.field === field && item.locale === locale)?.text ?? '暂无'}</p>
        </div>} />}
      {latest && <Button onClick={() => void discard(true)}>放弃输入并重新读取挂牌</Button>}
    </Space>}
  </Modal>;
}
