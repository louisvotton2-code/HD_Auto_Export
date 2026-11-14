'use client';

import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { usePublicFreshness } from '../application/use-public-resource';
import { inspectionSummaryCopy } from '../inspection-summary-copy';
import { PublicVehicleContacts } from './public-vehicle-contacts';
import styles from './public-detail.module.css';
import summaryStyles from './vehicle-inspection-summary.module.css';

/** Detail uses only its existing response. Report bodies are read on the separate report page. */
export function VehicleInspectionSummary({ vehicle, locale }: { vehicle: PublicVehicle; locale: Locale }) {
  const copy = inspectionSummaryCopy[locale];
  const fresh = usePublicFreshness() === 'fresh';
  const summary = vehicle.inspectionSummary;
  const status = summary?.status ?? 'unknown';
  const number = (value: number | null) => value === null ? copy.notProvided : value.toLocaleString(locale);
  if (status !== 'available' || !summary) return <section className={`${styles.card} ${summaryStyles.service}`}
    data-inspection-service data-inspection-status={status} aria-labelledby={`inspection-service-${vehicle.id}`}>
    <h2 id={`inspection-service-${vehicle.id}`} className={styles.cardHeading}><Icon name="document" size={18} />{copy.service}</h2>
    <div className={summaryStyles.body}>
      <p>{copy.unavailable}</p><p>{copy.application}</p><p>{copy.mismatch} {copy.match}</p>
      <PublicVehicleContacts vehicle={vehicle} locale={locale} variant="detail" />
    </div>
  </section>;
  return <section className={styles.card} data-inspection-summary data-inspection-status="available"
    aria-labelledby={`inspection-summary-${vehicle.id}`}>
    <h2 id={`inspection-summary-${vehicle.id}`} className={styles.cardHeading}><Icon name="document" size={18} />{copy.title}</h2>
    <div className={summaryStyles.body}>
      <p className={summaryStyles.notice}>{copy.current}</p>
      <dl className={summaryStyles.totals}>
        <div><dt>{copy.checked}</dt><dd>{number(summary.checked)}</dd></div>
        <div><dt>{copy.faults}</dt><dd>{number(summary.faults)}</dd></div>
      </dl>
      {summary.categories.length > 0 && <ul className={summaryStyles.categories}>{summary.categories.map(category =>
        <li key={category.id} data-inspection-category={category.id} data-outcome={category.outcome}>
          <strong lang={category.label.contentLocale ?? undefined}>{category.label.text ?? copy.notProvided}</strong>
          <span>{copy.outcomes[category.outcome]}</span>
          <small>{copy.checked}: {number(category.checked)} · {copy.faults}: {number(category.faults)}</small>
        </li>)}</ul>}
      <a className={styles.reportLink} data-public-inspection-link target="_blank" rel="noopener noreferrer"
        href={fresh ? `${vehicle.detailPath}inspection/` : undefined} aria-disabled={!fresh || undefined} tabIndex={fresh ? undefined : -1}>
        {copy.view}<Icon name="diagonal" size={16} />
      </a>
    </div>
  </section>;
}
