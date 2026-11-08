'use client';

import { useState, type FormEvent } from 'react';
import type { PublicVehicleFilters, PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from '../public-messages';
import { liveVehicleCopy } from '../live-copy';
import { publicCatalogHref } from '../public-presentation';
import styles from './public-vehicles.module.css';

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
    live = liveVehicleCopy[locale];
  const [make, setMake] = useState(query.make ?? '');
  const [model, setModel] = useState(query.model ?? '');
  const models = filters?.models ?? [];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      search = new URLSearchParams();
    for (const key of ['q', 'make', 'model', 'powertrain']) {
      const value = data.get(key);
      if (typeof value === 'string' && value.trim()) search.set(key, value.trim());
    }
    if (query.pageSize !== 24) search.set('pageSize', String(query.pageSize));
    search.set('page', '1');
    navigate(`/${locale}/cars/?${search}`);
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
      <h2>{live.filters}</h2>
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
      <label>
        <span>{t.make}</span>
        <select
          name="make"
          value={make}
          onChange={(event) => {
            setMake(event.target.value);
            setModel('');
          }}
        >
          <option value="">{t.all}</option>
          {filters?.makes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.count})
            </option>
          ))}
          {query.make && !filters?.makes.some((option) => option.id === query.make) && (
            <option value={query.make}>{query.make}</option>
          )}
        </select>
      </label>
      <label>
        <span>{t.model}</span>
        <select name="model" value={model} onChange={(event) => setModel(event.target.value)}>
          <option value="">{t.all}</option>
          {models
            .filter((option) => !make || option.makeId === make)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {[filters?.makes.find((item) => item.id === option.makeId)?.name, option.name]
                  .filter(Boolean)
                  .join(' — ')}{' '}
                ({option.count})
              </option>
            ))}
          {query.model && !models.some((option) => option.id === query.model) && (
            <option value={query.model}>{query.model}</option>
          )}
        </select>
      </label>
      <label>
        <span>{t.powertrain}</span>
        <select name="powertrain" defaultValue={query.powertrain ?? ''}>
          <option value="">{t.all}</option>
          {filters?.powertrains.map((option) => (
            <option key={option.id} value={option.id}>
              {t.powertrains[option.id]} ({option.count})
            </option>
          ))}
          {query.powertrain &&
            !filters?.powertrains.some((option) => option.id === query.powertrain) && (
              <option value={query.powertrain}>{t.powertrains[query.powertrain]}</option>
            )}
        </select>
      </label>
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
