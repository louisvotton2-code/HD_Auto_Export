'use client';

import type { PublicVehicle } from '@hd/contracts/public';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { publicVehicleTitle } from '@/shared/lib/public-vehicle-title';
import { Icon } from '@/shared/ui/icon';
import { publicVehicleMessages } from '../public-messages';
import { detailContent } from '../detail-content';
import { externalDetailCopy } from '../external-detail-copy';
import { usePublicFreshness } from '../application/use-public-resource';
import {
  publicAvailabilityLabel,
  publicVehicleFacts,
} from '../public-presentation';
import { ExternalVehicleInformation } from './external-vehicle-information';
import { PublicCatalogLink } from './public-catalog-link';
import { PublicVehicleContacts } from './public-vehicle-contacts';
import { VehicleRateAttribution } from './vehicle-rate-attribution';
import { VehiclePriceValues } from './vehicle-price-values';
import { VehicleHistory } from './vehicle-history';
import { VehicleInspectionReport, VehicleReportLink } from './vehicle-inspection-report';
import {
  VehicleBudgetPanel,
  VehicleDetailActions,
  VehicleGallery,
  type VehicleDestination,
} from './vehicle-gallery';
import styles from './public-detail.module.css';

export function PublicVehicleDetail({
  vehicle,
  locale,
  destinations = [],
  budget,
}: {
  locale: Locale;
  vehicle: PublicVehicle;
  destinations?: VehicleDestination[];
  budget?: ReactNode;
}) {
  const t = publicVehicleMessages(locale);
  const copy = detailContent[locale];
  const fresh = usePublicFreshness() === 'fresh';
  const sold = fresh && vehicle.availability === 'sold';
  const availability = fresh ? publicAvailabilityLabel(vehicle, locale) : '';
  const make = vehicle.facts.make?.name;
  const { text: title, lang } = publicVehicleTitle(vehicle, locale);
  const titleRemainder =
    make && title.toLowerCase().startsWith(`${make.toLowerCase()} `)
      ? title.slice(make.length + 1)
      : null;
  const mileage = vehicle.facts.mileageKm?.toLocaleString(locale);
  const knownDate = vehicle.facts.manufacturedAt?.value;
  const contactId = `vehicle-contact-${vehicle.id}`;
  const inspection = vehicle.external?.detail?.inspection;
  const reportId = inspection && inspection.entries.length > 0
    ? `vehicle-report-${vehicle.id}`
    : undefined;

  return (
    <main id="main" className={styles.page} data-public-vehicle-detail={vehicle.id}>
      <div className={styles.container}>
        <PublicCatalogLink locale={locale} className={styles.back} href={`/${locale}/cars/`}>
          ← {t.back}
        </PublicCatalogLink>
        <div className={styles.grid}>
          <div className={styles.mainColumn}>
            <h1 className={styles.title} lang={lang}>
              {titleRemainder ? (
                <>
                  {make} <span>{titleRemainder}</span>
                </>
              ) : (
                title
              )}
            </h1>
            <p className={styles.subtitle}>
              {mileage === undefined ? t.unknown : `${mileage} ${t.km}`} ·{' '}
              {vehicle.facts.transmission ? t.transmissions[vehicle.facts.transmission] : t.unknown}
            </p>
            <div className={styles.chips}>
              {knownDate && (
                <span className={styles.dateChip}>
                  {t.manufactureLabel}: {knownDate}
                </span>
              )}
              {!knownDate && vehicle.facts.modelYear !== null && (
                <span className={styles.dateChip}>
                  {t.yearLabel}: {vehicle.facts.modelYear}
                </span>
              )}
              <VehicleDetailActions
                vehicleId={vehicle.id}
                detailPath={vehicle.detailPath}
                title={title}
                locale={locale}
              />
            </div>
            <VehicleGallery images={vehicle.images} title={title} locale={locale} />
            <div className={styles.tiles}>
              <div className={styles.tile}>
                <p><span className={styles.tileIcon}><Icon name="document" size={16} /></span>{copy.inquiry}</p>
                <bdi>{vehicle.stockCode}</bdi>
              </div>
              <div className={`${styles.tile} ${styles.mileageTile}`}>
                <p><span className={styles.tileIcon}><Icon name="gauge" size={16} /></span>{copy.mileage}</p>
                <strong>{mileage ?? t.unknown}{mileage !== undefined && <small>{t.km}</small>}</strong>
              </div>
            </div>

            <div className={styles.mobilePrice}>
              <div>
                {vehicle.price.kind !== 'on_request' && <span>{t.priceLabels[vehicle.price.kind]}</span>}
                <VehiclePriceValues vehicle={vehicle} locale={locale} />
              </div>
              <a href={`#${contactId}`}>{sold ? t.similar : copy.consultTitle} →</a>
            </div>
            <VehicleRateAttribution
              vehicles={[vehicle]}
              locale={locale}
              className={styles.mobileRateNote}
            />

            <section className={styles.card}>
              <details className={styles.information} open>
                <summary>
                  {copy.basicInformation}
                  <span aria-hidden="true">⌄</span>
                </summary>
                <dl className={styles.specifications}>
                  {publicVehicleFacts(vehicle, locale).map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd lang={fact.lang} dir="auto">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </section>

            <VehicleHistory vehicle={vehicle} locale={locale} />
            {inspection && reportId && (
              <VehicleInspectionReport id={reportId} inspection={inspection} locale={locale} />
            )}
            {vehicle.content.description && (
              <section className={styles.card}>
                <h2 className={styles.cardHeading}>
                  <span aria-hidden="true" />
                  {copy.publicDescription}
                </h2>
                <p className={styles.description} lang={vehicle.content.description.contentLocale}>
                  {vehicle.content.description.text}
                </p>
              </section>
            )}
            <ExternalVehicleInformation vehicle={vehicle} locale={locale} />
          </div>

          <aside className={styles.budget} aria-label={copy.budgetTitle}>
            <div className={styles.budgetHeading}>
              <span className={styles.budgetIcon} aria-hidden="true">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <rect x="4" y="2" width="16" height="20" rx="2" />
                  <path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14v4M8 18h.01M12 18h.01" />
                </svg>
              </span>
              <h2>{copy.budgetTitle}</h2>
            </div>
            <div className={styles.budgetBody}>
              <p>{copy.budgetIntro}</p>
              {budget ?? <VehicleBudgetPanel locale={locale} destinations={destinations} />}
              <p className={styles.smallNote}>{copy.budgetNote}</p>
            </div>
          </aside>

          <aside className={styles.side}>
            <section className={styles.priceCard}>
              {vehicle.price.kind !== 'on_request' && (
                <p className={styles.priceLabel}>{t.priceLabels[vehicle.price.kind]}</p>
              )}
              <div className={`${styles.priceTile} ${sold ? styles.soldPrice : ''}`}>
                <VehiclePriceValues vehicle={vehicle} locale={locale} />
              </div>
              <p className={styles.priceNote}>{t.priceNote}</p>
              <VehicleRateAttribution
                vehicles={[vehicle]}
                locale={locale}
                className={styles.desktopRateNote}
              />
              {availability && (
                <p className={styles.status} data-availability={vehicle.availability}>
                  {availability}
                </p>
              )}
              {sold && <p className={styles.soldNotice}>{t.similar}</p>}
              {vehicle.price.includes.length > 0 && (
                <details className={styles.priceIncludes}>
                  <summary>{copy.includes}</summary>
                  <ul>
                    {vehicle.price.includes.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
            <section className={styles.contactCard} id={contactId}>
              <div className={styles.contactInner}>
                <h2>{sold ? t.similar : copy.consultTitle}</h2>
                <p>{copy.consultBody}</p>
                <PublicVehicleContacts vehicle={vehicle} locale={locale} variant="detail" />
                <p className={styles.smallNote}>{t.contactNote}</p>
                {reportId && (
                  <section className={styles.reportRequest} data-vehicle-report-request>
                    <h3>
                      <Icon name="document" size={17} />
                      {externalDetailCopy[locale].requestReport}
                    </h3>
                    <PublicVehicleContacts vehicle={vehicle} locale={locale} variant="detail" purpose="inspection" />
                  </section>
                )}
              </div>
            </section>
            {reportId && <VehicleReportLink reportId={reportId} locale={locale} />}
          </aside>
        </div>
      </div>
    </main>
  );
}
