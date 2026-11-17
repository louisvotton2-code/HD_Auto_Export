'use client';

import type { Locale } from '@/i18n/routing';
import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import { Icon } from '@/shared/ui/icon';
import { usePublicFreshness } from '../application/use-public-resource';
import { publicAvailabilityLabel } from '../public-presentation';
import styles from './vehicle-photo-stamps.module.css';

const featuredLabel: Record<Locale, string> = { zh: '精选', en: 'Featured', ru: 'Наш выбор' };

export function VehiclePhotoStamps({
  vehicle,
  locale,
  placement = 'card',
}: {
  vehicle: Pick<PublicVehicleSummary, 'availability' | 'source'>;
  locale: Locale;
  placement?: 'card' | 'compact' | 'gallery';
}) {
  const fresh = usePublicFreshness() === 'fresh';
  const status = fresh ? publicAvailabilityLabel(vehicle, locale) : '';
  const featured = vehicle.source.kind === 'manual';
  if (!status && !featured) return null;

  return (
    <div className={styles.stamps} data-vehicle-stamps={placement}>
      {featured && (
        <span className={styles.stamp} data-vehicle-stamp="featured">
          <Icon name="shield" size={12} />
          {featuredLabel[locale]}
        </span>
      )}
      {status && (
        <span className={styles.stamp} data-vehicle-stamp={vehicle.availability} data-availability={vehicle.availability}>
          <Icon name={vehicle.availability === 'reserved' ? 'clock' : 'check'} size={12} />
          {status}
        </span>
      )}
    </div>
  );
}
