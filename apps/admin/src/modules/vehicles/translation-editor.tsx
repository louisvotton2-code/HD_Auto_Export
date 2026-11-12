import type { TranslatableField } from '@hd/contracts/admin';
import { useRef } from 'react';
import { Alert, App, Button, Card, Form, Input, Space, Typography } from 'antd';
import { DeleteOutlined, GlobalOutlined } from '@ant-design/icons';
import {
  editTranslation, translationLocaleLabels, translationLocales,
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
const kindLabels = { original: '原文', machine: '机器译文', human: '人工编辑' };
const targetLocales = ['en', 'ru'] as const;
const languageCodes = { en: 'EN', ru: 'RU' };

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
  const sourceId = `${name}-translation-source`;
  const sourceHelpId = `${sourceId}-help`;
  const chineseSource = source.language.split('-')[0].toLowerCase() === 'zh';
  const sourceLocation = name === 'title' ? '基础资料' : '价格与内部信息中的车况描述';
  const hasTranslations = translationLocales.some(locale => value.translations[locale] !== null);
  return <section className={styles.editor} aria-labelledby={headingId}>
    <div className={styles.heading}>
      <Typography.Title level={4} id={headingId} style={{ margin: 0 }}><GlobalOutlined /> {fieldName}译文</Typography.Title>
    </div>
    <div className={styles.source}>
      <Form.Item label={chineseSource ? '中文原文' : '原文'} htmlFor={sourceId}>
        <Input.TextArea id={sourceId} aria-label={`${fieldName}原文（只读）`} aria-describedby={sourceHelpId} readOnly value={sourceText} autoSize={{ minRows: 1, maxRows: 8 }} placeholder="尚未填写原文" />
      </Form.Item>
      <Typography.Text id={sourceHelpId} className={styles.sourceHelp}>原文来自{sourceLocation}，请在该处修改并保存。</Typography.Text>
    </div>
    {!chineseSource && <Alert className={styles.sourceAlert} showIcon type="warning" title={`${fieldName}原文尚未整理为中文`} description={`当前记录的来源语言为 ${source.language || '未明确'}。请先在${sourceLocation}整理中文并保存，再生成英俄译文；现有内容及来源信息仍保留。`} />}
    {source.changed && <Alert className={styles.sourceAlert} showIcon type="info" title={`${fieldName}原文有未保存的修改，请先保存草稿，再生成对应译文。`} />}
    {name === 'description' && !source.text && !requiredForPublish && hasTranslations && <div className={styles.emptyDescription}>
      <Typography.Text type="secondary">描述原文留空时，可一并清空现有译文。</Typography.Text>
      <Button size="small" icon={<DeleteOutlined />} disabled={disabled} onClick={() => modal.confirm({ title: '清空三语描述？', content: '这会移除当前草稿的中英俄描述，保存后才会生效。', okText: '清空描述', cancelText: '保留内容', okButtonProps: { danger: true }, onOk: () => onChange({ ...value, translations: { zh: null, en: null, ru: null } }) })}>清空三语描述</Button>
    </div>}
    <div className={styles.languages}>
      {targetLocales.map(locale => {
        const translation = value.translations[locale];
        const state = translationReviewState(value, locale, sourceText, sourceLanguage);
        const id = `${name}-translation-${locale}`;
        const helpId = `${id}-help`;
        return <Card size="small" className={styles.language} key={locale} title={<Space><span className={styles.languageCode}>{languageCodes[locale]}</span>{translationLocaleLabels[locale]}</Space>}>
          <Form.Item label={`${translationLocaleLabels[locale]}${fieldName}`} htmlFor={id} required={name === 'title' || requiredForPublish}>
            <Input.TextArea id={id} name={id} aria-label={`${translationLocaleLabels[locale]}${fieldName}`} value={translation?.text ?? ''} autoSize={{ minRows: name === 'title' ? 3 : 5, maxRows: 10 }} maxLength={10000} disabled={disabled} aria-describedby={helpId} placeholder={`填写${translationLocaleLabels[locale]}${fieldName}`} onChange={event => onChange(editTranslation(value, locale, event.target.value, sourceText, sourceLanguage, revisions.current[locale]))} />
          </Form.Item>
          <div id={helpId} className={styles.provenance}>{translation ? kindLabels[translation.kind] : '尚无译文，可生成或直接填写。'}{state === 'stale' && !source.changed && <span className={styles.stale}>原文已更新，请重新生成或修改译文。</span>}</div>
        </Card>;
      })}
    </div>
  </section>;
}
