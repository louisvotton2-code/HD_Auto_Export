'use client';

import { useState, type FormEvent } from 'react';
import type { PublicVehicleFilters, PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from '../public-messages';
import { liveVehicleCopy } from '../live-copy';
import { catalogFilterCopy } from '../catalog-filter-copy';
import { catalogFilterKeys, parseCatalogPageQuery } from '../public-query';
import { formatPublicAmount, publicCatalogHref } from '../public-presentation';
import { CatalogBrandPicker } from './catalog-brand-picker';
import styles from './public-vehicles.module.css';

const priceSteps = [
  0, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000,
];
const mileageSteps = [0, 10000, 20000, 30000, 50000, 75000, 100000, 150000, 200000, 300000];

export function PublicVehicleFiltersForm({
  locale,
  filters,
  filtersPending = false,
  brandModels,
  brandPending,
  modelFilters,
  showModelOptions,
  modelFiltersPhase,
  onRetryModelFilters,
  query,
  make,
  model,
  onModelScopeChange,
  pending = false,
  retryAfter = 0,
  navigate,
  onSubmitFilters,
  onRetry,
}: {
  locale: Locale;
  filters: PublicVehicleFilters['data'] | null;
  filtersPending?: boolean;
  brandModels: PublicVehicleFilters['data']['models'];
  brandPending: boolean;
  modelFilters: Pick<PublicVehicleFilters['data'], 'trims' | 'generations'> | null;
  showModelOptions: { trim: boolean; generation: boolean };
  modelFiltersPhase: 'checking' | 'error' | 'fresh' | undefined;
  onRetryModelFilters: () => void;
  query: PublicVehicleQuery;
  make: string;
  model: string;
  onModelScopeChange: (make: string, model: string) => void;
  pending?: boolean;
  retryAfter?: number;
  navigate: (href: string) => void;
  onSubmitFilters?: (href: string) => void;
  onRetry?: () => void;
}) {
  const t = publicVehicleMessages(locale),
    live = liveVehicleCopy[locale],
    c = catalogFilterCopy[locale];
  const [generation, setGeneration] = useState(query.generation ?? '');
  const [trim, setTrim] = useState(query.trim ?? '');
  const [error, setError] = useState(false);
  const models = brandModels;
  const trims = (modelFilters?.trims ?? []).filter((x) => x.makeId === make && x.modelId === model);
  const generations = (modelFilters?.generations ?? []).filter(
    (x) => x.makeId === make && x.modelId === model,
  );
  const showGeneration = showModelOptions.generation || generations.length > 0 || Boolean(generation);
  const showTrim = showModelOptions.trim || trims.length > 0 || Boolean(trim);
  const showDrive = Boolean(filters?.drivetrains?.length || query.drivetrain);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      input: Record<string, string> = {};
    for (const key of catalogFilterKeys) {
      const value = data.get(key);
      if (typeof value === 'string' && value.trim()) input[key] = value.trim();
    }
    if (input.priceMin === undefined && input.priceMax === undefined) delete input.priceCurrency;
    const parsed = parseCatalogPageQuery({ ...input, pageSize: String(query.pageSize) }, locale);
    if (!parsed) {
      setError(true);
      return;
    }
    setError(false);
    const href = publicCatalogHref(locale, parsed, 1);
    if (event.nativeEvent.isTrusted) onSubmitFilters?.(href);
    navigate(`${href}${href.includes('?') ? '&' : '?'}page=1`);
  }
  function options(items: { id: string; name: string; count: number }[], value: string) {
    return (
      <>
        <option value="">{t.all}</option>
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.count})
          </option>
        ))}
        {value && !items.some((x) => x.id === value) && <option value={value}>{c.selected}</option>}
      </>
    );
  }
  function range(
    label: string,
    min: 'priceMin' | 'mileageMin' | 'yearMin',
    max: 'priceMax' | 'mileageMax' | 'yearMax',
    steps: number[],
  ) {
    const values = [
      ...new Set([
        ...steps.map(String),
        ...(query[min] !== undefined ? [String(query[min])] : []),
        ...(query[max] !== undefined ? [String(query[max])] : []),
      ]),
    ].sort((a, b) => {
      const cents = (value: string) => {
        const [whole, fraction = ''] = value.split('.');
        return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
      };
      return cents(a) < cents(b) ? -1 : cents(a) > cents(b) ? 1 : 0;
    });
    return (
      <fieldset className={styles.rangeGroup}>
        <legend>{label}</legend>
        <div className={styles.rangeFields}>
          {([min, max] as const).map((key, i) => (
            <label key={key}>
              <span className={styles.srOnly}>
                {label} {i === 0 ? c.from : c.to}
              </span>
              <select name={key} defaultValue={query[key] ?? ''}>
                <option value="">{i === 0 ? c.from : c.to}</option>
                {values.map((value) => (
                  <option key={value} value={value}>
                    {key.startsWith('year') ? value : formatPublicAmount(value, locale)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <form
      method="get"
      action={`/${locale}/cars/`}
      className={styles.filters}
      onSubmit={submit}
      aria-busy={pending}
    >
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="pageSize" value={query.pageSize} />
      <h2 className={styles.srOnly}>{live.filters}</h2>
      <CatalogBrandPicker
        locale={locale}
        brands={filters?.makes ?? []}
        value={make}
        pending={filtersPending}
        onChange={value => {
          onModelScopeChange(value, '');
          setGeneration('');
          setTrim('');
        }}
      />
      <label>
        <span>{live.search}</span>
        <input
          name="q"
          type="search"
          maxLength={100}
          defaultValue={query.q ?? ''}
          placeholder={live.search}
        />
      </label>
      <button className={styles.searchButton} type="submit">
        {c.search}
      </button>
      <label>
        <span>{c.sort}</span>
        <select name="sort" defaultValue={query.sort ?? 'newest'}>
          {(Object.keys(c.sorts) as (keyof typeof c.sorts)[]).map(value =>
            <option key={value} value={value}>{c.sorts[value]}</option>)}
        </select>
      </label>
      <div className={styles.filterDivider} />
      <label>
        <span>{t.model}</span>
        <select
          name="model"
          value={model}
          disabled={!make && !model}
          aria-busy={brandPending || undefined}
          onChange={(e) => {
            onModelScopeChange(make, e.target.value);
            setGeneration('');
            setTrim('');
          }}
        >
          {options(models, model)}
        </select>
      </label>
      {showGeneration && (
        <label>
          <span>{c.generation}</span>
          <select
            name="generation"
            value={generation}
            disabled={!make || !model}
            aria-busy={modelFiltersPhase === 'checking' || undefined}
            onChange={(e) => setGeneration(e.target.value)}
          >
            {options(generations, generation)}
          </select>
        </label>
      )}
      <label>
        <span>{t.powertrain}</span>
        <select name="powertrain" defaultValue={query.powertrain ?? ''}>
          <option value="">{t.all}</option>
          {filters?.powertrains.map((x) => (
            <option key={x.id} value={x.id}>
              {t.powertrains[x.id]} ({x.count})
            </option>
          ))}
          {query.powertrain && !filters?.powertrains.some((x) => x.id === query.powertrain) && (
            <option value={query.powertrain}>{t.powertrains[query.powertrain]}</option>
          )}
        </select>
      </label>
      {showDrive && (
        <label>
          <span>{c.drive}</span>
          <select name="drivetrain" defaultValue={query.drivetrain ?? ''}>
            <option value="">{t.all}</option>
            {filters?.drivetrains?.map((x) => (
              <option key={x.id} value={x.id}>
                {c.drives[x.id]} ({x.count})
              </option>
            ))}
            {query.drivetrain && !filters?.drivetrains?.some((x) => x.id === query.drivetrain) && (
              <option value={query.drivetrain}>{c.drives[query.drivetrain]}</option>
            )}
          </select>
        </label>
      )}
      {showTrim && (
        <label>
          <span>{c.trim}</span>
          <select
            name="trim"
            value={trim}
            disabled={!make || !model}
            aria-busy={modelFiltersPhase === 'checking' || undefined}
            onChange={(e) => setTrim(e.target.value)}
          >
            {options(trims, trim)}
          </select>
        </label>
      )}
      {modelFiltersPhase === 'checking' && (
        <p className={styles.filterNotice} role="status">{c.optionsLoading}</p>
      )}
      {modelFiltersPhase === 'error' && (
        <p className={styles.filterNotice} data-testid="public-model-filters-unavailable">
          {t.filterUnavailable}{' '}
          <a
            href={retryAfter > 0 ? undefined : publicCatalogHref(locale, query)}
            aria-disabled={retryAfter > 0 || undefined}
            onClick={(event) => {
              event.preventDefault();
              if (retryAfter <= 0) onRetryModelFilters();
            }}
          >
            {t.retry}
          </a>
        </p>
      )}
      <div className={styles.filterDivider} />
      <input type="hidden" name="priceCurrency" value="USD" />
      {range(`${c.price} (USD)`, 'priceMin', 'priceMax', priceSteps)}
      {range(c.mileage, 'mileageMin', 'mileageMax', mileageSteps)}
      {range(
        c.year,
        'yearMin',
        'yearMax',
        (filters?.modelYears ?? []).map((x) => x.year),
      )}
      {error && (
        <p className={styles.filterNotice} role="alert">
          {c.rangeError}
        </p>
      )}
      <div className={styles.filterActions}>
        <button type="submit">{pending ? t.loading : t.apply}</button>
        <a
          href={`/${locale}/cars/`}
          onClick={(event) => {
            if (
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              !event.altKey &&
              event.button === 0
            ) {
              event.preventDefault();
              event.currentTarget.closest('form')?.reset();
              onModelScopeChange('', '');
              setGeneration('');
              setTrim('');
              setError(false);
              navigate(`/${locale}/cars/`);
            }
          }}
        >
          {t.reset}
        </a>
      </div>
      {!filters && filtersPending && (
        <p className={styles.filterNotice} role="status" data-testid="public-filter-loading">
          {c.optionsLoading}
        </p>
      )}
      {!filters && !filtersPending && (
        <p className={styles.filterNotice} data-testid="public-filter-unavailable">
          {t.filterUnavailable}{' '}
          <a
            href={retryAfter > 0 ? undefined : publicCatalogHref(locale, query)}
            aria-disabled={retryAfter > 0 || undefined}
            onClick={(event) => {
              if (retryAfter > 0 || onRetry) event.preventDefault();
              if (retryAfter <= 0) onRetry?.();
            }}
          >
            {t.retry}
          </a>
        </p>
      )}
      <span role="status" className={styles.filterStatus}>
        {pending ? t.loading : ''}
      </span>
    </form>
  );
}
