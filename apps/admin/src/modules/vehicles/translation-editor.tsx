import type { TranslatableField } from '@hd/contracts/admin';
import { Alert, App, Button, Card, Form, Input, Space, Typography } from 'antd';
import { DeleteOutlined, GlobalOutlined } from '@ant-design/icons';
import {
  editTranslation, translationLocaleLabels, translationLocales,
  translationSource,
} from './translation-model';
import styles from './translation-editor.module.css';

type Props = {
  name: 'title' | 'description';
  value: TranslatableField;
  saved: TranslatableField;
  sourceText: string;
  sourceLanguage: string;
  onChange: (value: TranslatableField) => void;
  disabled?: boolean;
  requiredForPublish?: boolean;
};
const kindLabels = { original: '原文', machine: '机器译文', human: '人工编辑' };
const languageCodes = { zh: 'ZH', en: 'EN', ru: 'RU' };

export function TranslationEditor({ name, value, saved, sourceText, sourceLanguage, onChange, disabled = false, requiredForPublish = false }: Props) {
  const { modal } = App.useApp();
  const fieldName = name === 'title' ? '标题' : '描述';
  const source = translationSource(value, sourceText, sourceLanguage);
  const headingId = `${name}-translations-heading`;
  const sourceId = `${name}-translation-source`;
  const sourceHelpId = `${sourceId}-help`;
  const chineseSource = source.language.split('-')[0].toLowerCase() === 'zh';
  const sourceLocation = '基础资料';
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
    {source.changed && <Alert className={styles.sourceAlert} showIcon type="info" title={`${fieldName}原文有未保存的修改，请先保存草稿，再生成对应译文。`} />}
    {name === 'description' && !source.text && !requiredForPublish && hasTranslations && <div className={styles.emptyDescription}>
      <Typography.Text type="secondary">描述原文留空时，可一并清空现有译文。</Typography.Text>
      <Button size="small" icon={<DeleteOutlined />} disabled={disabled} onClick={() => modal.confirm({ title: '清空三语描述？', content: '这会移除当前草稿的中英俄描述，保存后才会生效。', okText: '清空描述', cancelText: '保留内容', okButtonProps: { danger: true }, onOk: () => onChange({ ...value, translations: { zh: null, en: null, ru: null } }) })}>清空三语描述</Button>
    </div>}
    <div className={styles.languages}>
      {translationLocales.map(locale => {
        const translation = value.translations[locale];
        const id = `${name}-translation-${locale}`;
        const helpId = `${id}-help`;
        return <Card size="small" className={styles.language} key={locale} title={<Space><span className={styles.languageCode}>{languageCodes[locale]}</span>{translationLocaleLabels[locale]}</Space>}>
          <Form.Item label={`${translationLocaleLabels[locale]}${fieldName}`} htmlFor={id} required={name === 'title' || requiredForPublish}>
            <Input.TextArea id={id} name={id} aria-label={`${translationLocaleLabels[locale]}${fieldName}`} value={translation?.text ?? ''}
              data-translation-ref={`content.${name}`} data-translation-locale={locale}
              autoSize={{ minRows: name === 'title' ? 3 : 5, maxRows: 10 }} maxLength={10000} disabled={disabled || !source.text?.trim()} aria-describedby={helpId} placeholder={`填写${translationLocaleLabels[locale]}${fieldName}`} onChange={event => onChange(editTranslation(value, locale, event.target.value, sourceText, sourceLanguage, saved))} />
          </Form.Item>
          <div id={helpId} className={styles.provenance}>{translation?.text.trim() ? kindLabels[translation.kind] : locale === 'zh' ? '请填写供官网展示的中文内容。' : '请填写供官网展示的译文。'}</div>
        </Card>;
      })}
    </div>
  </section>;
}
