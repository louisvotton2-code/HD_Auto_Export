export type NumericDatePrecision = 'month' | 'date';
export type NumericDateParts = { year: string; month: string; day: string };
export type NumericDatePart = keyof NumericDateParts;

export function numericDateParts(value: string): NumericDateParts {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  return match ? { year: match[1], month: String(Number(match[2])), day: match[3] ? String(Number(match[3])) : '' }
    : { year: '', month: '', day: '' };
}
function validYear(year: string): boolean { return /^\d{4}$/.test(year) && Number(year) >= 1; }
function validMonth(month: string): boolean { return /^\d{1,2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12; }
export function daysInNumericMonth(year: string, month: string): number | null {
  if (!validYear(year) || !validMonth(month)) return null;
  const value = Number(year);
  const leap = value % 4 === 0 && (value % 100 !== 0 || value % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
}
export function numericDateValue(parts: NumericDateParts, precision: NumericDatePrecision): string {
  const maximum = daysInNumericMonth(parts.year, parts.month);
  if (maximum === null) return '';
  const month = parts.month.padStart(2, '0');
  if (precision === 'month') return `${parts.year}-${month}`;
  if (!/^\d{1,2}$/.test(parts.day) || Number(parts.day) < 1 || Number(parts.day) > maximum) return '';
  return `${parts.year}-${month}-${parts.day.padStart(2, '0')}`;
}
export function editNumericDate(parts: NumericDateParts, part: NumericDatePart, value: string, precision: NumericDatePrecision): {
  parts: NumericDateParts; value: string; dayCleared: boolean;
} {
  const next = { ...parts, [part]: value.slice(0, part === 'year' ? 4 : 2) };
  const maximum = daysInNumericMonth(next.year, next.month);
  const dayCleared = precision === 'date' && part !== 'day' && next.day !== '' && maximum !== null && Number(next.day) > maximum;
  if (dayCleared) next.day = '';
  return { parts: next, value: numericDateValue(next, precision), dayCleared };
}
export function invalidNumericDatePart(parts: NumericDateParts, precision: NumericDatePrecision): NumericDatePart | null {
  if (parts.year !== '' && !validYear(parts.year)) return 'year';
  if (parts.month !== '' && !validMonth(parts.month)) return 'month';
  const maximum = daysInNumericMonth(parts.year, parts.month);
  if (precision === 'date' && parts.day !== '' && (!/^\d{1,2}$/.test(parts.day) || Number(parts.day) < 1 || Number(parts.day) > (maximum ?? 31))) return 'day';
  return null;
}
