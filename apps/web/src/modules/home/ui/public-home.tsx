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
  initialRetryAfter = 0,
}: {
  locale: Locale;
  home: PublicHomeSections | null;
  filters: PublicVehicleFilters['data'] | null;
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
  const facets = usePublicResource(
    `/api/v1/vehicle-filters/?${publicQueryString(publicUsdFilterQuery(locale))}`,
    initialFilters,
    PublicVehicleFiltersSchema,
    { cooldown },
  );
  const statusPhase =
    resource.phase === 'checking' || facets.phase === 'checking'
      ? 'checking'
      : resource.phase === 'error' || facets.phase === 'error'
        ? 'error'
        : 'fresh';
  function retry() {
    void resource.reload();
    if (facets.phase === 'error' && resource.retryAfter <= 0) void facets.reload();
  }
  return (
    <PublicFreshnessBoundary url={url} phase={resource.phase}>
      <HomePage
        locale={locale}
        sections={resource.data?.data.sections ?? []}
        catalogFilters={facets.data?.data ?? null}
        unavailable={!resource.data}
        retryAfter={resource.retryAfter}
        onRetry={retry}
      />
      <PublicResourceStatus
        locale={locale}
        phase={statusPhase}
        retry={retry}
        retryAfter={resource.retryAfter}
        fallbackHref={`/${locale}/`}
        floating
      />
    </PublicFreshnessBoundary>
  );
}
