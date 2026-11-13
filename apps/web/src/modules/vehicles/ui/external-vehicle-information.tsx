import type { ExternalIssue, PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { externalDetailCopy } from '../external-detail-copy';
import { publicVehicleMessages } from '../public-messages';
import { catalogFilterCopy } from '../catalog-filter-copy';
import { detailContent } from '../detail-content';
import styles from './public-detail.module.css';

export function ExternalVehicleInformation({ vehicle, locale }: { vehicle: PublicVehicle; locale: Locale }) {
  if (!vehicle.external) return null;
  const { detail, issues } = vehicle.external;
  const copy = externalDetailCopy[locale];
  const t = publicVehicleMessages(locale);
  const filters = catalogFilterCopy[locale];
  const labels: Record<Exclude<ExternalIssue['field'], 'relatedListingUrls'>, string> = {
    make: t.make,
    model: t.model,
    trim: filters.trim,
    generation: filters.generation,
    modelYear: t.yearLabel,
    manufacturedAt: t.manufactureLabel,
    firstRegistration: t.registrationLabel,
    registrationStatus: copy.registrationStatus,
    mileageKm: t.mileageLabel,
    powertrain: t.powertrain,
    engineCc: t.engineLabel,
    powerKw: t.powerLabel,
    body: t.bodyLabel,
    transmission: t.transmissionLabel,
    drivetrain: filters.drive,
    location: t.locationLabel,
    price: filters.price,
    title: copy.title,
    description: detailContent[locale].publicDescription,
    images: copy.images,
    specifications: copy.specifications,
    inspection: copy.inspection,
  };
  const uncertainFields = [...new Set(issues
    .filter(({ code }) => code === 'conflict' || code === 'invalid')
    .map(({ field }) => field)
    .filter((field) => field !== 'relatedListingUrls'))];

  return (
    <>
      {uncertainFields.length > 0 && (
        <section className={styles.card} aria-label={copy.needsConfirmation}>
          <h2 className={styles.cardHeading}>{copy.needsConfirmation}</h2>
          <ul className={styles.externalIssues}>
            {uncertainFields.map((field) => <li key={field}>{labels[field]}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
