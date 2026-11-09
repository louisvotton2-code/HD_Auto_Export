'use client';

import type { PublicVehicle } from '@hd/contracts/public';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { publicUsdQuote } from '@/shared/lib/public-vehicle-price';
import { publicVehicleMessages } from '../public-messages';
import { detailContent } from '../detail-content';
import { usePublicFreshness } from '../application/use-public-resource';
import {
  formatPublicVehiclePrice,
  publicAvailabilityLabel,
  publicVehicleFacts,
} from '../public-presentation';
import { ExternalVehicleInformation } from './external-vehicle-information';
import { PublicCatalogLink } from './public-catalog-link';
import { PublicVehicleContacts } from './public-vehicle-contacts';
import { VehicleRateAttribution } from './vehicle-rate-attribution';
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
  const quote = publicUsdQuote(vehicle);
  const copy = detailContent[locale];
  const fresh = usePublicFreshness() === 'fresh';
  const sold = fresh && vehicle.availability === 'sold';
  const availability = fresh ? publicAvailabilityLabel(vehicle, locale) : '';
  const make = vehicle.facts.make?.name;
  const title = vehicle.content.title.text;
  const titleRemainder =
    make && title.toLowerCase().startsWith(`${make.toLowerCase()} `)
      ? title.slice(make.length + 1)
      : null;
  const mileage =
    vehicle.facts.mileageKm === null
      ? t.unknown
      : `${vehicle.facts.mileageKm.toLocaleString(locale)} ${t.km}`;
  const knownDate = vehicle.facts.manufacturedAt?.value;
  const contactId = `vehicle-contact-${vehicle.id}`;

  return (
    <main id="main" className={styles.page} data-public-vehicle-detail={vehicle.id}>
      <div className={styles.container}>
        <PublicCatalogLink locale={locale} className={styles.back} href={`/${locale}/cars/`}>
          ← {t.back}
        </PublicCatalogLink>
        <div className={styles.grid}>
          <div className={styles.mainColumn}>
            <h1 className={styles.title} lang={vehicle.content.title.contentLocale}>
              {titleRemainder ? (
                <>
                  {make} <span>{titleRemainder}</span>
                </>
              ) : (
                title
              )}
            </h1>
            <p className={styles.subtitle}>
              {mileage} ·{' '}
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
                <p>{copy.inquiry}</p>
                <bdi>{vehicle.stockCode}</bdi>
              </div>
              <div className={`${styles.tile} ${styles.mileageTile}`}>
                <p>{copy.mileage}</p>
                <strong>{mileage}</strong>
              </div>
            </div>

            <div className={styles.mobilePrice}>
              <div>
                {quote && <span>{t.priceLabels[quote.kind]}</span>}
                <strong>{formatPublicVehiclePrice(vehicle, locale)}</strong>
              </div>
              <a href={`#${contactId}`}>{sold ? t.similar : copy.consultTitle} →</a>
            </div>
            <VehicleRateAttribution
              vehicles={[vehicle]}
              locale={locale}
              className={styles.mobileRateNote}
            />

            <section className={styles.card}>
              <details className={styles.information}>
                <summary>
                  {copy.basicInformation}
                  <span aria-hidden="true">⌄</span>
                </summary>
                <dl className={styles.specifications}>
                  {publicVehicleFacts(vehicle, locale).map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </section>

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
              {quote && <p className={styles.priceLabel}>{t.priceLabels[quote.kind]}</p>}
              <div className={`${styles.priceTile} ${sold ? styles.soldPrice : ''}`}>
                <p>{formatPublicVehiclePrice(vehicle, locale)}</p>
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
              </div>
            </section>
            <section className={styles.sellerCard}>
              <h2>{copy.sellerTitle}</h2>
              <p>{siteConfig.name}</p>
              <a href={siteConfig.contacts.phone.href}>{siteConfig.contacts.phone.display}</a>
              <p className={styles.smallNote}>{copy.consultBody}</p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
