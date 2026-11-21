'use client';
import { publicVehicleReference } from '@/shared/lib/public-vehicle-reference';
import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import type { PointerTiltHandlers } from '@/shared/ui/use-pointer-tilt';
import { publicVehicleTitle } from '@/shared/lib/public-vehicle-title';
import { publicVehicleMessages } from '../public-messages';
import { publicVehicleCover } from '../public-presentation';
import { PublicCatalogLink } from './public-catalog-link';
import { PublicVehicleContacts } from './public-vehicle-contacts';
import { VehiclePhoto } from './vehicle-photo';
import { VehiclePhotoStamps } from './vehicle-photo-stamps';
import { FavoriteVehicleButton } from './favorite-vehicle-button';
import { VehiclePriceValues } from './vehicle-price-values';
import styles from './public-vehicles.module.css';

export function PublicVehicleCard({
  vehicle,
  locale,
  pointerTilt,
  priorityPhoto,
}: {
  vehicle: PublicVehicleSummary;
  locale: Locale;
  pointerTilt: PointerTiltHandlers;
  priorityPhoto: boolean;
}) {
  const t = publicVehicleMessages(locale),
    cover = publicVehicleCover(vehicle);
  const title = publicVehicleTitle(vehicle, locale);
  const analyticsVehicle = vehicle.source.kind === 'demo' ? undefined : vehicle.id;
  return (
    <div className={styles.cardSlot}>
      <article
        className={styles.card}
        data-public-vehicle={vehicle.id}
        data-pointer-tilt
        {...pointerTilt}
      >
        <div className={styles.cardLight} aria-hidden="true" />
        <div className={styles.cardImage}>
          <PublicCatalogLink locale={locale} href={vehicle.detailPath} data-analytics-vehicle={analyticsVehicle} tabIndex={-1} aria-hidden="true">
            <VehiclePhoto image={cover} locale={locale} alt={cover?.alt || title.text} priority={priorityPhoto} />
            {vehicle.facts.modelYear !== null && (
              <span className={styles.year}>{vehicle.facts.modelYear}</span>
            )}
          </PublicCatalogLink>
          <VehiclePhotoStamps vehicle={vehicle} locale={locale} />
        </div>
        <FavoriteVehicleButton
          vehicleId={vehicle.id}
          title={title.text}
          locale={locale}
          className={styles.favorite}
        />
        <div className={styles.cardBody}>
          <h2 lang={title.lang} title={title.text}>
            <PublicCatalogLink locale={locale} href={vehicle.detailPath} data-analytics-vehicle={analyticsVehicle}>
              {title.text}
            </PublicCatalogLink>
          </h2>
          <p className={styles.make}>{vehicle.facts.make?.name ?? t.unknown}</p>
          <p className={styles.stockCode}>
            {t.stockCodeLabel}: <bdi>{publicVehicleReference(vehicle).code}</bdi>
          </p>
          <div className={styles.specLine}>
            <span>
              {t.mileageLabel}:{' '}
              {vehicle.facts.mileageKm === null
                ? t.unknown
                : `${vehicle.facts.mileageKm.toLocaleString(locale)} ${t.km}`}
            </span>
            <span>{t.powertrains[vehicle.facts.powertrain]}</span>
          </div>
          <div className={styles.price}>
            {vehicle.price.kind !== 'on_request' && <small>{t.priceLabels[vehicle.price.kind]}</small>}
            <VehiclePriceValues vehicle={vehicle} locale={locale} />
          </div>
          <div className={styles.cardActions}>
            <PublicVehicleContacts vehicle={vehicle} locale={locale} />
            <PublicCatalogLink
              locale={locale}
              className={styles.detailsButton}
              href={vehicle.detailPath}
              data-analytics-vehicle={analyticsVehicle}
            >
              {t.details} <Icon name="diagonal" size={16} />
            </PublicCatalogLink>
          </div>
        </div>
      </article>
    </div>
  );
}
