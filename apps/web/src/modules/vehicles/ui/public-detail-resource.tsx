'use client';
import { useEffect, useMemo, type ReactNode } from 'react';
import { type PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { PublicFreshnessBoundary, usePublicResource } from '../application/use-public-resource';
import { liveVehicleCopy } from '../live-copy';
import { publicVehicleMessages } from '../public-messages';
import { PublicVehicleDetail } from './public-vehicle-detail';
import { PublicResourceStatus } from './public-resource-status';
import { localizedVehicleSchema } from '../localized-projection';
import { PublicCatalogLink } from './public-catalog-link';

export function PublicDetailResource({
  locale,
  vehicle,
  id,
  destinations,
  initialRetryAfter = 0,
  renderBudget,
}: {
  locale: Locale;
  vehicle: PublicVehicle | null;
  id: string;
  destinations: { slug: string; label: string }[];
  initialRetryAfter?: number;
  renderBudget?: (vehicle: PublicVehicle, current: boolean) => ReactNode;
}) {
  const initial = useMemo(
    () => (vehicle ? { data: vehicle, meta: { requestId: 'server-rendered' } } : null),
    [vehicle],
  );
  const url = `/api/v1/vehicles/${id}/?locale=${locale}&view=localized`;
  const resource = usePublicResource(url, initial, localizedVehicleSchema(locale), {
    navigationPath: `/${locale}/cars/${id}/`,
    initialRetryAfter,
  });
  useEffect(() => {
    if (!resource.missing) return;
    // A removed detail reached through history must not retain an indexable old document.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.append(meta);
    return () => {
      meta.remove();
    };
  }, [resource.missing]);
  return (
    <PublicFreshnessBoundary url={url} phase={resource.phase}>
      {resource.missing || !resource.data ? (
        <main
          id="main"
          className="public-resource-missing"
          data-testid={resource.missing ? 'public-vehicle-missing' : 'public-vehicle-unavailable'}
        >
          <h1>
            {resource.missing
              ? liveVehicleCopy[locale].missing
              : publicVehicleMessages(locale).unavailable}
          </h1>
          {!resource.missing && resource.retryAfter <= 0 && (
            <noscript>
              <a href={`/${locale}/cars/${id}/`}>{publicVehicleMessages(locale).retry}</a>
            </noscript>
          )}
          <PublicCatalogLink locale={locale} href={`/${locale}/cars/`}>
            {publicVehicleMessages(locale).back}
          </PublicCatalogLink>
        </main>
      ) : (
        <PublicVehicleDetail
          locale={locale}
          vehicle={resource.data.data}
          destinations={destinations}
          budget={renderBudget?.(resource.data.data, resource.phase === 'fresh')}
        />
      )}
      <PublicResourceStatus
        locale={locale}
        phase={resource.phase}
        retry={resource.reload}
        retryAfter={resource.retryAfter}
        fallbackHref={`/${locale}/cars/${id}/`}
        floating
      />
    </PublicFreshnessBoundary>
  );
}
