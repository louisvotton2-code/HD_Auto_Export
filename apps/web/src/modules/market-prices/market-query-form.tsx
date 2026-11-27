'use client';

import { useId } from 'react';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import styles from './market-query-form.module.css';

export type MarketFiltersDraft = {
  make: string;
  model: string;
  trim: string;
  yearMin: string;
  yearMax: string;
  mileageMin: string;
  mileageMax: string;
  powertrain: string;
};

export type MarketFilterOption = { value: string; label: string };

export type MarketOptionsGroup = {
  options: readonly MarketFilterOption[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  onRetry?: () => void;
};

type FormError = 'range' | 'required' | 'invalid';
type SelectName = 'make' | 'model' | 'trim' | 'powertrain';

const copy = {
  zh: {
    make: '品牌', model: '车型', trim: '款型', powertrain: '动力类型',
    year: '年款', mileage: '里程（公里）', from: '最低', to: '最高',
    selectMake: '请选择品牌', selectModel: '请选择车型', firstMake: '请先选择品牌',
    firstModel: '请先选择车型', all: '不限', empty: '暂无可选项', loading: '正在加载选项…',
    unavailable: '选项加载失败。', retry: '重试', submit: '查询行情', pending: '查询中…',
    errors: { required: '请选择品牌和车型。', range: '起始值不能大于结束值。', invalid: '请检查筛选条件。' },
  },
  en: {
    make: 'Make', model: 'Model', trim: 'Trim', powertrain: 'Powertrain',
    year: 'Model year', mileage: 'Mileage (km)', from: 'Min', to: 'Max',
    selectMake: 'Select a make', selectModel: 'Select a model', firstMake: 'Select a make first',
    firstModel: 'Select a model first', all: 'Any', empty: 'No options available', loading: 'Loading options…',
    unavailable: 'Couldn’t load options.', retry: 'Retry', submit: 'Check prices', pending: 'Checking prices…',
    errors: { required: 'Select a make and model.', range: 'The minimum must not exceed the maximum.', invalid: 'Check your filter values.' },
  },
  ru: {
    make: 'Марка', model: 'Модель', trim: 'Комплектация', powertrain: 'Тип двигателя',
    year: 'Модельный год', mileage: 'Пробег (км)', from: 'От', to: 'До',
    selectMake: 'Выберите марку', selectModel: 'Выберите модель', firstMake: 'Сначала выберите марку',
    firstModel: 'Сначала выберите модель', all: 'Любой вариант', empty: 'Нет вариантов', loading: 'Загрузка вариантов…',
    unavailable: 'Не удалось загрузить варианты.', retry: 'Повторить', submit: 'Узнать цены', pending: 'Поиск цен…',
    errors: { required: 'Выберите марку и модель.', range: 'Минимум не может превышать максимум.', invalid: 'Проверьте значения фильтров.' },
  },
};

export function MarketQueryForm({
  locale, draft, makes, models, trims, powertrains, onChange, onSubmit, error, pending,
}: {
  locale: Locale;
  draft: MarketFiltersDraft;
  makes: MarketOptionsGroup;
  models: MarketOptionsGroup;
  trims: MarketOptionsGroup;
  powertrains: readonly MarketFilterOption[];
  onChange: (name: keyof MarketFiltersDraft, value: string) => void;
  onSubmit: () => void;
  error: FormError | null;
  pending: boolean;
}) {
  const id = useId();
  const t = copy[locale];

  function select(name: SelectName, group: MarketOptionsGroup, placeholder: string, available = true) {
    const controlId = `${id}-${name}`;
    const options = available && group.status === 'ready' ? group.options : [];
    const unavailable = available && group.status === 'error';
    const required = name === 'make' || name === 'model';
    const loading = available && group.status === 'loading';
    const showEmptyState = required && available && group.status === 'ready' && options.length === 0;
    const selected = draft[name];

    return (
      <div className={styles.field}>
        <label htmlFor={controlId}>{t[name]}</label>
        <select
          id={controlId}
          name={name}
          value={selected}
          required={required}
          disabled={!available || group.status !== 'ready' || (showEmptyState && !selected)}
          aria-busy={loading || undefined}
          aria-invalid={error === 'required' && required && !selected || undefined}
          aria-describedby={unavailable ? `${controlId}-error` : undefined}
          data-empty={!selected || undefined}
          onChange={(event) => onChange(name, event.currentTarget.value)}
        >
          <option value="">{loading ? t.loading : showEmptyState ? t.empty : placeholder}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          {selected && !options.some((option) => option.value === selected) && (
            <option value={selected}>{selected.replace(/[-_]+/g, ' ')}</option>
          )}
        </select>
        {unavailable && (
          <p id={`${controlId}-error`} className={styles.optionError} role="status">
            {t.unavailable}{group.onRetry && <> <button type="button" onClick={group.onRetry}>{t.retry}</button></>}
          </p>
        )}
      </div>
    );
  }

  function range(label: string, min: 'yearMin' | 'mileageMin', max: 'yearMax' | 'mileageMax') {
    return (
      <fieldset className={styles.rangeField}>
        <legend>{label}</legend>
        <div className={styles.rangeControls}>
          {[{ name: min, edge: t.from }, { name: max, edge: t.to }].map(({ name, edge }) => (
            <input
              key={name}
              name={name}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={`${label} · ${edge}`}
              placeholder={edge}
              value={draft[name]}
              onChange={(event) => onChange(name, event.currentTarget.value)}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <form
      className={styles.form}
      aria-busy={pending || undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      data-testid="market-query-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) onSubmit();
      }}
    >
      <div className={styles.fields}>
        {select('make', makes, t.selectMake)}
        {select('model', models, draft.make ? t.selectModel : t.firstMake, Boolean(draft.make))}
      </div>
      <div className={`${styles.fields} ${styles.optionalFields}`}>
        {select('trim', trims, draft.model ? t.all : t.firstModel, Boolean(draft.make && draft.model))}
        {select('powertrain', { options: powertrains, status: 'ready' }, t.all)}
        {range(t.year, 'yearMin', 'yearMax')}
        {range(t.mileage, 'mileageMin', 'mileageMax')}
      </div>
      {error && <p id={`${id}-error`} className={styles.error} role="alert">{t.errors[error]}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.submit} disabled={pending}>
          <Icon name={pending ? 'loader' : 'search'} size={18} className={pending ? styles.spinner : undefined} />
          {pending ? t.pending : t.submit}
        </button>
      </div>
    </form>
  );
}
