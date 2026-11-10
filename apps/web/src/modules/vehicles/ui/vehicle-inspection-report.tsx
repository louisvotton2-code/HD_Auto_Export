import type { ExternalPublicDetail } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { externalDetailCopy } from '../external-detail-copy';
import styles from './public-detail.module.css';

type Inspection = NonNullable<ExternalPublicDetail['inspection']>;
const visibleInspectionItems = 6;

function ReportEntries({ entries }: { entries: Inspection['entries'] }) {
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

export function VehicleInspectionReport({ id, inspection, locale }: {
  id: string;
  inspection: Inspection;
  locale: Locale;
}) {
  const copy = externalDetailCopy[locale];
  return (
    <section id={id} className={`${styles.card} ${styles.reportCard}`} aria-labelledby={`${id}-title`} tabIndex={-1}>
      <h2 id={`${id}-title`} className={styles.cardHeading}>
        <Icon name="document" className={styles.historyIcon} size={19} />
        {copy.inspection}
      </h2>
      <ReportEntries entries={inspection.entries.slice(0, visibleInspectionItems)} />
      {inspection.entries.length > visibleInspectionItems && (
        <details className={styles.reportDetails}>
          <summary>{copy.moreInspection}</summary>
          <ReportEntries entries={inspection.entries.slice(visibleInspectionItems)} />
        </details>
      )}
      {inspection.reportUrl && (
        <a className={styles.reportLink} href={inspection.reportUrl} target="_blank" rel="noopener noreferrer">
          <Icon name="diagonal" size={16} />
          {copy.originalReport}
        </a>
      )}
    </section>
  );
}

export function VehicleReportLink({ reportId, locale }: {
  reportId: string;
  locale: Locale;
}) {
  return (
    <a className={styles.reportLink} href={`#${reportId}`}>
      <Icon name="document" size={16} />
      {externalDetailCopy[locale].report}
    </a>
  );
}
