import { getDisplayTextLimit, type DisplayField } from '@hd/contracts/admin';
import { Collapse, Form, Input, Typography } from 'antd';
import { useId } from 'react';
import { displayLocaleLabels, editDisplayTranslation } from './vehicle-localization-model';
import styles from './display-translations-editor.module.css';

export type DisplayTranslationGroup = {
  id: string;
  label: string;
  fields: DisplayField[];
};

export type DisplayTranslationsEditorProps = {
  groups: DisplayTranslationGroup[];
  savedFields: DisplayField[];
  disabled?: boolean;
  onChange: (field: DisplayField) => void;
  labelForField: (field: DisplayField) => string;
};

const targetLocales = ['en', 'ru'] as const;
const kindLabels = { original: '原文', machine: '机器译文', human: '人工编辑' };

type FieldEditorProps = {
  field: DisplayField;
  saved: DisplayField | undefined;
  label: string;
  disabled: boolean;
  onChange: (field: DisplayField) => void;
};

function DisplayFieldEditor({ field, saved, label, disabled, onChange }: FieldEditorProps) {
  const id = useId();
  const sourceId = `${id}-source`;
  const headingId = `${id}-heading`;
  const chineseSource = field.sourceLanguage.split('-')[0].toLowerCase() === 'zh';
  const limit = getDisplayTextLimit(field.ref);

  return <section className={styles.field} aria-labelledby={headingId}>
    <Typography.Title level={5} id={headingId} className={styles.fieldHeading}>{label}</Typography.Title>
    <div className={styles.source}>
      <Form.Item label={chineseSource ? '中文原文' : '历史原文'} htmlFor={sourceId}>
        <Input.TextArea id={sourceId} aria-label={`${label}原文（只读）`} readOnly value={field.sourceText} autoSize={{ minRows: 1, maxRows: 6 }} />
      </Form.Item>
    </div>
    {!saved && <Typography.Paragraph className={styles.notice}>请先保存原文资料，再填写对应译文。</Typography.Paragraph>}
    <div className={styles.targets}>
      {targetLocales.map(locale => {
        const translation = field.translations[locale];
        const inputId = `${id}-${locale}`;
        const helpId = `${inputId}-help`;
        return <div key={locale} className={styles.target}>
          <Form.Item label={`${displayLocaleLabels[locale]}${label}`} htmlFor={inputId}>
            <Input.TextArea id={inputId} aria-label={`${displayLocaleLabels[locale]}${label}`} aria-describedby={helpId}
              value={translation?.text ?? ''} disabled={disabled || !saved} maxLength={limit}
              autoSize={{ minRows: 2, maxRows: 8 }} placeholder={`填写${displayLocaleLabels[locale]}译文`}
              onChange={event => { if (saved && !disabled) onChange(editDisplayTranslation(field, saved, locale, event.target.value)); }} />
          </Form.Item>
          <div id={helpId} className={styles.provenance}>{translation ? kindLabels[translation.kind] : '尚无译文'} · 最多{limit}字</div>
        </div>;
      })}
    </div>
  </section>;
}

export function DisplayTranslationsEditor({ groups, savedFields, disabled = false, onChange, labelForField }: DisplayTranslationsEditorProps) {
  const savedByRef = new Map(savedFields.map(field => [field.ref, field]));

  return <Collapse className={styles.groups} defaultActiveKey={[]} items={groups.map(group => ({
    key: group.id,
    label: <span className={styles.groupLabel}><span>{group.label}</span><span className={styles.count}>{group.fields.length}项</span></span>,
    children: group.fields.length ? <div className={styles.fields}>{group.fields.map(field => <DisplayFieldEditor
      key={field.ref} field={field} saved={savedByRef.get(field.ref)} label={labelForField(field)} disabled={disabled} onChange={onChange}
    />)}</div> : <Typography.Paragraph className={styles.empty}>暂无需要翻译的字段。</Typography.Paragraph>,
  }))} />;
}
