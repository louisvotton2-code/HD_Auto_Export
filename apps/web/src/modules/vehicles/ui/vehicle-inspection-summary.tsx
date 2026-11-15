'use client';

import type { DisplayText, PublicVehicle, PublicVehicleInline } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { inspectionSummaryCopy } from '../inspection-summary-copy';
import styles from './public-detail.module.css';
import summaryStyles from './vehicle-inspection-summary.module.css';

function Text({ field }: { field: DisplayText | null | undefined }) {
  return field?.status === 'ready' ? <span lang={field.contentLocale} dir="auto">{field.text}</span> : null;
}

/** Everything here belongs to the same detail snapshot; no report probe or body request. */
export function VehicleInspectionSummary({ vehicle, locale }: { vehicle: PublicVehicle | PublicVehicleInline; locale: Locale }) {
  const copy = inspectionSummaryCopy[locale];
  const summary = vehicle.inspectionSummary;
  const status = summary?.status ?? 'unknown';
  const inline = 'inspectionInline' in vehicle ? vehicle.inspectionInline : null;
  const conclusions = inline?.conclusions.filter(item => item.name.status === 'ready' && item.name.text.trim()
    && item.value.status === 'ready' && item.value.text.trim()) ?? [];
  const defects = inline?.defects.filter(item => item.part?.status === 'ready' && item.part.text.trim()
    && item.value.status === 'ready' && item.value.text.trim()) ?? [];
  const number = (value: number | null) => value === null ? copy.notProvided : value.toLocaleString(locale);
  const available = status === 'available' && summary;
  const language = summary?.contentLocale;
  let languageName = copy.unknownLanguage;
  if (language) {
    try { languageName = new Intl.DisplayNames(locale, { type: 'language' }).of(language) ?? language; }
    catch { languageName = language; }
  }
  return <section id="inspection" className={`${styles.card} ${summaryStyles.service}`}
    data-inspection-summary={available ? '' : undefined} data-inspection-service={available ? undefined : ''}
    data-inspection-status={status} aria-labelledby={`inspection-summary-${vehicle.id}`}>
    <h2 id={`inspection-summary-${vehicle.id}`} className={styles.cardHeading}>
      <Icon name="document" size={18} />{available ? copy.title : copy.service}
    </h2>
    <div className={summaryStyles.body}>
      {available ? <>
        <p className={summaryStyles.notice}>{copy.current}</p>
        <p data-inspection-language={language ?? 'mixed'}>{copy.language}: <span>{languageName}</span></p>
        <dl className={summaryStyles.totals} data-inspection-complete-counts>
          <div><dt>{copy.checked}</dt><dd>{number(summary.checked)}</dd></div>
          <div><dt>{copy.faults}</dt><dd>{number(summary.faults)}</dd></div>
        </dl>
        {summary.categories.length > 0 && <ul className={summaryStyles.categories}>{summary.categories.map(category =>
          <li key={category.id} data-inspection-category={category.id} data-outcome={category.outcome}>
            <strong><Text field={category.label} /></strong><span>{copy.outcomes[category.outcome]}</span>
            <small>{copy.checked}: {number(category.checked)} · {copy.faults}: {number(category.faults)}</small>
          </li>)}</ul>}
        {conclusions.length > 0 && <div className={summaryStyles.findings}>
          <h3>{copy.conclusions}</h3><dl>{conclusions.map(item => <div key={item.id} data-inspection-conclusion>
            <dt><Text field={item.name} /></dt><dd><Text field={item.value} /></dd>
          </div>)}</dl>
        </div>}
        {defects.length > 0 && <div className={summaryStyles.findings}>
          <h3>{copy.defects}</h3><ul>{defects.map(item => <li key={item.id} data-inspection-defect>
            <strong><Text field={item.part} /></strong>
            {item.category?.status === 'ready' && <small><Text field={item.category} /></small>}
            <span><Text field={item.name} /></span><p><Text field={item.value} /></p>
          </li>)}</ul>
        </div>}
        {inline && <p data-inspection-normal-count>{copy.normal}: {number(inline.normalItemCount)}. <small>{copy.normalNote}</small></p>}
        {(inline?.hasMoreConclusions || inline?.hasMoreDefects) && <p>{copy.more}</p>}
        <p className={summaryStyles.salesNote}>{copy.contact}</p>
      </> : <>
        <p className={summaryStyles.serviceIntro}>{copy.unavailable} {copy.application}</p>
        <div className={summaryStyles.policies}>
          <p className={summaryStyles.policy}>{copy.mismatch}<strong className={summaryStyles.merchant}>{copy.merchant}</strong>{copy.period}</p>
          <p className={summaryStyles.policy}>{copy.match}<strong className={summaryStyles.customer}>{copy.customer}</strong>{copy.period}</p>
        </div>
      </>}
    </div>
  </section>;
}
