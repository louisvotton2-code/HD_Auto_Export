'use client';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { VehicleSegmentContext } from '../application/use-public-vehicle-segment';
import { type PublicVehicleInline } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicDetailTitle } from '@/shared/lib/public-vehicle-title';
import { subscribePublicNavigation } from '@/shared/lib/public-navigation-events';
import { PublicFreshnessBoundary, usePublicResource } from '../application/use-public-resource';
import { liveVehicleCopy } from '../live-copy';
import { publicVehicleMessages } from '../public-messages';
import { PublicVehicleDetail } from './public-vehicle-detail';
import { PublicResourceStatus } from './public-resource-status';
import { localizedInlineVehicleSchema } from '../localized-projection';
import { publicQueryString, publicInlineVehicleView } from '../public-query';
import { VehicleCatalogReturnLink } from './vehicle-catalog-return-link';
import type { VehicleDestination } from './vehicle-gallery';

export function PublicDetailResource({
  locale,
  vehicle,
  id,
  includePixel = false,
  includeSeo = false,
  destinations,
  initialRetryAfter = 0,
  renderBudget,
}: {
  locale: Locale;
  vehicle: PublicVehicleInline | null;
  id: string;
  includePixel?: boolean;
  includeSeo?: boolean;
  destinations: VehicleDestination[];
  initialRetryAfter?: number;
  renderBudget?: (vehicle: PublicVehicleInline, current: boolean, engineCc: number | null) => ReactNode;
}) {
  const initial = useMemo(
    () => (vehicle ? { data: vehicle, meta: { requestId: 'server-rendered' } } : null),
    [vehicle],
  );
  const detailUrl = (query: ReturnType<typeof publicInlineVehicleView>) =>
    `/api/v1/vehicles/${id}/?${publicQueryString({ locale, ...query })}`;
  const url = detailUrl(publicInlineVehicleView(id, locale, { includePixel, includeSeo }));
  const compatibilityUrl = includePixel || includeSeo ? detailUrl(publicInlineVehicleView(id, locale)) : undefined;
  const detailPath = `/${locale}/cars/${id}/`;
  const restoreGalleryFocus = useRef<number | null>(null);
  const cooldown = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const resource = usePublicResource(url, initial, localizedInlineVehicleSchema(locale, 'usd'), {
    navigationPath: detailPath,
    compatibilityUrl,
    initialRetryAfter,
    cooldown,
  });
  const detailVehicle = resource.phase === 'fresh' ? resource.data?.data : undefined;
  const segmentContext = useMemo(() => ({ cooldown, onMissing: resource.markMissing }), [resource.markMissing]);
  useEffect(() => subscribePublicNavigation((signal) => {
    if (signal.ready) return;
    // The refresh temporarily unmounts the gallery. Remember a viewer this navigation closes.
    restoreGalleryFocus.current = signal.path === detailPath &&
      document.querySelector('[data-public-vehicle-detail] [data-vehicle-gallery] dialog[open]')
      ? signal.id : null;
  }), [detailPath]);
  useEffect(() => {
    if (!detailVehicle) return;
    const element = document.querySelector<HTMLElement>('[data-public-vehicle-detail]');
    if (element?.dataset.publicVehicleDetail === id) {
      element.style.removeProperty('visibility');
      element.inert = false;
      if (restoreGalleryFocus.current === resource.navigation) {
        restoreGalleryFocus.current = null;
        if (document.activeElement === document.body)
          element.querySelector<HTMLElement>('[data-vehicle-gallery-empty]')?.focus({ preventScroll: true });
      }
    }
  }, [detailVehicle, id, resource.navigation]);
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
      {resource.missing || !detailVehicle ? (
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
          <VehicleCatalogReturnLink locale={locale}>
            {publicVehicleMessages(locale).back}
          </VehicleCatalogReturnLink>
        </main>
      ) : (
        <PublicVehicleDetail
          locale={locale}
          vehicle={detailVehicle}
          pixelEnabled={includePixel && detailVehicle.pixelEnabled === true}
          pixelNavigation={includePixel ? resource.navigation : undefined}
          detailTitle={publicDetailTitle(detailVehicle, locale)}
          destinations={destinations}
          renderBudget={renderBudget && ((engineCc) => renderBudget(detailVehicle, resource.phase === 'fresh', engineCc))}
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
