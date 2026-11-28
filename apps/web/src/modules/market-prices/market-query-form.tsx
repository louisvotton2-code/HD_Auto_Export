'use client';

import { useId } from 'react';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { SearchableOptionPicker } from '@/shared/ui/searchable-option-picker';
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
    searchMake: '输入品牌名称', searchModel: '输入车型名称', clearMake: '清空品牌', clearModel: '清空车型',
    noMakes: '没有匹配的品牌', noModels: '没有匹配的车型', selected: '当前选择',
    firstModel: '请先选择车型', all: '不限', empty: '暂无可选项', loading: '正在加载选项…',
    unavailable: '选项加载失败。', retry: '重试', submit: '查询行情', pending: '查询中…',
    moreFilters: '更多筛选', count: (value: number) => `已选 ${value}`,
    errors: { required: '请选择品牌和车型。', range: '起始值不能大于结束值。', invalid: '请检查筛选条件。' },
  },
  en: {
    make: 'Make', model: 'Model', trim: 'Trim', powertrain: 'Powertrain',
    year: 'Model year', mileage: 'Mileage (km)', from: 'Min', to: 'Max',
    selectMake: 'Select a make', selectModel: 'Select a model', firstMake: 'Select a make first',
    searchMake: 'Search makes', searchModel: 'Search models', clearMake: 'Clear make', clearModel: 'Clear model',
    noMakes: 'No matching makes', noModels: 'No matching models', selected: 'Current selection',
    firstModel: 'Select a model first', all: 'Any', empty: 'No options available', loading: 'Loading options…',
    unavailable: 'Couldn’t load options.', retry: 'Retry', submit: 'Check prices', pending: 'Checking prices…',
    moreFilters: 'More filters', count: (value: number) => `${value} set`,
    errors: { required: 'Select a make and model.', range: 'The minimum must not exceed the maximum.', invalid: 'Check your filter values.' },
  },
  ru: {
    make: 'Марка', model: 'Модель', trim: 'Комплектация', powertrain: 'Тип двигателя',
    year: 'Модельный год', mileage: 'Пробег (км)', from: 'От', to: 'До',
    selectMake: 'Выберите марку', selectModel: 'Выберите модель', firstMake: 'Сначала выберите марку',
    searchMake: 'Поиск марки', searchModel: 'Поиск модели', clearMake: 'Сбросить марку', clearModel: 'Сбросить модель',
    noMakes: 'Марки не найдены', noModels: 'Модели не найдены', selected: 'Выбрано',
    firstModel: 'Сначала выберите модель', all: 'Любой вариант', empty: 'Нет вариантов', loading: 'Загрузка вариантов…',
    unavailable: 'Не удалось загрузить варианты.', retry: 'Повторить', submit: 'Узнать цены', pending: 'Поиск цен…',
    moreFilters: 'Дополнительные фильтры', count: (value: number) => `Выбрано ${value}`,
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
  const optionalCount = [draft.trim, draft.powertrain, draft.yearMin || draft.yearMax, draft.mileageMin || draft.mileageMax].filter(Boolean).length;

  function select(name: SelectName, group: MarketOptionsGroup, placeholder: string, available = true) {
    const controlId = `${id}-${name}`;
    const options = available && group.status === 'ready' ? group.options : [];
    const unavailable = available && group.status === 'error';
    const required = name === 'make' || name === 'model';
    const loading = available && group.status === 'loading';
    const showEmptyState = required && available && group.status === 'ready' && options.length === 0;
    const selected = draft[name];
    const disabled = !available || group.status !== 'ready' || (showEmptyState && !selected);
    const optionError = unavailable ? `${controlId}-error` : undefined;
    const fallbackLabel = loading ? t.loading : showEmptyState ? t.empty : placeholder;
    const selectedFallback = selected && !options.some((option) => option.value === selected) ? selected.replace(/[-_]+/g, ' ') : '';
    const optionErrorNotice = unavailable && (
      <p id={optionError} className={styles.optionError} role="status">
        {t.unavailable}{group.onRetry && <> <button type="button" onClick={group.onRetry}>{t.retry}</button></>}
      </p>
    );

    if (required) {
      const makePicker = name === 'make';
      return (
        <div className={styles.field}>
          <SearchableOptionPicker
            locale={locale} name={name} label={t[name]} value={selected}
            options={[
              { id: '', name: selected ? (makePicker ? t.clearMake : t.clearModel) : fallbackLabel },
              ...options.map(({ value, label }) => ({ id: value, name: label })),
              ...(selectedFallback ? [{ id: selected, name: selectedFallback }] : []),
            ]}
            pending={loading} disabled={disabled} required invalid={error === 'required' && !selected}
            describedBy={optionError} testId={`market-${name}-search`}
            messages={{ search: disabled ? fallbackLabel : makePicker ? t.searchMake : t.searchModel,
              loading: t.loading, empty: makePicker ? t.noMakes : t.noModels, selected: t.selected }}
            onChange={value => onChange(name, value)}
          />
          {optionErrorNotice}
        </div>
      );
    }

    return (
      <div className={styles.field}>
        <label htmlFor={controlId}>{t[name]}</label>
        <select
          id={controlId}
          name={name}
          value={selected}
          disabled={disabled}
          aria-busy={loading || undefined}
          aria-describedby={optionError}
          data-empty={!selected || undefined}
          onChange={(event) => onChange(name, event.currentTarget.value)}
        >
          <option value="">{fallbackLabel}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          {selectedFallback && (
            <option value={selected}>{selectedFallback}</option>
          )}
        </select>
        {optionErrorNotice}
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
      <div className={styles.primaryFields}>
        {select('make', makes, t.selectMake)}
        {select('model', models, draft.make ? t.selectModel : t.firstMake, Boolean(draft.make))}
        <div className={styles.actions}>
          <button type="submit" className={styles.submit} disabled={pending}>
            <Icon name={pending ? 'loader' : 'search'} size={18} className={pending ? styles.spinner : undefined} />
            <span>{pending ? t.pending : t.submit}</span>
          </button>
        </div>
      </div>
      <details className={styles.optional} data-testid="market-optional-filters" open>
        <summary className={styles.optionalToggle}>
          <span>{t.moreFilters}</span>
          {optionalCount > 0 && <span className={styles.filterCount}>{t.count(optionalCount)}</span>}
          <Icon className={styles.optionalChevron} name="chevron" size={16} />
        </summary>
        <div className={styles.optionalFields}>
          {select('trim', trims, draft.model ? t.all : t.firstModel, Boolean(draft.make && draft.model))}
          {select('powertrain', { options: powertrains, status: 'ready' }, t.all)}
          {range(t.year, 'yearMin', 'yearMax')}
          {range(t.mileage, 'mileageMin', 'mileageMax')}
        </div>
      </details>
      {error && <p id={`${id}-error`} className={styles.error} role="alert">{t.errors[error]}</p>}
    </form>
  );
}
