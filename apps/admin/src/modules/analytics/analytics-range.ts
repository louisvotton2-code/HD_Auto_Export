export type DateRange = { from: string; to: string };
export type RangePreset = 'today' | 'yesterday' | '7' | '30' | 'custom';
export type AnalyticsPeriod = { preset: RangePreset; days: DateRange };

const millisecondsPerDay = 86_400_000;
const beijingOffset = 8 * 3_600_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function dayAt(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function beijingDay(now = Date.now()) {
  return dayAt(now + beijingOffset);
}

export function presetDates(preset: Exclude<RangePreset, 'custom'>, now = Date.now()): DateRange {
  const offset = preset === 'yesterday' ? 1 : 0;
  const end = now + beijingOffset - offset * millisecondsPerDay;
  const difference = preset === '7' ? 6 : preset === '30' ? 29 : 0;
  return { from: dayAt(end - difference * millisecondsPerDay), to: dayAt(end) };
}

function parseDay(value: string) {
  if (!datePattern.test(value)) return NaN;
  const day = Date.parse(value);
  return Number.isFinite(day) && dayAt(day) === value ? day : NaN;
}

export function matchesReportDates({ start, end }: { start: string; end: string }, { from, to }: DateRange) {
  const firstMidnight = parseDay(from) - beijingOffset;
  const lastMidnight = parseDay(to) - beijingOffset;
  const until = Date.parse(end);
  return Date.parse(start) === firstMidnight && until >= lastMidnight && until <= lastMidnight + millisecondsPerDay;
}

export function dateRangeIssue({ from, to }: DateRange, now = Date.now()) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '请选择有效的开始和结束日期。';
  if (end < start) return '结束日期必须在开始日期当天或之后。';
  if (end - start >= 90 * millisecondsPerDay) return '一次最多查询 90 天（含首尾）。';
  if (to > beijingDay(now)) return '结束日期不能晚于北京时间今天。';
  if (from < dayAt(now + beijingOffset - 89 * millisecondsPerDay)) return '报表保留最近 90 个北京时间自然日。';
  return null;
}
