'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { editNumericDate, invalidNumericDatePart, numericDateParts, type NumericDatePart, type NumericDatePrecision } from '../application/numeric-date';
import styles from './numeric-date-input.module.css';

const copy = {
  zh: { year: '年', month: '月', day: '日', invalid: '请输入有效的年、月和日。年份需要完整的四位数字。', cleared: '所选年月不包含原先的日期，日已清空，请重新填写。' },
  en: { year: 'Year', month: 'Month', day: 'Day', invalid: 'Enter a valid date. The year needs all four digits.', cleared: 'The previous day does not exist in the selected month and year. Day was cleared; enter it again.' },
  ru: { year: 'Год', month: 'Месяц', day: 'День', invalid: 'Введите допустимую дату. Год должен содержать четыре цифры.', cleared: 'Прежнего дня нет в выбранном месяце и году. День очищен; укажите его заново.' },
} as const;

/** Numeric segments keep partial edits local; only a complete valid ISO value reaches the tax core. */
export function NumericDateInput({ id, name, value, precision, label, locale, onChange, onBlur, describedBy, invalid = false }: {
  id: string;
  name: string;
  value: string;
  precision: NumericDatePrecision;
  label: string;
  locale: Locale;
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
        <input id={`${id}-${part}`} name={`${name}${part[0].toUpperCase()}${part.slice(1)}`} type="text" inputMode="numeric" pattern="[0-9]*"
          maxLength={part === 'year' ? 4 : 2} value={current.parts[part]} autoComplete="off" spellCheck={false}
          aria-label={`${label}: ${words[part]}`} aria-invalid={invalid || invalidPart === part}
          aria-describedby={descriptions || undefined} placeholder={part === 'year' ? 'YYYY' : part === 'month' ? 'MM' : 'DD'}
          onChange={event => edit(part, event.target.value)} onBlur={onBlur} />
      </div>)}
    </div>
    {feedback && <small id={`${id}-date-feedback`} className={styles.feedback} role="status">{feedback}</small>}
  </fieldset>;
}
