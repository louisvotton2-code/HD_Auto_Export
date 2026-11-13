'use client';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { VehicleSegmentContext } from '../application/use-public-vehicle-segment';
import { type PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { PublicFreshnessBoundary, usePublicResource } from '../application/use-public-resource';
import { liveVehicleCopy } from '../live-copy';
import { publicVehicleMessages } from '../public-messages';
import { PublicVehicleDetail } from './public-vehicle-detail';
import { PublicResourceStatus } from './public-resource-status';
import { localizedVehicleSchema } from '../localized-projection';
import { publicQueryString, publicUsdView } from '../public-query';
import { PublicCatalogLink } from './public-catalog-link';
import type { VehicleDestination } from './vehicle-gallery';

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
  destinations: VehicleDestination[];
  initialRetryAfter?: number;
  renderBudget?: (vehicle: PublicVehicle, current: boolean) => ReactNode;
}) {
  const initial = useMemo(
    () => (vehicle ? { data: vehicle, meta: { requestId: 'server-rendered' } } : null),
    [vehicle],
  );
  const url = `/api/v1/vehicles/${id}/?${publicQueryString({ locale, ...publicUsdView })}`;
  const cooldown = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const resource = usePublicResource(url, initial, localizedVehicleSchema(locale, 'usd'), {
    navigationPath: `/${locale}/cars/${id}/`,
    initialRetryAfter,
    cooldown,
  });
  const segmentContext = useMemo(() => ({ cooldown, onMissing: resource.markMissing }), [resource.markMissing]);
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
      <VehicleSegmentContext value={segmentContext}>
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
      </VehicleSegmentContext>
    </PublicFreshnessBoundary>
  );
}
