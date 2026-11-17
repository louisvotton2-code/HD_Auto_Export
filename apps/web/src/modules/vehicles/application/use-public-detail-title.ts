'use client';

import { useEffect, useState } from 'react';
import type { PublicVehicleInline } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicDetailTitleRevision, publicEnglishDetailTitle, type publicVehicleTitle } from '@/shared/lib/public-vehicle-title';
import { localizedInlineVehicleSchema } from '../localized-projection';
import { publicInlineVehicleView, publicQueryString } from '../public-query';

type Title = ReturnType<typeof publicVehicleTitle>;

export function usePublicDetailTitle(
  locale: Locale,
  initialVehicle: PublicVehicleInline | null,
  initialTitle: Title | undefined,
  currentVehicle: PublicVehicleInline | undefined,
  canRead: boolean,
) {
  const id = currentVehicle?.id;
  const revision = currentVehicle ? publicDetailTitleRevision(currentVehicle) : null;
  const useInitial = initialVehicle !== null && publicDetailTitleRevision(initialVehicle) === revision;
  const [fresh, setFresh] = useState<{ revision: string; title: Title }>();
  const hasFreshTitle = fresh?.revision === revision;
  useEffect(() => {
    if (!canRead || locale === 'en' || !id || !revision || useInitial || hasFreshTitle) return;
    const controller = new AbortController();
    // A manual retry or history navigation may have recovered a new public snapshot.
    const path = `/api/v1/vehicles/${id}/?${publicQueryString({ locale: 'en', ...publicInlineVehicleView(id) })}`;
    void (async () => {
      try {
        const response = await fetch(path, {
          cache: 'no-store', credentials: 'omit', redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        const { data } = localizedInlineVehicleSchema('en', 'usd').parse(await response.json());
        if (controller.signal.aborted || publicDetailTitleRevision(data) !== revision) return;
        const title = publicEnglishDetailTitle(data);
        if (title) setFresh({ revision, title });
      } catch {
        // The live localized details are still usable without the English title.
      }
    })();
    return () => controller.abort();
  }, [canRead, id, locale, revision, useInitial, hasFreshTitle]);

  return useInitial ? initialTitle : fresh?.revision === revision ? fresh.title : undefined;
}
