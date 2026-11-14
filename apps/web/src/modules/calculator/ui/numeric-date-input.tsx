'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { daysInNumericMonth, editNumericDate, invalidNumericDatePart, numericDateParts, type NumericDatePart, type NumericDatePrecision } from '../application/numeric-date';
import styles from './numeric-date-input.module.css';

const copy = {
  zh: { year: '年', month: '月', day: '日', invalid: '请选择有效的年、月和日。', cleared: '所选年月不包含原先的日期，日已清空，请重新填写。' },
  en: { year: 'Year', month: 'Month', day: 'Day', invalid: 'Select a valid year, month and day.', cleared: 'The previous day does not exist in the selected month and year. Day was cleared; enter it again.' },
  ru: { year: 'Год', month: 'Месяц', day: 'День', invalid: 'Выберите допустимые год, месяц и день.', cleared: 'Прежнего дня нет в выбранном месяце и году. День очищен; укажите его заново.' },
} as const;

const FIRST_COMMON_YEAR = 1886;
const MAX_COMMON_YEARS = 300;

/** Numeric selections keep partial dates local; only a complete valid ISO value reaches the tax core. */
export function NumericDateInput({ id, name, value, precision, label, locale, referenceYear, onChange, onBlur, describedBy, invalid = false }: {
  id: string;
  name: string;
  value: string;
  precision: NumericDatePrecision;
  label: string;
  locale: Locale;
  referenceYear: number;
  onChange: (value: string) => void;
  onBlur?: () => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [state, setState] = useState(() => ({ source: value, parts: numericDateParts(value), dayCleared: false }));
  useEffect(() => setState(previous => previous.source === value ? previous : { source: value, parts: numericDateParts(value), dayCleared: false }), [value]);
  const current = state.source === value ? state : { source: value, parts: numericDateParts(value), dayCleared: false };
  const words = copy[locale];
  const invalidPart = invalidNumericDatePart(current.parts, precision);
  const feedback = current.dayCleared ? words.cleared : invalidPart ? words.invalid : '';
  const descriptions = [describedBy, feedback && `${id}-date-feedback`].filter(Boolean).join(' ');
  const parts: NumericDatePart[] = precision === 'month' ? ['year', 'month'] : ['year', 'month', 'day'];
  // Keep common vehicle-year choices bounded. A legitimate
  // saved year outside this window remains selectable instead of being replaced.
  const reference = Number.isFinite(referenceYear) ? Math.floor(referenceYear) : FIRST_COMMON_YEAR;
  const lastYear = Math.max(FIRST_COMMON_YEAR, Math.min(FIRST_COMMON_YEAR + MAX_COMMON_YEARS - 1, reference + 5));
  const years = Array.from({ length: lastYear - FIRST_COMMON_YEAR + 1 }, (_, index) => String(FIRST_COMMON_YEAR + index));
  if (/^\d{4}$/.test(current.parts.year) && Number(current.parts.year) >= 1 && !years.includes(current.parts.year))
    years.push(current.parts.year);
  years.sort((left, right) => Number(right) - Number(left));
  const days = daysInNumericMonth(current.parts.year, current.parts.month);
  const options = (part: NumericDatePart) => part === 'year' ? years
    : Array.from({ length: part === 'month' ? 12 : days ?? 31 }, (_, index) => String(index + 1));
  function edit(part: NumericDatePart, text: string) {
    const next = editNumericDate(current.parts, part, text, precision);
    setState({ source: next.value, parts: next.parts, dayCleared: next.dayCleared || part !== 'day' && current.dayCleared });
    onChange(next.value);
  }
  return <fieldset className={styles.group} aria-describedby={descriptions || undefined} data-numeric-date={name}>
    <legend>{label}</legend>
    <input id={id} type="hidden" name={name} value={value} />
    <div className={styles.controls} data-precision={precision}>
      {parts.map(part => <div key={part} className={styles.part}>
        <label htmlFor={`${id}-${part}`}>{words[part]}</label>
        <select id={`${id}-${part}`} name={`${name}${part[0].toUpperCase()}${part.slice(1)}`}
          value={current.parts[part]} disabled={part === 'day' && days === null}
          aria-label={`${label}: ${words[part]}`} aria-invalid={invalid || invalidPart === part}
          aria-describedby={descriptions || undefined} onChange={event => edit(part, event.target.value)} onBlur={onBlur}>
          <option value="">—</option>
          {options(part).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>)}
    </div>
    {feedback && <small id={`${id}-date-feedback`} className={styles.feedback} role="status">{feedback}</small>}
  </fieldset>;
}
