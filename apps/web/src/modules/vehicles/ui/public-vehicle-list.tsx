'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  PublicVehicleFiltersSchema,
  type PublicVehicleFilters,
  type PublicVehicleCardList as CatalogResult,
  type PublicVehicleQuery,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { usePointerTilt } from '@/shared/ui/use-pointer-tilt';
import { publicVehicleMessages } from '../public-messages';
import { publicCatalogHref } from '../public-presentation';
import {
  parseCatalogPageQuery,
  publicQueryString,
  publicUsdCatalogQuery,
} from '../public-query';
import { catalogFacetOverviewSchema, catalogFacetUrl, type CatalogFacetOverview } from '../catalog-facets';
import { localizedCardListSchema } from '../localized-projection';
import { PublicFreshnessBoundary, usePublicResource } from '../application/use-public-resource';
import { PublicVehicleCard } from './public-vehicle-card';
import { PublicVehicleFiltersForm } from './public-vehicle-filters';
import { PublicResourceStatus } from './public-resource-status';
import { VehicleRateAttribution } from './vehicle-rate-attribution';
import { CatalogPagination } from './catalog-pagination';
import styles from './public-vehicles.module.css';

export function PublicVehicleList({
  locale,
  result,
  filters,
  initialBrandFilters,
  initialModelFilters,
  query: initialQuery,
  initialRetryAfter = 0,
}: {
  locale: Locale;
  result: CatalogResult | null;
  filters: CatalogFacetOverview | null;
  initialBrandFilters: PublicVehicleFilters | null;
  initialModelFilters: PublicVehicleFilters | null;
  query: PublicVehicleQuery;
  error?: boolean;
  initialRetryAfter?: number;
}) {
  const t = publicVehicleMessages(locale),
    search = useSearchParams();
  const pathname = usePathname();
  const locationKey = `${pathname}${search.size ? `?${search.toString()}` : ''}`;
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
    return parseCatalogPageQuery(input, locale);
  }, [search, locale]);
  const selected = query ?? initialQuery;
  const appliedKey = publicCatalogHref(locale, selected);
  const [draftParents, setDraftParents] = useState<{ appliedKey: string; make: string; model: string } | null>(null);
  const parents = draftParents?.appliedKey === appliedKey ? draftParents : null;
  if (draftParents && !parents) setDraftParents(null);
  const make = parents?.make ?? selected.make ?? '';
  const model = parents?.model ?? selected.model ?? '';
  const url = `/api/v1/vehicles/?${publicQueryString(publicUsdCatalogQuery(selected))}`;
  const cooldown = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const resource = usePublicResource(url, result, localizedCardListSchema(locale, 'usd'), {
    navigationPath: `/${locale}/cars/`,
    initialRetryAfter,
    cooldown,
  });
  const filterUrl = catalogFacetUrl(locale, selected, {
    selectedModel: selected.make ? undefined : selected.model,
  });
  const facets = usePublicResource(filterUrl, filters, catalogFacetOverviewSchema, { cooldown });
  const brand = usePublicResource(
    make ? catalogFacetUrl(locale, selected, { make }) : null,
    initialBrandFilters, PublicVehicleFiltersSchema, { cooldown },
  );
  const modelOptions = usePublicResource(
    make && model ? catalogFacetUrl(locale, selected, { make, model }) : null,
    initialModelFilters, PublicVehicleFiltersSchema, { cooldown },
  );
  const facetOverview = facets.dataCurrent ? facets.data : null;
  const brandFilters = brand.dataCurrent ? brand.data?.data : null;
  const modelFilters = modelOptions.dataCurrent ? modelOptions.data?.data ?? null : null;
  const brandPhase = make && !brandFilters ? brand.phase : undefined;
  const modelPhase = make && model && !modelFilters ? modelOptions.phase : undefined;
  const scopedPhase = brandPhase === 'checking' || modelPhase === 'checking' ? 'checking'
    : brandPhase === 'error' || modelPhase === 'error' ? 'error'
      : undefined;
  function reloadScopedFilters() {
    if (brandPhase === 'error') void brand.reload();
    if (modelPhase === 'error') void modelOptions.reload();
  }
  const data = resource.data;
  const phase = navigationFrom !== null ? 'checking' : resource.phase;
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
      document
        .getElementById('catalog-results')
        ?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  return (
    <PublicFreshnessBoundary phase={phase} url={url}>
      <main id="main" className={styles.page} data-testid="public-vehicle-catalog">
        <div className={styles.shell}>
          <h1 className={styles.srOnly}>{t.title}</h1>
          <div className={styles.catalogLayout}>
            <aside className={styles.sidebar}>
              <PublicVehicleFiltersForm
                key={appliedKey}
                locale={locale}
                filters={facetOverview?.data ?? null}
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
                onRetry={reloadCatalog}
              />
            </aside>
            <section
              className={styles.results}
              id="catalog-results"
              aria-busy={phase === 'checking'}
            >
              <div className={styles.catalogStatus}>
                <PublicResourceStatus
                  locale={locale}
                  phase={phase}
                  retry={reloadCatalog}
                  retryAfter={resource.retryAfter}
                  fallbackHref={publicCatalogHref(locale, selected)}
                />
              </div>
              {!query || !data ? (
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
