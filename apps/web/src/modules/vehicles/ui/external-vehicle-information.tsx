import type { ExternalPublicDetail, ExternalIssue, PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { externalDetailCopy } from '../external-detail-copy';
import { publicVehicleMessages } from '../public-messages';
import { catalogFilterCopy } from '../catalog-filter-copy';
import { detailContent } from '../detail-content';
import styles from './public-detail.module.css';

function DetailEntries({ entries }: { entries: ExternalPublicDetail['specifications'] }) {
  if (!entries.length) return null;
  return (
    <dl className={styles.externalEntries}>
      {entries.map(({ name, value }, index) => (
        <div key={index}>
          <dt lang={name.contentLocale} dir="auto">{name.text}</dt>
          <dd lang={value.contentLocale} dir="auto">{value.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalVehicleInformation({ vehicle, locale }: { vehicle: PublicVehicle; locale: Locale }) {
  if (!vehicle.external) return null;
  const { detail, issues } = vehicle.external;
  const copy = externalDetailCopy[locale];
  const t = publicVehicleMessages(locale);
  const filters = catalogFilterCopy[locale];
  const labels: Record<ExternalIssue['field'], string> = {
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
    relatedListingUrls: copy.related,
  };
  const uncertainFields = [...new Set(issues
    .filter(({ code }) => code === 'conflict' || code === 'invalid')
    .map(({ field }) => field))];
  const fields = [
    { field: 'title', original: detail?.original.title, current: vehicle.content.title },
    { field: 'model', original: detail?.original.model, current: vehicle.display?.model },
    { field: 'description', original: detail?.original.description, current: vehicle.content.description },
  ] as const;
  const comparisons = fields.filter(({ field, original }) => original && !uncertainFields.includes(field));
  const inspection = detail?.inspection;
  const specifications = detail?.specifications ?? [];
  const related = detail?.relatedListingUrls ?? [];

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
      {comparisons.length > 0 && (
        <section className={styles.card}>
          <details className={styles.information}>
            <summary>{copy.comparison}<span aria-hidden="true">⌄</span></summary>
            <div className={styles.externalSections}>
              {comparisons.map(({ field, original, current }) => original && (
                <section key={field}>
                  <h3>{labels[field]}</h3>
                  <dl className={styles.externalComparison}>
                    {current?.text && current.text !== original.text && (
                      <div>
                        <dt>{copy.displayed}</dt>
                        <dd lang={current.contentLocale} dir="auto">{current.text}</dd>
                      </div>
                    )}
                    <div>
                      <dt>{copy.original}</dt>
                      <dd lang={original.contentLocale} dir="auto">{original.text}</dd>
                    </div>
                  </dl>
                </section>
              ))}
            </div>
          </details>
        </section>
      )}
      {specifications.length > 0 && (
        <section className={styles.card}>
          <details className={styles.information}>
            <summary>{copy.specifications}<span aria-hidden="true">⌄</span></summary>
            <DetailEntries entries={specifications} />
          </details>
        </section>
      )}
      {inspection && (inspection.entries.length > 0 || inspection.reportUrl) && (
        <section className={styles.card}>
          <details className={styles.information}>
            <summary>{copy.inspection}<span aria-hidden="true">⌄</span></summary>
            <DetailEntries entries={inspection.entries} />
            {inspection.reportUrl && (
              <a className={styles.externalLink} href={inspection.reportUrl} target="_blank" rel="noopener noreferrer">{copy.report}</a>
            )}
          </details>
        </section>
      )}
      {related.length > 0 && (
        <section className={styles.card}>
          <details className={styles.information}>
            <summary>{copy.related}<span aria-hidden="true">⌄</span></summary>
            {[...new Set(related)].map((url, index) => (
              <a key={url} className={styles.externalLink} href={url} target="_blank" rel="noopener noreferrer">{copy.listing(index + 1)}</a>
            ))}
          </details>
        </section>
      )}
    </>
  );
}
