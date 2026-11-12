import { useEffect, useState } from 'react';
import { DatePicker, Select, Space } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import type { PartialDate } from '@hd/contracts/admin';

const formats = { year: 'YYYY', month: 'YYYY-MM', day: 'YYYY-MM-DD' };
const pickers = { year: 'year', month: 'month', day: 'date' } as const;

export function PartialDateField({ label, value, onChange, disabled, id }: {
  label: string;
  value: PartialDate | null;
  onChange: (value: PartialDate | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [precision, setPrecision] = useState<PartialDate['precision']>(value?.precision ?? 'month');
  useEffect(() => { if (value) setPrecision(value.precision); }, [value?.precision]);

  function changePrecision(next: PartialDate['precision']) {
    setPrecision(next);
    if (!value) return;
    const length = { year: 4, month: 7, day: 10 }[next];
    // Increasing precision needs a new selection, as the existing date lacks that detail.
    onChange(length > value.value.length ? null : { precision: next, value: value.value.slice(0, length) });
  }

  return <Space wrap>
    <Select aria-label={`${label}精度`} value={precision} disabled={disabled} onChange={changePrecision}
      options={[{ value: 'year', label: '年份' }, { value: 'month', label: '年月' }, { value: 'day', label: '完整日期' }]} />
    <DatePicker id={id} aria-label={label} picker={pickers[precision]} format={formats[precision]}
      value={value ? dayjs(value.value).locale('zh-cn') : null} disabled={disabled} inputReadOnly
      placeholder={precision === 'year' ? '选择年份' : precision === 'month' ? '选择年月' : '选择日期'}
      onChange={date => onChange(date ? { precision, value: date.format(formats[precision]) } : null)} />
  </Space>;
}
