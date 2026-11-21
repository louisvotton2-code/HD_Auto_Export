import { Button, DatePicker, Radio, Typography } from 'antd';
import dayjs from 'dayjs';
import { dateRangeIssue, type DateRange, type RangePreset } from './analytics-range';
import styles from './site-analytics.module.css';

const options: { value: RangePreset; label: string }[] = [
  { value: 'today', label: '今日' }, { value: 'yesterday', label: '昨日' },
  { value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' }, { value: 'custom', label: '自选日期' },
];

export function V2RangeControls({ preset, custom, onPreset, onCustom, onApply }: {
  preset: RangePreset;
  custom: DateRange;
  onPreset: (preset: RangePreset) => void;
  onCustom: (range: DateRange) => void;
  onApply: (range: DateRange) => void;
}) {
  const issue = dateRangeIssue(custom);
  return <div className={styles.rangeControls}>
    <Radio.Group value={preset} onChange={event => onPreset(event.target.value)} options={options}
      optionType="button" aria-label="统计日期范围" />
    {preset === 'custom' && <>
      <div className={styles.controls}>
        <DatePicker aria-label="开始日期" format="YYYY-MM-DD" value={custom.from ? dayjs(custom.from) : null}
          onChange={date => onCustom({ ...custom, from: date?.format('YYYY-MM-DD') ?? '' })} />
        <DatePicker aria-label="结束日期" format="YYYY-MM-DD" value={custom.to ? dayjs(custom.to) : null}
          onChange={date => onCustom({ ...custom, to: date?.format('YYYY-MM-DD') ?? '' })} />
        <Button type="primary" disabled={!!issue} onClick={() => onApply(custom)}>查询日期</Button>
      </div>
      {issue && <Typography.Text type="secondary">{issue}</Typography.Text>}
    </>}
  </div>;
}
