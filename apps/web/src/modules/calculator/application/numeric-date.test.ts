import { describe, expect, it } from 'vitest';
import { daysInNumericMonth, editNumericDate, invalidNumericDatePart, numericDateParts, numericDateValue } from './numeric-date';

describe('numeric date adapter', () => {
  it('retains empty and partial fields without inventing a complete month', () => {
    const empty = numericDateParts('');
    expect(empty).toEqual({ year: '', month: '', day: '' });
    const partial = editNumericDate(empty, 'year', '202', 'month');
    expect(partial.parts.year).toBe('202');
    expect(partial.value).toBe('');
    expect(numericDateValue({ ...partial.parts, month: '2' }, 'month')).toBe('');
    expect(numericDateValue({ year: '2024', month: '2', day: '' }, 'month')).toBe('2024-02');
  });
  it.each(['0000', '-123', 'year'])('does not normalize invalid year %s into a valid date', year => {
    const parts = { year, month: '1', day: '1' };
    expect(numericDateValue(parts, 'date')).toBe('');
    expect(invalidNumericDatePart(parts, 'date')).toBe('year');
  });
  it('uses Gregorian leap years, including the century rule', () => {
    expect(daysInNumericMonth('2000', '2')).toBe(29);
    expect(daysInNumericMonth('1900', '2')).toBe(28);
    expect(numericDateValue({ year: '2024', month: '2', day: '29' }, 'date')).toBe('2024-02-29');
    expect(numericDateValue({ year: '2023', month: '2', day: '29' }, 'date')).toBe('');
  });
  it('clears an impossible day after a year/month edit, without substituting another day', () => {
    const year = editNumericDate(numericDateParts('2024-02-29'), 'year', '2023', 'date');
    expect(year).toEqual({ parts: { year: '2023', month: '2', day: '' }, value: '', dayCleared: true });
    const month = editNumericDate(numericDateParts('2024-01-31'), 'month', '4', 'date');
    expect(month.parts).toEqual({ year: '2024', month: '4', day: '' });
    expect(month.value).toBe('');
    expect(month.dayCleared).toBe(true);
  });
  it('preserves a valid day and leaves an explicitly invalid day editable', () => {
    expect(editNumericDate(numericDateParts('2024-01-30'), 'month', '4', 'date').value).toBe('2024-04-30');
    const invalid = editNumericDate(numericDateParts('2024-04-30'), 'day', '31', 'date');
    expect(invalid.parts.day).toBe('31');
    expect(invalid.value).toBe('');
    expect(invalid.dayCleared).toBe(false);
  });
});
