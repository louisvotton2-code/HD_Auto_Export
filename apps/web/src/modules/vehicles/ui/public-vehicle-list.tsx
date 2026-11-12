'use client';

import { useMemo, useRef, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  PublicVehicleFiltersSchema,
  type PublicVehicleFilters,
  type PublicVehicleList as CatalogResult,
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
  publicUsdFilterQuery,
} from '../public-query';
import { localizedListSchema } from '../localized-projection';
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
  query: initialQuery,
  initialRetryAfter = 0,
}: {
  locale: Locale;
  result: CatalogResult | null;
  filters: PublicVehicleFilters['data'] | null;
  query: PublicVehicleQuery;
  error?: boolean;
  initialRetryAfter?: number;
}) {
  const t = publicVehicleMessages(locale),
    search = useSearchParams();
  const query = useMemo(() => {
    const input: Record<string, string | string[]> = {};
    for (const key of new Set(search.keys())) {
      const all = search.getAll(key);
      input[key] = all.length > 1 ? all : all[0]!;
    }
    return parseCatalogPageQuery(input, locale);
  }, [search, locale]);
  const selected = query ?? initialQuery;
  const url = `/api/v1/vehicles/?${publicQueryString(publicUsdCatalogQuery(selected))}`;
  const cooldown = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const resource = usePublicResource(url, result, localizedListSchema(locale, 'usd'), {
    navigationPath: `/${locale}/cars/`,
    initialRetryAfter,
    cooldown,
  });
  const initialFilters = useMemo(
    () => (filters ? { data: filters, meta: { requestId: 'server-rendered' } } : null),
    [filters],
  );
  const filterUrl = `/api/v1/vehicle-filters/?${publicQueryString(publicUsdFilterQuery(locale, selected))}`;
  const facets = usePublicResource(filterUrl, initialFilters, PublicVehicleFiltersSchema, {
    cooldown,
  });
  const data = resource.data;
  const tiltLayout = useMemo(
    () => ({ data, phase: resource.phase, url }),
    [data, resource.phase, url],
  );
  const pointerTilt = usePointerTilt(tiltLayout);
  function reloadCatalog() {
    void resource.reload();
    if (facets.phase === 'error' && resource.retryAfter <= 0) void facets.reload();
  }
  function navigate(href: string) {
    if (href !== `${window.location.pathname}${window.location.search}`)
      window.history.pushState(null, '', href);
    else reloadCatalog();
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
  const appliedKey = publicCatalogHref(locale, selected);
  return (
    <PublicFreshnessBoundary phase={resource.phase} url={url}>
      <main id="main" className={styles.page} data-testid="public-vehicle-catalog">
        <div className={styles.shell}>
          <h1 className={styles.srOnly}>{t.title}</h1>
          <div className={styles.catalogLayout}>
            <aside className={styles.sidebar}>
              <PublicVehicleFiltersForm
                key={appliedKey}
                locale={locale}
                filters={facets.dataCurrent ? (facets.data?.data ?? null) : null}
                query={selected}
                pending={resource.phase === 'checking'}
                retryAfter={resource.retryAfter}
                navigate={navigate}
                onRetry={reloadCatalog}
              />
            </aside>
            <section
              className={styles.results}
              id="catalog-results"
              aria-busy={resource.phase === 'checking'}
            >
              <PublicResourceStatus
                locale={locale}
                phase={resource.phase}
                retry={reloadCatalog}
                retryAfter={resource.retryAfter}
                fallbackHref={publicCatalogHref(locale, selected)}
              />
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
