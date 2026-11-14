import { Input, InputNumber, Select } from 'antd';
import { powertrainLabels } from '../vehicles/draft-form';
import { ExternalFactsSchema, type PartialDate } from '@hd/contracts/admin';
import { PartialDateField } from '../../shared/ui/partial-date-field';
import { fieldLabels } from './external-labels';
import styles from './listing-override-editor.module.css';

export type FactField = keyof typeof ExternalFactsSchema.shape;
const namedFields: readonly FactField[] = ['make', 'model', 'trim', 'generation'];
const numericFields: readonly FactField[] = ['modelYear', 'mileageKm', 'engineCc', 'powerKw'];
const optionLabels: Record<string, string> = {
  registered: '已登记', never_registered: '未登记',
  ...powertrainLabels,
  hatchback: '两厢车', suv: 'SUV', sedan: '轿车', wagon: '旅行车', coupe: '轿跑',
  convertible: '敞篷车', van: '厢式车', pickup: '皮卡',
  manual: '手动', automatic: '自动', cvt: '无级变速', dct: '双离合',
  fwd: '前驱', rwd: '后驱', awd: '全轮驱动', four_wd: '四驱',
};

const numericUnits: Partial<Record<FactField, string>> = {
  modelYear: ' 款', mileageKm: ' 公里', engineCc: ' cc', powerKw: ' kW', powerHp: ' hp',
};

export function formatExternalFact(field: FactField, value: unknown): string {
  if (typeof value === 'number') {
    const amount = field === 'modelYear' ? String(value) : value.toLocaleString('zh-CN');
    return amount + (numericUnits[field] ?? '');
  }
  if (typeof value === 'string') return optionLabels[value] ?? value;
  if (value && typeof value === 'object') {
    if ('name' in value && typeof value.name === 'string') return value.name;
    if ('value' in value && typeof value.value === 'string') return value.value;
    if ('country' in value) {
      const location = value as { country: string; city?: string | null; displayName?: string | null };
      return location.displayName || [location.country, location.city].filter(Boolean).join(' · ');
    }
  }
  return '未提供';
}

export function FactOverrideInput({ field, value, onChange, disabled = false }: {
  field: FactField; value: unknown; onChange: (value: unknown) => void; disabled?: boolean;
}) {
  const fieldLabel = fieldLabels[field];
  if (numericFields.includes(field)) {
    return <div className={styles.inputGrid}><InputNumber aria-label={`${fieldLabel}修订值`} disabled={disabled}
      suffix={numericUnits[field]?.trim()} placeholder="未知" value={typeof value === 'number' ? value : null} onChange={onChange} /></div>;
  }
  const fields: Record<string, unknown> = {
    ...(field === 'location' ? { city: null, displayName: null } : {}),
    ...(value && typeof value === 'object' ? value as Record<string, unknown> : {}),
  };
  const text = (key: string) => {
    const item = fields[key];
    return typeof item === 'string' ? item : '';
  };
  const input = (key: string, label: string, allowNull = false, maxLength = 120) => <label>
    {label}<Input aria-label={`${fieldLabel}${label}`} value={text(key)} disabled={disabled} maxLength={maxLength} onChange={event => {
      const next = event.target.value;
      onChange({ ...fields, [key]: allowNull && !next ? null : next });
    }} />
  </label>;
  if (namedFields.includes(field)) return <div className={styles.inputGrid}>{input('name', '名称')}{input('id', '稳定编号', false, 100)}</div>;
  if (field === 'location') return <div className={styles.inputGrid}>{input('country', '两字母国家代码', false, 2)}{input('city', '城市', true)}{input('displayName', '地点说明', true, 200)}</div>;
  if (field === 'manufacturedAt' || field === 'firstRegistration') {
    return <PartialDateField label={fieldLabel} value={value && typeof value === 'object' ? value as PartialDate : null} onChange={onChange} disabled={disabled} />;
  }
  const enums = {
    registrationStatus: ExternalFactsSchema.shape.registrationStatus.options,
    powertrain: ExternalFactsSchema.shape.powertrain.options,
    body: ExternalFactsSchema.shape.body.unwrap().options,
    transmission: ExternalFactsSchema.shape.transmission.unwrap().options,
    drivetrain: ExternalFactsSchema.shape.drivetrain.unwrap().options,
  };
  const options = enums[field as keyof typeof enums];
  return <div className={styles.inputGrid}><Select aria-label={`${fieldLabel}修订值`} value={typeof value === 'string' ? value : undefined}
    disabled={disabled} virtual={false} getPopupContainer={trigger => trigger.parentElement ?? trigger} placeholder="未知"
    options={options.map(option => ({ value: option, label: optionLabels[option] ?? option }))} onChange={onChange} /></div>;
}
