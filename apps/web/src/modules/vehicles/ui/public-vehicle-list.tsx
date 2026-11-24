'use client';

import {
  Component, createRef, useEffect, useMemo, useRef, useState,
  type MouseEvent, type ReactNode, type RefObject,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  publicCatalogSearchIssue,
  PublicVehicleFiltersSchema,
  type PublicVehicleFilters,
  type PublicVehicleCardList as CatalogResult,
  type PublicVehicleQuery,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { recordPublicAnalyticsAction } from '@/shared/lib/public-analytics-actions';
import { currentAnalyticsGrant } from '@/shared/lib/tracking-consent';
import { usePointerTilt } from '@/shared/ui/use-pointer-tilt';
import { publicVehicleMessages } from '../public-messages';
import { publicCatalogHref, publicVehicleCover } from '../public-presentation';
import {
  parseCatalogPageRequest,
  publicQueryString,
  publicUsdCatalogQuery,
} from '../public-query';
import { catalogFacetOverviewSchema, catalogFacetOverviewScope, catalogFacetUrl, type CatalogFacetOverview } from '../catalog-facets';
import { localizedCardListSchema } from '../localized-projection';
import { PublicFreshnessBoundary, usePublicResource, type PublicFreshness } from '../application/use-public-resource';
import { PublicVehicleCard } from './public-vehicle-card';
import { PublicVehicleFiltersForm } from './public-vehicle-filters';
import { PublicResourceStatus } from './public-resource-status';
import { VehicleRateAttribution } from './vehicle-rate-attribution';
import { CatalogPagination } from './catalog-pagination';
import styles from './public-vehicles.module.css';

type CatalogSidebarProps = {
  results: RefObject<HTMLElement | null>;
  filterPhase: PublicFreshness;
  brandPhase: PublicFreshness | undefined;
  modelPhase: PublicFreshness | undefined;
  preserveScroll: boolean;
  children: ReactNode;
};

class CatalogSidebar extends Component<CatalogSidebarProps, object, number | null> {
  private sidebar = createRef<HTMLElement>();

  getSnapshotBeforeUpdate(previous: CatalogSidebarProps) {
    const { preserveScroll, filterPhase, brandPhase, modelPhase, results } = this.props;
    if (!preserveScroll || (previous.filterPhase === filterPhase &&
        previous.brandPhase === brandPhase && previous.modelPhase === modelPhase)) return null;
    const sidebar = this.sidebar.current;
    const position = results.current?.getBoundingClientRect();
    if (!sidebar || !position || sidebar.contains(document.activeElement) ||
        position.top >= window.innerHeight || position.bottom <= 0 ||
        sidebar.getBoundingClientRect().bottom > position.top) return null;
    // On stacked layouts the filters can grow above the cards while they are being read.
    return position.top;
  }

  componentDidUpdate(_previous: CatalogSidebarProps, _state: object, previousTop: number | null) {
    if (previousTop === null) return;
    const position = this.props.results.current?.getBoundingClientRect();
    if (!position) return;
    const delta = position.top - previousTop;
    if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: 'instant' });
  }

  render() {
    return <aside ref={this.sidebar} className={styles.sidebar}>{this.props.children}</aside>;
  }
}

export function PublicVehicleList({
  locale,
  result,
  filters,
  initialBrandFilters,
  initialModelFilters,
  query: initialQuery,
  initialRetryAfter = 0,
  deferFilters = false,
}: {
  locale: Locale;
  result: CatalogResult | null;
  filters: CatalogFacetOverview | null;
  initialBrandFilters: PublicVehicleFilters | null;
  initialModelFilters: PublicVehicleFilters | null;
  query: PublicVehicleQuery;
  error?: boolean;
  initialRetryAfter?: number;
  deferFilters?: boolean;
}) {
  const t = publicVehicleMessages(locale),
    search = useSearchParams();
  const pathname = usePathname();
  const locationKey = `${pathname}${search.size ? `?${search.toString()}` : ''}`;
  const results = useRef<HTMLElement>(null);
  // Next commits native history updates in a transition. Keep click feedback urgent while it does.
  const [navigationFrom, setNavigationFrom] = useState<string | null>(null);
  useEffect(() => {
    if (navigationFrom !== null && navigationFrom !== locationKey) setNavigationFrom(null);
  }, [locationKey, navigationFrom]);
  const query = useMemo(() => {
    const input: Record<string, string | string[]> = {};
    for (const key of new Set(search.keys())) {
      const all = search.getAll(key);
      input[key] = all.length > 1 ? all : all[0]!;
    }
    const request = parseCatalogPageRequest(input, locale);
    return request && request.kind !== 'offset_limit' ? request.query : null;
  }, [search, locale]);
  const selected = query ?? initialQuery;
  const shortSearch = Boolean(publicCatalogSearchIssue(selected));
  const appliedKey = publicCatalogHref(locale, selected);
  const [draftParents, setDraftParents] = useState<{ appliedKey: string; make: string; model: string } | null>(null);
  const parents = draftParents?.appliedKey === appliedKey ? draftParents : null;
  if (draftParents && !parents) setDraftParents(null);
  const make = parents?.make ?? selected.make ?? '';
  const model = parents?.model ?? selected.model ?? '';
  const url = shortSearch ? null : `/api/v1/vehicles/?${publicQueryString(publicUsdCatalogQuery(selected))}`;
  const cooldown = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const navigationOptions = { navigationPath: `/${locale}/cars/`, navigationSearch: search.toString(), cooldown };
  const resource = usePublicResource(url, result, localizedCardListSchema(locale, 'usd'), {
    ...navigationOptions,
    initialRetryAfter,
  });
  const filterUrl = shortSearch ? null : catalogFacetUrl(locale, catalogFacetOverviewScope(selected), {
    selectedModel: selected.make ? undefined : selected.model,
  });
  const facetOptions = { ...navigationOptions, loadOnMount: deferFilters };
  const facets = usePublicResource(filterUrl, filters, catalogFacetOverviewSchema, facetOptions);
  const brand = usePublicResource(
    !shortSearch && make ? catalogFacetUrl(locale, selected, { make }) : null,
    initialBrandFilters, PublicVehicleFiltersSchema, facetOptions,
  );
  const modelOptions = usePublicResource(
    !shortSearch && make && model ? catalogFacetUrl(locale, selected, { make, model }) : null,
    initialModelFilters, PublicVehicleFiltersSchema, facetOptions,
  );
  // Previously loaded options let a shopper add a brand to a short keyword without fetching an unscoped search.
  const facetOverview = shortSearch || facets.dataCurrent ? facets.data : null;
  const brandFilters = brand.dataCurrent ? brand.data?.data : null;
  const modelFilters = modelOptions.dataCurrent ? modelOptions.data?.data ?? null : null;
  const brandPhase = !shortSearch && make && !brandFilters ? brand.phase : undefined;
  const modelPhase = !shortSearch && make && model && !modelFilters ? modelOptions.phase : undefined;
  const scopedPhase = brandPhase === 'checking' || modelPhase === 'checking' ? 'checking'
    : brandPhase === 'error' || modelPhase === 'error' ? 'error'
      : undefined;
  function reloadScopedFilters() {
    if (brandPhase === 'error') void brand.reload();
    if (modelPhase === 'error') void modelOptions.reload();
  }
  const data = shortSearch ? null : resource.data;
  const phase = shortSearch ? 'fresh' : navigationFrom !== null ? 'checking' : resource.phase;
  const submittedFilter = useRef<{ target: string; from: typeof data; grant: number } | null>(null);
  function recordFilterSubmit(target: string) {
    const grant = currentAnalyticsGrant();
    if (grant === null) return;
    submittedFilter.current = { target, from: data, grant };
    recordPublicAnalyticsAction('filter_submit');
  }
  useEffect(() => {
    const attempt = submittedFilter.current;
    if (!attempt || phase === 'checking') return;
    if (attempt.target !== appliedKey || attempt.grant !== currentAnalyticsGrant()) {
      submittedFilter.current = null;
      return;
    }
    if (phase === 'error') {
      submittedFilter.current = null;
    } else if (data && data !== attempt.from) {
      submittedFilter.current = null;
      if (data.meta.freshness === 'fresh' && data.meta.totalKind === 'exact' &&
          data.meta.total === 0 && data.data.items.length === 0) {
        recordPublicAnalyticsAction('search_zero_results');
      }
    }
  }, [phase, appliedKey, data]);
  const tiltLayout = useMemo(
    () => ({ data, phase, url }),
    [data, phase, url],
  );
  const pointerTilt = usePointerTilt(tiltLayout);
  function reloadCatalog() {
    void resource.reload();
    if (facets.phase === 'error' && resource.retryAfter <= 0) void facets.reload();
  }
  function navigate(href: string) {
    const destination = new URL(href, window.location.href);
    const next = `${destination.pathname}${destination.search}`;
    if (next === `${window.location.pathname}${window.location.search}`) {
      reloadCatalog();
      return;
    }
    setNavigationFrom(locationKey);
    window.history.pushState(null, '', next);
  }
  function pageClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button === 0 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      navigate(event.currentTarget.href);
      results.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  const firstPhotoId = data?.data.items.find((vehicle) => publicVehicleCover(vehicle))?.id;
  return (
    <PublicFreshnessBoundary phase={phase} url={url}>
      <main id="main" className={styles.page} data-testid="public-vehicle-catalog">
        <div className={styles.shell}>
          <h1 className={styles.catalogTitle}>{t.title}</h1>
          <div className={styles.catalogLayout}>
            <CatalogSidebar
              results={results}
              filterPhase={facets.phase}
              brandPhase={brandPhase}
              modelPhase={modelPhase}
              preserveScroll={deferFilters}
            >
              <PublicVehicleFiltersForm
                key={appliedKey}
                locale={locale}
                filters={facetOverview?.data ?? null}
                filtersPending={!shortSearch && facets.phase === 'checking'}
                shortKeyword={shortSearch}
                brandModels={make ? brandFilters?.models ?? [] : facetOverview?.data.models ?? []}
                brandPending={brandPhase === 'checking'}
                modelFilters={modelFilters}
                showModelOptions={{
                  trim: facetOverview?.hasTrims ?? false,
                  generation: facetOverview?.hasGenerations ?? false,
                }}
                modelFiltersPhase={scopedPhase}
                onRetryModelFilters={reloadScopedFilters}
                query={selected}
                make={make}
                model={model}
                onModelScopeChange={(make, model) => setDraftParents({ appliedKey, make, model })}
                pending={phase === 'checking'}
                retryAfter={Math.max(resource.retryAfter, brand.retryAfter, modelOptions.retryAfter)}
                navigate={navigate}
                onSubmitFilters={recordFilterSubmit}
                onRetry={reloadCatalog}
              />
            </CatalogSidebar>
            <section
              className={styles.results}
              id="catalog-results"
              ref={results}
              aria-busy={phase === 'checking'}
            >
              {!shortSearch && <div className={styles.catalogStatus}>
                <PublicResourceStatus
                  locale={locale}
                  phase={phase}
                  retry={reloadCatalog}
                  retryAfter={resource.retryAfter}
                  fallbackHref={publicCatalogHref(locale, selected)}
                />
              </div>}
              {shortSearch ? null : !query || !data ? (
                <div className={styles.state} role="alert" data-testid="public-catalog-error">
                  <p>{t.unavailable}</p>
                  <a
                    href={resource.retryAfter > 0 ? undefined : publicCatalogHref(locale, selected)}
                    aria-disabled={resource.retryAfter > 0 || undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      if (resource.retryAfter <= 0) reloadCatalog();
                    }}
                  >
                    {t.retry}
                  </a>
                </div>
              ) : (
                <>
                  {data.meta.freshness === 'stale' && <p className={styles.notice}>{t.stale}</p>}
                  {data.data.items.length ? (
                    <div className={styles.grid}>
                      {data.data.items.map((vehicle) => (
                        <PublicVehicleCard
                          key={vehicle.id}
                          vehicle={vehicle}
                          locale={locale}
                          pointerTilt={pointerTilt}
                          priorityPhoto={vehicle.id === firstPhotoId}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className={styles.state} data-testid="public-catalog-empty">
                      <p>{t.empty}</p>
                      <a href={`/${locale}/cars/`} onClick={pageClick}>
                        {t.reset}
                      </a>
                    </div>
                  )}
                  <VehicleRateAttribution vehicles={data.data.items} locale={locale} />
                  <div className={styles.resultsHeading}>
                    <p className={styles.count} aria-live="polite">
                      {data.meta.totalKind === 'exact' && data.meta.total !== null
                        ? `${data.meta.total.toLocaleString(locale)} ${t.results}`
                        : `${t.totalUnknown}: ${data.data.items.length.toLocaleString(locale)}`}
                    </p>
                  </div>
                  <CatalogPagination result={data} query={selected} locale={locale} onPageClick={pageClick} />
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </PublicFreshnessBoundary>
  );
}
