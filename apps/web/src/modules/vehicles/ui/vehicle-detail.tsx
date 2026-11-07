import Link from 'next/link';
import type { Locale } from '@/i18n/routing';
import type { Vehicle } from '../types';
import { vehicleMessages } from '../messages';
import { VehicleContactActions } from './vehicle-contact-actions';
import styles from './vehicles.module.css';

export function VehicleDetail({ vehicle, locale }: { vehicle: Vehicle; locale: Locale }) {
  const t = vehicleMessages(locale);
  return (
    <main id="main" className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href={`/${locale}/cars/`}>
          ← {t.back}
        </Link>
        <p className={styles.notice}>{t.notice}</p>
        <div className={styles.detailLayout}>
          <div className={styles.detailImage}>
            <img src={vehicle.image} alt={vehicle.imageAlt} />
            <span>
              {t.demo}
              {vehicle.sampleOrigin === 'reference-korea' ? ` · ${t.referenceLabel}` : ''}
            </span>
          </div>
          <div className={styles.detailContent}>
            <p className={styles.eyebrow}>{vehicle.make}</p>
            <h1>{vehicle.model}</h1>
            <p className={styles.detailPriceLabel}>{t.demoPrice}</p>
            <p className={styles.detailPrice}>${vehicle.priceUsd.toLocaleString('en-US')}</p>
            <p className={styles.priceNote}>{t.priceNote}</p>
            <h2>{t.specifications}</h2>
            <dl className={styles.specs}>
              <div>
                <dt>{t.year}</dt>
                <dd>{vehicle.year}</dd>
              </div>
              <div>
                <dt>{t.mileage}</dt>
                <dd>
                  {vehicle.mileageKm.toLocaleString(locale)} {t.km}
                </dd>
              </div>
              <div>
                <dt>{t.fuel}</dt>
                <dd>{t[vehicle.fuel]}</dd>
              </div>
              <div>
                <dt>{t.body}</dt>
                <dd>{t[vehicle.body]}</dd>
              </div>
            </dl>
            <p className={styles.description}>{t.description}</p>
            <VehicleContactActions vehicle={vehicle} locale={locale} variant="detail" />
            <p className={styles.priceNote}>{t.contactNote}</p>
            <Link href={`/${locale}/calculator/russia/`} className={styles.button}>
              {t.estimate} <span aria-hidden="true">↗</span>
            </Link>
            <p className={styles.priceNote}>{t.estimateNote}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
