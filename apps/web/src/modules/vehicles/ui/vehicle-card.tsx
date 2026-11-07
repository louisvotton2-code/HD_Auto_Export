import Link from 'next/link';
import type { Locale } from '@/i18n/routing';
import type { Vehicle } from '../types';
import { vehicleMessages } from '../messages';
import { VehicleContactActions } from './vehicle-contact-actions';
import styles from './vehicles.module.css';

export function VehicleCard({ vehicle, locale }: { vehicle: Vehicle; locale: Locale }) {
  const t = vehicleMessages(locale);
  return (
    <article className={styles.card}>
      <Link href={`/${locale}/cars/${vehicle.slug}/`} className={styles.cardLink}>
        <div className={styles.cardImage}>
          <img src={vehicle.image} alt={vehicle.imageAlt} loading="lazy" />
          <span>
            {t.demo}
            {vehicle.sampleOrigin === 'reference-korea' ? ` · ${t.referenceLabel}` : ''}
          </span>
        </div>
        <div className={styles.cardContent}>
          <p className={styles.make}>{vehicle.make}</p>
          <h2>{vehicle.model}</h2>
          <div className={styles.specLine}>
            <span>{vehicle.year}</span>
            <span>
              {vehicle.mileageKm.toLocaleString(locale)} {t.km}
            </span>
            <span>{t[vehicle.fuel]}</span>
          </div>
          <div className={styles.cardBottom}>
            <div>
              <small>{t.demoPrice}</small>
              <strong>${vehicle.priceUsd.toLocaleString('en-US')}</strong>
            </div>
            <span className={styles.cardArrow} aria-hidden="true">
              ↗
            </span>
          </div>
          <span className={styles.srOnly}>{t.details}</span>
        </div>
      </Link>
      <VehicleContactActions vehicle={vehicle} locale={locale} />
    </article>
  );
}
