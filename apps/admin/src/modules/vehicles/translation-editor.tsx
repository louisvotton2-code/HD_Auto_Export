import type { TranslatableField } from '@hd/contracts/admin';
import { useRef } from 'react';
import { Alert, App, Button, Card, Checkbox, Form, Input, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleFilled, CopyOutlined, DeleteOutlined, GlobalOutlined, InfoCircleOutlined } from '@ant-design/icons';
import {
  approveTranslation, editTranslation, translationLocaleLabels, translationLocales,
  translationReviewState, translationSource,
} from './translation-model';
import styles from './translation-editor.module.css';

type Props = {
  name: 'title' | 'description';
  value: TranslatableField;
  sourceText: string;
  sourceLanguage: string;
  onChange: (value: TranslatableField) => void;
  disabled?: boolean;
  requiredForPublish?: boolean;
};
const reviewLabels = { empty: '未填写', pending: '待审核', approved: '已审核', stale: '需重新审核' };
const kindLabels = { original: '原文', machine: '机器译文', human: '人工编辑' };
const languageCodes = { zh: 'ZH', en: 'EN', ru: 'RU' };

export function TranslationEditor({ name, value, sourceText, sourceLanguage, onChange, disabled = false, requiredForPublish = false }: Props) {
  const { modal } = App.useApp();
  const revisions = useRef({ zh: 0, en: 0, ru: 0 });
  for (const locale of translationLocales) {
    const translation = value.translations[locale];
    if (translation) revisions.current[locale] = translation.humanEditVersion;
  }
  const fieldName = name === 'title' ? '标题' : '描述';
  const source = translationSource(value, sourceText, sourceLanguage);
  const headingId = `${name}-translations-heading`;
  const hasTranslations = translationLocales.some(locale => value.translations[locale] !== null);
  const reviewedCount = translationLocales.filter(locale => translationReviewState(value, locale, sourceText, sourceLanguage) === 'approved').length;
  return <section className={styles.editor} aria-labelledby={headingId}>
    <div className={styles.heading}>
      <Space wrap><Typography.Title level={4} id={headingId} style={{ margin: 0 }}><GlobalOutlined /> {fieldName}三语审核</Typography.Title><Tag color={reviewedCount === 3 ? 'success' : 'default'}>{reviewedCount} / 3 已审核</Tag></Space>
      <Tooltip title="原文修改后需先保存，再对新版本逐语审核；修改译文会撤销该语种审核。"><Typography.Text type="secondary">原文版本 {value.sourceVersion} <InfoCircleOutlined /></Typography.Text></Tooltip>
    </div>
    <Typography.Paragraph type="secondary">核对每种语言的内容后，勾选“已审核”。审核完成还需要保存草稿，再单独发布。</Typography.Paragraph>
    {source.changed && <Alert className={styles.sourceAlert} showIcon type="warning" title={`${fieldName}原文有未保存的修改。请先保存草稿，再审核三语内容。`} />}
    {name === 'description' && !source.text && !requiredForPublish && <Alert className={styles.sourceAlert} showIcon type="info" title="描述可以留空" description="如果不展示描述，请将原文和三语描述都清空后保存。" action={hasTranslations ? <Button size="small" icon={<DeleteOutlined />} disabled={disabled} onClick={() => modal.confirm({ title: '清空三语描述？', content: '这会移除当前草稿的中英俄描述，保存后才会生效。', okText: '清空描述', cancelText: '保留内容', okButtonProps: { danger: true }, onOk: () => onChange({ ...value, translations: { zh: null, en: null, ru: null } }) })}>清空三语描述</Button> : undefined} />}
    <div className={styles.languages}>
      {translationLocales.map(locale => {
        const translation = value.translations[locale];
        const state = translationReviewState(value, locale, sourceText, sourceLanguage);
        const id = `${name}-translation-${locale}`;
        const helpId = `${id}-help`;
        const isSourceLocale = source.language.split('-')[0] === locale;
        return <Card size="small" className={styles.language} key={locale} title={<Space><span className={styles.languageCode}>{languageCodes[locale]}</span>{translationLocaleLabels[locale]}</Space>} extra={<Tag color={state === 'approved' ? 'success' : state === 'stale' ? 'warning' : state === 'pending' ? 'processing' : 'default'} icon={state === 'approved' ? <CheckCircleFilled /> : undefined}>{reviewLabels[state]}</Tag>}>
          <Form.Item label={`${translationLocaleLabels[locale]}${fieldName}`} htmlFor={id} required={name === 'title' || requiredForPublish}>
            <Input.TextArea id={id} name={id} aria-label={`${translationLocaleLabels[locale]}${fieldName}`} value={translation?.text ?? ''} autoSize={{ minRows: name === 'title' ? 3 : 5, maxRows: 10 }} maxLength={10000} disabled={disabled} aria-describedby={helpId} placeholder={`填写${translationLocaleLabels[locale]}${fieldName}`} onChange={event => onChange(editTranslation(value, locale, event.target.value, sourceText, sourceLanguage, revisions.current[locale]))} />
          </Form.Item>
          <div id={helpId} className={styles.provenance}>{translation ? <Space size={6} wrap><Tag>{kindLabels[translation.kind]}</Tag><Typography.Text type="secondary">对应原文 v{translation.sourceVersion}</Typography.Text></Space> : <Typography.Text type="secondary">尚无内容，可人工填写。</Typography.Text>}</div>
          {isSourceLocale && source.text && <Button type="link" size="small" icon={<CopyOutlined />} className={styles.copyButton} disabled={disabled} onClick={() => onChange(editTranslation(value, locale, source.text!, sourceText, sourceLanguage, revisions.current[locale]))}>{translationLocaleLabels[locale]}{fieldName}使用原文</Button>}
          <div className={styles.review}><Checkbox checked={state === 'approved'} disabled={disabled || source.changed || !translation || !translation.text.trim()} onChange={event => onChange(approveTranslation(value, locale, event.target.checked, sourceText, sourceLanguage))}>{translationLocaleLabels[locale]}{fieldName}已审核</Checkbox></div>
        </Card>;
      })}
    </div>
  </section>;
}
