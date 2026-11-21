import { describe, expect, it } from 'vitest';
import { beijingDay, dateRangeIssue, matchesReportDates, presetDates } from './analytics-range';

describe('Beijing analytics calendar', () => {
  const now = Date.parse('2026-11-20T16:02:00Z');

  it('counts both endpoints across Beijing midnight and month boundaries', () => {
    expect(beijingDay(now)).toBe('2026-11-21');
    expect(presetDates('today', now)).toEqual({ from: '2026-11-21', to: '2026-11-21' });
    expect(presetDates('yesterday', now)).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(presetDates('7', now)).toEqual({ from: '2026-11-15', to: '2026-11-21' });
    expect(presetDates('30', now)).toEqual({ from: '2026-10-23', to: '2026-11-21' });
  });

  it('accepts 90 inclusive dates and rejects invalid or future ranges', () => {
    expect(dateRangeIssue({ from: '2026-08-24', to: '2026-11-21' }, now)).toBeNull();
    expect(dateRangeIssue({ from: '2026-08-23', to: '2026-11-21' }, now)).toContain('90 天');
    expect(dateRangeIssue({ from: '2026-08-23', to: '2026-08-23' }, now)).toContain('保留');
    expect(dateRangeIssue({ from: '2026-11-22', to: '2026-11-22' }, now)).toContain('今天');
    expect(dateRangeIssue({ from: '2026-11-21', to: '2026-11-20' }, now)).toContain('开始日期');
    expect(dateRangeIssue({ from: '2026-02-30', to: '2026-03-01' }, now)).toContain('有效');
  });

  it('accepts a report from the final day midnight to the following midnight inclusive', () => {
    const days = { from: '2026-10-23', to: '2026-11-21' };
    const start = '2026-10-22T16:00:00.000Z';
    expect(matchesReportDates({ start, end: '2026-11-20T16:00:00.000Z' }, days)).toBe(true);
    expect(matchesReportDates({ start, end: '2026-11-21T16:00:00.000Z' }, days)).toBe(true);
    expect(matchesReportDates({ start, end: '2026-11-20T15:59:59.999Z' }, days)).toBe(false);
    expect(matchesReportDates({ start, end: '2026-11-21T16:00:00.001Z' }, days)).toBe(false);
    expect(matchesReportDates({ start: '2026-10-22T16:00:01.000Z', end: '2026-11-20T16:00:00.000Z' }, days)).toBe(false);
  });
});
