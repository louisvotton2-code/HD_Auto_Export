import { Input, InputNumber, Select, Space } from 'antd';
import { powertrainLabels } from '../vehicles/draft-form';
import { ExternalFactsSchema } from '@hd/contracts/admin';

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
  modelYear: ' 款', mileageKm: ' 公里', engineCc: ' cc', powerKw: ' kW',
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

export function FactOverrideInput({ field, value, onChange }: {
  field: FactField; value: unknown; onChange: (value: unknown) => void;
}) {
  if (numericFields.includes(field)) {
    return <InputNumber aria-label="修订值" suffix={numericUnits[field]?.trim()} value={typeof value === 'number' ? value : null} onChange={onChange} />;
  }
  const fields: Record<string, unknown> = {
    ...(field === 'location' ? { city: null, displayName: null } : {}),
    ...(value && typeof value === 'object' ? value as Record<string, unknown> : {}),
  };
  const text = (key: string) => {
    const item = fields[key];
    return typeof item === 'string' ? item : '';
  };
  const input = (key: string, label: string, allowNull = false) => <label>
    {label}<Input value={text(key)} onChange={event => {
      const next = event.target.value;
      onChange({ ...fields, [key]: allowNull && !next ? null : next });
    }} />
  </label>;
  if (namedFields.includes(field)) return <Space wrap>{input('id', '稳定编号')}{input('name', '名称')}</Space>;
  if (field === 'location') return <Space wrap>{input('country', '两字母国家代码')}{input('city', '城市', true)}{input('displayName', '地点说明', true)}</Space>;
  if (field === 'manufacturedAt' || field === 'firstRegistration') {
    return <Space wrap>
      <Select aria-label="日期精度" value={text('precision') || undefined} placeholder="选择日期精度" style={{ minWidth: 130 }}
        options={[{ value: 'year', label: '年' }, { value: 'month', label: '年月' }, { value: 'day', label: '年月日' }]}
        onChange={precision => onChange({ ...fields, precision })} />
      {input('value', '日期（YYYY / YYYY-MM / YYYY-MM-DD）')}
    </Space>;
  }
  const enums = {
    registrationStatus: ExternalFactsSchema.shape.registrationStatus.options,
    powertrain: ExternalFactsSchema.shape.powertrain.options,
    body: ExternalFactsSchema.shape.body.unwrap().options,
    transmission: ExternalFactsSchema.shape.transmission.unwrap().options,
    drivetrain: ExternalFactsSchema.shape.drivetrain.unwrap().options,
  };
  const options = enums[field as keyof typeof enums];
  return <Select aria-label="修订值" value={typeof value === 'string' ? value : undefined} style={{ minWidth: 160 }}
    options={options.map(option => ({ value: option, label: optionLabels[option] ?? option }))} onChange={onChange} />;
}
