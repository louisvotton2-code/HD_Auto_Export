'use client';
import { useMemo, useRef } from 'react';
import {
  type PublicHomeSections,
  type PublicVehicleFilters,
  PublicVehicleFiltersSchema,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import {
  PublicFreshnessBoundary,
  usePublicResource,
  PublicResourceStatus,
  localizedHomeSchema,
  publicQueryString,
  publicUsdFilterQuery,
  publicUsdView,
} from '@/modules/vehicles';
import { HomePage } from './home-page';

export function PublicHome({
  locale,
  home,
  filters,
  modelFilters,
  catalogTotal,
  initialRetryAfter = 0,
}: {
  locale: Locale;
  home: PublicHomeSections | null;
  filters: PublicVehicleFilters['data'] | null;
  modelFilters: PublicVehicleFilters['data'] | null;
  catalogTotal: number | null;
  initialRetryAfter?: number;
}) {
  const projection = { locale, ...publicUsdView };
  const url = `/api/v1/home/vehicles/?${publicQueryString(projection)}`;
  const cooldown = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const resource = usePublicResource(url, home, localizedHomeSchema(locale, 'usd'), {
    navigationPath: `/${locale}/`,
    initialRetryAfter,
    cooldown,
  });
  const initialFilters = useMemo(
    () => (filters ? { data: filters, meta: { requestId: 'server-rendered' } } : null),
    [filters],
  );
  const initialModels = useMemo(
    () => (modelFilters ? { data: modelFilters, meta: { requestId: 'server-rendered' } } : null),
    [modelFilters],
  );
  const filterQuery = publicUsdFilterQuery(locale);
  const facets = usePublicResource(
    `/api/v1/vehicle-filters/?${publicQueryString({ ...filterQuery, projection: 'overview' })}`,
    initialFilters,
    PublicVehicleFiltersSchema,
    { cooldown },
  );
  const models = usePublicResource(
    `/api/v1/vehicle-filters/?${publicQueryString({ ...filterQuery, projection: 'home-models' })}`,
    initialModels,
    PublicVehicleFiltersSchema,
    { navigationPath: `/${locale}/`, cooldown },
  );
  const resources = [resource, facets, models];
  const retryAfter = Math.max(...resources.map((entry) => entry.retryAfter));
  const statusPhase =
    resources.some((entry) => entry.phase === 'checking')
      ? 'checking'
      : resources.some((entry) => entry.phase === 'error')
        ? 'error'
        : 'fresh';
  function retry() {
    if (retryAfter > 0) return;
    const retryFeatured = resource.phase === 'error';
    if (retryFeatured) void resource.reload();
    if (retryFeatured || models.phase === 'error') void models.reload();
    if (facets.phase === 'error') void facets.reload();
  }
  return (
    <PublicFreshnessBoundary url={url} phase={resource.phase}>
      <HomePage
        locale={locale}
        sections={resource.data?.data.sections ?? []}
        catalogFilters={facets.data?.data ?? null}
        catalogModels={models.data?.data.models}
        catalogTotal={facets.data?.data.total ?? catalogTotal}
        unavailable={!resource.data}
        retryAfter={retryAfter}
        onRetry={retry}
      />
      <PublicResourceStatus
        locale={locale}
        phase={statusPhase}
        retry={retry}
        retryAfter={retryAfter}
        fallbackHref={`/${locale}/`}
        floating
      />
    </PublicFreshnessBoundary>
  );
}
