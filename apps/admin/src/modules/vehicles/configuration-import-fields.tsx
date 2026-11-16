import { Card, Collapse, Form, Input, Pagination, Select, Typography } from 'antd';
import { useState } from 'react';
import { CONFIGURATION_IMPORT_LOCALES, ConfigurationImportPowertrainSchema, VEHICLE_CONFIGURATION_LIMITS, getDisplayTextLimit, type ConfigurationImportDocument } from '@hd/contracts/admin';
import { editImportItem, importLocaleLabels, type ImportLocale } from './configuration-import-model';
import { powertrainLabels } from './draft-form';
import styles from './vehicle-configuration-import.module.css';

type Texts = Record<ImportLocale, string>;
type Edit = (update: (document: ConfigurationImportDocument) => void) => void;
const rowsPerPage = 5;

function LocaleInputs({ label, values, limit, disabled, onChange }: {
  label: string; values: Texts; limit: number; disabled: boolean; onChange: (locale: ImportLocale, text: string) => void;
}) {
  return <div className={styles.importLocales}>
    {CONFIGURATION_IMPORT_LOCALES.map(locale => {
      const name = `${label} · ${importLocaleLabels[locale]}`;
      return <Form.Item key={locale} label={name}>
        <Input.TextArea aria-label={name} value={values[locale]} disabled={disabled} maxLength={limit}
          autoSize={{ minRows: 1, maxRows: 6 }} onChange={event => onChange(locale, event.target.value)} />
      </Form.Item>;
    })}
  </div>;
}

export function ConfigurationImportFields({ document, disabled, edit }: { document: ConfigurationImportDocument; disabled: boolean; edit: Edit }) {
  const [page, setPage] = useState(1);
  const items = document.items ?? [];
  const start = (page - 1) * rowsPerPage;
  const title = document.content?.title;
  const description = document.content?.description;
  return <Collapse items={[
    ...(document.facts ? [{ key: 'facts', label: '文件中的动力类型', children: <Form.Item label="导入动力类型">
      <Select aria-label="导入动力类型" value={document.facts.powertrain} disabled={disabled}
        options={ConfigurationImportPowertrainSchema.options.map(value => ({ value, label: powertrainLabels[value] }))}
        onChange={value => edit(next => { next.facts = { powertrain: value }; })} />
    </Form.Item> }] : []),
    ...(items.length ? [{ key: 'items', label: `配置项目 · ${items.length} 项`, children: <>
      {items.slice(start, start + rowsPerPage).map((item, offset) => {
        const index = start + offset;
        return <Card key={index} size="small" className={styles.importItem} title={item.name.zh || `第 ${index + 1} 项`}>
          <LocaleInputs label={`第 ${index + 1} 项名称`} values={item.name} limit={VEHICLE_CONFIGURATION_LIMITS.nameUtf16}
            disabled={disabled} onChange={(locale, text) => edit(next => editImportItem(next, index, 'name', locale, text))} />
          <LocaleInputs label={`第 ${index + 1} 项内容`} values={item.value} limit={VEHICLE_CONFIGURATION_LIMITS.valueUtf16}
            disabled={disabled} onChange={(locale, text) => edit(next => editImportItem(next, index, 'value', locale, text))} />
        </Card>;
      })}
      {items.length > rowsPerPage && <Pagination size="small" current={page} total={items.length} pageSize={rowsPerPage}
        showSizeChanger={false} onChange={setPage} />}
    </> }] : []),
    ...(title || description ? [{ key: 'content', label: '标题与车况描述', children: <>
      {title && <LocaleInputs label="导入标题" values={title} limit={10_000} disabled={disabled}
        onChange={(locale, text) => edit(next => { next.content!.title![locale] = text; })} />}
      {description && <LocaleInputs label="导入车况描述" values={description} limit={10_000} disabled={disabled}
        onChange={(locale, text) => edit(next => { next.content!.description![locale] = text; })} />}
    </> }] : []),
    ...(document.display?.length ? [{ key: 'display', label: '其他公开字段', children: document.display.map((field, index) =>
      <section key={field.ref} className={styles.importItem}>
        <Typography.Title level={5}>{field.ref}</Typography.Title>
        <LocaleInputs label={`展示字段 ${index + 1}`} values={field.text} limit={getDisplayTextLimit(field.ref)} disabled={disabled}
          onChange={(locale, text) => edit(next => { next.display![index]!.text[locale] = text; })} />
      </section>) }] : []),
  ]} />;
}
