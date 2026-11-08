'use client';
import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import type { PointerTiltHandlers } from '@/shared/ui/use-pointer-tilt';
import { usePublicFreshness } from '../application/use-public-resource';
import { publicVehicleMessages } from '../public-messages';
import {
  formatPublicVehiclePrice,
  publicAvailabilityLabel,
  publicVehicleCover,
} from '../public-presentation';
import { PublicCatalogLink } from './public-catalog-link';
import { PublicVehicleContacts } from './public-vehicle-contacts';
import { FavoriteVehicleButton } from './favorite-vehicle-button';
import styles from './public-vehicles.module.css';

export function PublicVehicleCard({
  vehicle,
  locale,
  pointerTilt,
}: {
  vehicle: PublicVehicle;
  locale: Locale;
  pointerTilt: PointerTiltHandlers;
}) {
  const t = publicVehicleMessages(locale),
    cover = publicVehicleCover(vehicle);
  const trusted = usePublicFreshness() === 'fresh';
  const availability = trusted ? publicAvailabilityLabel(vehicle, locale) : '';
  return (
    <div className={styles.cardSlot}>
      <article
        className={styles.card}
        data-public-vehicle={vehicle.id}
        data-pointer-tilt
        {...pointerTilt}
      >
        <div className={styles.cardLight} aria-hidden="true" />
        <PublicCatalogLink
          locale={locale}
          href={vehicle.detailPath}
          className={styles.cardImage}
          tabIndex={-1}
          aria-hidden="true"
        >
          <img
            src={cover.url}
            alt={cover.alt || vehicle.content.title.text}
            loading="lazy"
            width={cover.width}
            height={cover.height}
          />
          {vehicle.facts.modelYear !== null && (
            <span className={styles.year}>{vehicle.facts.modelYear}</span>
          )}
        </PublicCatalogLink>
        <FavoriteVehicleButton
          vehicleId={vehicle.id}
          title={vehicle.content.title.text}
          locale={locale}
          className={styles.favorite}
        />
        <div className={styles.cardBody}>
          <h2 title={vehicle.content.title.text}>
            <PublicCatalogLink locale={locale} href={vehicle.detailPath}>
              {vehicle.content.title.text}
            </PublicCatalogLink>
          </h2>
          <p className={styles.make}>{vehicle.facts.make?.name ?? t.unknown}</p>
          <p className={styles.stockCode}>
            {t.stockCodeLabel}: <bdi>{vehicle.stockCode}</bdi>
          </p>
          {availability && (
            <p className={styles.status} data-availability={vehicle.availability}>
              {availability}
            </p>
          )}
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
            {vehicle.price.kind !== 'on_request' && (
              <small>{t.priceLabels[vehicle.price.kind]}</small>
            )}
            <strong>{formatPublicVehiclePrice(vehicle, locale)}</strong>
          </div>
          <div className={styles.cardActions}>
            <PublicVehicleContacts vehicle={vehicle} locale={locale} />
            <PublicCatalogLink
              locale={locale}
              className={styles.detailsButton}
              href={vehicle.detailPath}
            >
              {t.details} <span aria-hidden="true">↗</span>
            </PublicCatalogLink>
          </div>
        </div>
      </article>
    </div>
  );
}
