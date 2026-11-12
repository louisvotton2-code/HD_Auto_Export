import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import 'dayjs/locale/zh-cn';

dayjs.extend(utc);

export function UtcDateTimeField({ label, value, onChange, disabled, id }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  return <DatePicker id={id} aria-label={label} showTime format="YYYY-MM-DD HH:mm" inputReadOnly
    value={value ? dayjs.utc(value).locale('zh-cn') : null} disabled={disabled} placeholder="选择日期与时间（UTC）"
    onChange={date => onChange(date ? date.utc(true).toISOString() : '')} />;
}
