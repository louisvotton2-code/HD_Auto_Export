'use client';

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { IdSchema, PowertrainSchema } from '@hd/contracts';
import { PublicVehicleFiltersSchema } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from '@/modules/vehicles';
import { Icon } from '@/shared/ui/icon';
import { marketCopy } from './market-copy';
import { parseMarketPriceResult } from './market-api';
import { changeMarketFilter, hasDuplicateMarketFilters, hasMarketFilters, marketPriceEndpoint, marketSearchParams, readMarketDraft, validateMarketDraft } from './market-query';
import { MarketQueryForm, type MarketFiltersDraft, type MarketOptionsGroup } from './market-query-form';
import { MarketResults, type MarketResultView } from './market-results';
import { useMarketRequest } from './use-market-request';
import styles from './market-screen.module.css';

const parseOptions = (body: unknown) => PublicVehicleFiltersSchema.parse(body).data;

function useMarketOptions(locale: Locale, scope: 'makes' | 'models' | 'trims', make = '', model = ''): MarketOptionsGroup {
  const enabled = scope === 'makes' || (IdSchema.safeParse(make).success && (scope === 'models' || IdSchema.safeParse(model).success));
  const query = new URLSearchParams({ catalog: 'curated', locale, view: 'localized',
    projection: scope === 'makes' ? 'overview' : scope === 'models' ? 'models' : 'variants',
  });
  if (make) query.set('make', make);
  if (model) query.set('model', model);
  const { state, retry } = useMarketRequest(enabled ? `/api/v1/vehicle-filters/?${query}` : null, parseOptions);
  const options = state.status === 'ready' ? (state.value[scope] ?? []).map(({ id, name }) => ({ value: id, label: name })) : [];
  return { options, status: state.status, onRetry: retry };
}

function MarketLinkShare({ locale, query }: { locale: Locale; query: string }) {
  const copy = marketCopy[locale];
  const [status, setStatus] = useState<'ready' | 'copied' | 'manual'>('ready');
  const pathname = `/${locale}/market-prices/`;
  const getUrl = () => `${window.location.origin}${pathname}?${query}`;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(getUrl());
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }
  return (
    <div className={styles.toolbar}>
      <button type="button" className={styles.action} onClick={copyLink}>
        <Icon name="copy" size={16} /> {copy.share}
      </button>
      {status !== 'ready' && <span role="status" className={styles.shareNotice}>{status === 'copied' ? copy.copied : copy.manualCopy}</span>}
      {status === 'manual' && <input readOnly className={styles.shareInput} aria-label={copy.share} value={getUrl()} onFocus={event => event.currentTarget.select()} />}
    </div>
  );
}

function MarketStatus({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return <div className={styles.status} role={busy ? 'status' : 'alert'}>
    {children}{busy && <span className={styles.spinner} aria-hidden="true" />}
  </div>;
}

type FilterNames = { make?: string | null; model?: string | null; trim?: string | null };
const optionName = (options: MarketOptionsGroup['options'], value: string) => options.find(option => option.value === value)?.label;

function submittedFilters(locale: Locale, draft: MarketFiltersDraft, names: FilterNames,
  powertrains: MarketOptionsGroup['options'], result: MarketResultView) {
  const copy = marketCopy[locale];
  const label = (field: keyof FilterNames) => names[field] ?? result.vehicleNames?.[field] ?? draft[field].replace(/[-_]+/g, ' ');
  const formatKm = new Intl.NumberFormat(locale);
  function range(min: string, max: string, format: (value: string) => string = value => String(Number(value))) {
    if (!min && !max) return null;
    if (min && max) return Number(min) === Number(max) ? format(min) : `${format(min)} – ${format(max)}`;
    return min ? `≥ ${format(min)}` : `≤ ${format(max)}`;
  }
  const filters = [label('make'), label('model')];
  if (draft.trim) filters.push(label('trim'));
  const year = range(draft.yearMin, draft.yearMax);
  const mileage = range(draft.mileageMin, draft.mileageMax, value => formatKm.format(Number(value)));
  if (year) filters.push(`${copy.year} ${year}`);
  if (mileage) filters.push(`${copy.mileage} ${mileage} ${copy.km}`);
  if (draft.powertrain) filters.push(optionName(powertrains, draft.powertrain) ?? draft.powertrain);
  return filters;
}

export function MarketPricesScreen({ locale }: { locale: Locale }) {
  const copy = marketCopy[locale];
  const search = useSearchParams().toString();
  const urlParams = new URLSearchParams(search);
  const fromUrl = readMarketDraft(urlParams);
  const canonical = marketSearchParams(fromUrl).toString();
  const validUrl = !hasDuplicateMarketFilters(urlParams) && validateMarketDraft(fromUrl) === null;
  const committed = hasMarketFilters(urlParams);
  const [formState, setFormState] = useState({ search, draft: fromUrl, error: null as ReturnType<typeof validateMarketDraft>, names: {} as FilterNames });
  const current = formState.search === search ? formState : { search, draft: fromUrl, error: null, names: {} as FilterNames };
  if (current !== formState) setFormState(current);

  const { draft } = current;
  const makes = useMarketOptions(locale, 'makes');
  const models = useMarketOptions(locale, 'models', draft.make);
  const trims = useMarketOptions(locale, 'trims', draft.make, draft.model);
  const labels = publicVehicleMessages(locale).powertrains;
  const powertrains = PowertrainSchema.options.map(value => ({ value, label: labels[value] }));
  const { state, retry } = useMarketRequest(committed && validUrl ? marketPriceEndpoint(locale, canonical) : null, parseMarketPriceResult);
  const sameMake = fromUrl.make === draft.make;
  const names = {
    make: optionName(makes.options, fromUrl.make) ?? current.names.make,
    model: (sameMake ? optionName(models.options, fromUrl.model) : undefined) ?? current.names.model,
    trim: (sameMake && fromUrl.model === draft.model ? optionName(trims.options, fromUrl.trim) : undefined) ?? current.names.trim,
  };

  function submit() {
    const error = validateMarketDraft(draft);
    setFormState({ ...current, error });
    if (error) return;
    const query = marketSearchParams(draft).toString();
    if (query === search) {
      retry();
      return;
    }
    window.history.pushState(null, '', `?${query}`);
  }

  return (
    <>
      <MarketQueryForm locale={locale} draft={draft} makes={makes} models={models} trims={trims} powertrains={powertrains}
        onChange={(name, value) => setFormState({ search, draft: changeMarketFilter(draft, name, value), error: null, names })}
        onSubmit={submit} error={current.error} pending={state.status === 'loading'} />
      {committed && (
        <section className={styles.resultRegion} data-testid="market-result-region" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && <MarketStatus busy><p>{copy.loading}</p></MarketStatus>}
          {(!validUrl || state.status === 'error') && (
            <MarketStatus>
              <p>{!validUrl || (state.status === 'error' && state.code === 400) ? copy.invalid
                : state.status === 'error' && state.code === 429 ? copy.rateLimited : copy.failure}</p>
              {state.status === 'error' && state.code !== 400 && <button type="button" className={styles.action} onClick={retry}>{copy.retry}</button>}
            </MarketStatus>
          )}
          {state.status === 'ready' && <>
            <MarketLinkShare key={canonical} locale={locale} query={canonical} />
            <MarketResults locale={locale} result={state.value}
              filters={submittedFilters(locale, fromUrl, names, powertrains, state.value)} />
          </>}
        </section>
      )}
    </>
  );
}
