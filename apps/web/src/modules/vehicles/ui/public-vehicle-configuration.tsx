'use client';

import type { PublicVehicle } from '@hd/contracts/public';
import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { usePublicVehicleSegment } from '../application/use-public-vehicle-segment';
import { configurationSegmentCopy } from '../configuration-segment-copy';
import { externalDetailCopy } from '../external-detail-copy';
import { VehicleConfiguration } from './vehicle-configuration';
import { VehicleEquipment } from './vehicle-equipment';
import styles from './public-vehicle-configuration.module.css';

/** The public segment replaces the preview seed; private staff preview keeps its own payload. */
export function PublicVehicleConfiguration({ vehicle, locale }: { vehicle: PublicVehicle; locale: Locale }) {
  const segment = usePublicVehicleSegment('configuration', vehicle, locale);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const copy = configurationSegmentCopy[locale];
  const loading = segment.phase === 'loading';
  const changed = segment.phase === 'changed';
  const missing = segment.phase === 'missing';
  const waiting = segment.retryAfter > 0;
  const blocked = loading || waiting;
  const loaded = segment.items.length.toLocaleString(locale);
  const count = segment.total === null
    ? copy.loaded.replace('{loaded}', loaded)
    : copy.count.replace('{loaded}', loaded).replace('{total}', segment.total.toLocaleString(locale));
  const reload = changed || (segment.started && !segment.hasMore && segment.phase === 'ready');
  const action = reload ? segment.restart : segment.loadMore;
  const label = loading ? copy.loading
    : waiting ? copy.retryIn.replace('{seconds}', segment.retryAfter.toLocaleString(locale))
      : reload ? copy.reload
        : segment.phase === 'error' ? copy.retry
          : segment.started ? copy.loadMore : copy.loadAll;

  if (missing) return <div className={styles.controls} role="status" data-public-configuration-segment data-segment-phase="missing">
    <p>{copy.missing}</p>
  </div>;

  return <div className={styles.wrapper} data-public-configuration-segment data-segment-phase={segment.phase} aria-busy={loading}>
    {!segment.started ? (
      vehicle.configuration
        ? <VehicleConfiguration configuration={vehicle.configuration} locale={locale} />
        : <VehicleEquipment specifications={vehicle.external?.detail?.specifications ?? []} title={externalDetailCopy[locale].specifications} locale={locale} />
    ) : !changed && segment.items.length > 0 ? (
      // Segment entries use the same display fields. Do not reapply the seed's 200-item schema limit.
      <VehicleConfiguration configuration={{ version: 1, items: segment.items }} locale={locale} />
    ) : null}
    <div className={styles.controls} data-segment-changed={changed || undefined}>
      <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {changed ? <p>{copy.changed}</p> : <>
          {segment.started && <p data-configuration-loaded={segment.items.length} data-configuration-total={segment.total ?? undefined}>
            {segment.phase === 'ready' && segment.total === 0 ? copy.empty : count}
          </p>}
          {loading && <p>{copy.loading}</p>}
          {segment.phase === 'error' && <p>{copy.error}</p>}
        </>}
      </div>
      {mounted && <button type="button" className={styles.button} onClick={action} disabled={blocked}>{label}</button>}
      <noscript><p className={styles.noScript}>{copy.enableDetails}</p></noscript>
    </div>
  </div>;
}
