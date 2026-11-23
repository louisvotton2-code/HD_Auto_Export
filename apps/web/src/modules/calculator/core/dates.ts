import type { CalculationInput, CalendarDate } from './types';

export function parseManufactureMonth(value: string): CalendarDate | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match || Number(match[1]) === 0) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: 1 };
}

export function parseCustomsDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year) return null;
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function daysInMonth(year: number, month: number) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** RU's reference uses calendar months; GE intentionally uses calendar years. */
export function ageInMonths(manufacture: CalendarDate, customs: CalendarDate): number {
  return (customs.year - manufacture.year) * 12 + customs.month - manufacture.month;
}

/** A month alone cannot resolve an anniversary within that same month. */
export function compareManufactureAnniversary(input: CalculationInput, ageMonths: number, years: number): -1 | 0 | 1 | null {
  const delta = ageMonths - years * 12;
  if (delta !== 0) return delta < 0 ? -1 : 1;
  if (!input.manufactureDay) return null;
  const produced = parseCustomsDate(input.manufactureDay);
  const cleared = parseCustomsDate(input.customsDate);
  if (!produced || !cleared) return null;
  const anniversaryDay = Math.min(produced.day, daysInMonth(cleared.year, cleared.month));
  return cleared.day === anniversaryDay ? 0 : cleared.day < anniversaryDay ? -1 : 1;
}
