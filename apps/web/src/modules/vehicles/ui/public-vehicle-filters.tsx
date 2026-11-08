'use client';

import { useState, type FormEvent } from 'react';
import type { PublicVehicleFilters, PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from '../public-messages';
import { liveVehicleCopy } from '../live-copy';
import { catalogFilterCopy } from '../catalog-filter-copy';
import { catalogFilterKeys, parseCatalogQuery } from '../public-query';
import { formatPublicAmount, publicCatalogHref } from '../public-presentation';
import styles from './public-vehicles.module.css';

const priceSteps = [
  0, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000,
];
const mileageSteps = [0, 10000, 20000, 30000, 50000, 75000, 100000, 150000, 200000, 300000];

export function PublicVehicleFiltersForm({
  locale,
  filters,
  query,
  pending = false,
  retryAfter = 0,
  navigate,
  onRetry,
}: {
  locale: Locale;
  filters: PublicVehicleFilters['data'] | null;
  query: PublicVehicleQuery;
  pending?: boolean;
  retryAfter?: number;
  navigate: (href: string) => void;
  onRetry?: () => void;
}) {
  const t = publicVehicleMessages(locale),
    live = liveVehicleCopy[locale],
    c = catalogFilterCopy[locale];
  const [make, setMake] = useState(query.make ?? '');
  const [model, setModel] = useState(query.model ?? '');
  const [generation, setGeneration] = useState(query.generation ?? '');
  const [trim, setTrim] = useState(query.trim ?? '');
  const [error, setError] = useState(false);
  const models = (filters?.models ?? []).filter((x) => !make || x.makeId === make);
  const trims = (filters?.trims ?? []).filter((x) => x.makeId === make && x.modelId === model);
  const generations = (filters?.generations ?? []).filter(
    (x) => x.makeId === make && x.modelId === model,
  );
  const showGeneration = Boolean(filters?.generations?.length || query.generation);
  const showTrim = Boolean(filters?.trims?.length || query.trim);
  const showDrive = Boolean(filters?.drivetrains?.length || query.drivetrain);
  const currencies = [
    ...new Set([
      'USD',
      'CNY',
      ...(filters?.priceCurrencies ?? []).map((x) => x.id),
      ...(query.priceCurrency ? [query.priceCurrency] : []),
    ]),
  ];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      input: Record<string, string> = {};
    for (const key of catalogFilterKeys) {
      const value = data.get(key);
      if (typeof value === 'string' && value.trim()) input[key] = value.trim();
    }
    if (input.priceMin === undefined && input.priceMax === undefined) delete input.priceCurrency;
    const parsed = parseCatalogQuery({ ...input, pageSize: String(query.pageSize) }, locale);
    if (!parsed) {
      setError(true);
      return;
    }
    setError(false);
    const href = publicCatalogHref(locale, parsed, 1);
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
      <div className={styles.filterDivider} />
      <label>
        <span>{t.make}</span>
        <select
          name="make"
          value={make}
          onChange={(e) => {
            setMake(e.target.value);
            setModel('');
            setGeneration('');
            setTrim('');
          }}
        >
          {options(filters?.makes ?? [], make)}
        </select>
      </label>
      <label>
        <span>{t.model}</span>
        <select
          name="model"
          value={model}
          disabled={!make && !model}
          onChange={(e) => {
            setModel(e.target.value);
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
            onChange={(e) => setTrim(e.target.value)}
          >
            {options(trims, trim)}
          </select>
        </label>
      )}
      <div className={styles.filterDivider} />
      <label>
        <span>{c.currency}</span>
        <select name="priceCurrency" defaultValue={query.priceCurrency ?? 'USD'}>
          {currencies.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {range(c.price, 'priceMin', 'priceMax', priceSteps)}
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
              setMake('');
              setModel('');
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
      {!filters && (
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
