'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ExternalInspection } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { externalDetailCopy } from '../external-detail-copy';
import { hasInspectionContent } from '../vehicle-inspection';
import styles from './public-detail.module.css';
import inspectionStyles from './vehicle-inspection-report.module.css';

type Inspection = ExternalInspection;
type TaggedText = Inspection['entries'][number]['value'];

function Text({ value }: { value: TaggedText }) {
  return <span lang={value.contentLocale} dir="auto">{value.text}</span>;
}

function Batch<T>({ items, locale, size = 6, render }: {
  items: readonly T[]; locale: Locale; size?: number; render: (visible: readonly T[]) => ReactNode;
}) {
  const [expanded, setExpanded] = useState({ items, limit: size });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const limit = expanded.items === items ? expanded.limit : size;
  const remaining = Math.max(0, items.length - limit);
  return <>
    {render(items.slice(0, limit))}
    {remaining > 0 && <noscript><p className={inspectionStyles.noScript}>
      {externalDetailCopy[locale].inspectionEnableDetails} ({remaining.toLocaleString(locale)})
    </p></noscript>}
    {mounted && remaining > 0 && <button className={inspectionStyles.more} type="button" onClick={() => setExpanded({ items, limit: limit + size })}>
      {externalDetailCopy[locale].showMoreInspection} <span>({remaining.toLocaleString(locale)})</span>
    </button>}
  </>;
}

function Disclosure({ title, children, marker, locale }: { title: ReactNode; children: ReactNode; marker: string; locale: Locale }) {
  const [open, setOpen] = useState(false);
  return <details className={inspectionStyles.disclosure} data-inspection-section={marker} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{title}</summary>
    <noscript><p className={inspectionStyles.noScript}>{externalDetailCopy[locale].inspectionEnableDetails}</p></noscript>
    {open && <div className={inspectionStyles.disclosureBody}>{children}</div>}
  </details>;
}

function Count({ value, locale }: { value: number | null; locale: Locale }) {
  const copy = externalDetailCopy[locale];
  return <span className={inspectionStyles.count} data-inspection-count={value === null ? 'unknown' : String(value)}>
    {copy.findingCount}: {value === null ? copy.inspectionUnknown : value.toLocaleString(locale)}
  </span>;
}

function ReportEntries({ entries, locale }: { entries: Inspection['entries']; locale: Locale }) {
  if (!entries.length) return null;
  return <Batch items={entries} locale={locale} render={(visible) => <dl className={styles.externalEntries}>
    {visible.map(({ name, value }, index) => <div key={index}><dt><Text value={name} /></dt><dd><Text value={value} /></dd></div>)}
  </dl>} />;
}

function CheckItems({ items, locale }: { items: NonNullable<Inspection['checks']>[number]['groups'][number]['items']; locale: Locale }) {
  const copy = externalDetailCopy[locale];
  return <Batch items={items} locale={locale} size={12} render={(visible) => <dl className={inspectionStyles.items}>
    {visible.map((item, index) => <div key={index} data-inspection-check-item>
      <dt><Text value={item.part} /></dt>
      <dd>
        <p data-inspection-result={item.result === null ? 'unknown' : 'recorded'}>{item.result ? <Text value={item.result} /> : copy.inspectionUnknown}</p>
        <small>{copy.inspectionStatus}: <strong data-inspection-ok={item.ok === null ? 'unknown' : String(item.ok)}>
          {item.ok === null ? copy.inspectionUnknown : item.ok ? copy.inspectionOk : copy.inspectionIssue}
        </strong></small>
      </dd>
    </div>)}
  </dl>} />;
}

function CheckGroups({ groups, locale }: { groups: NonNullable<Inspection['checks']>[number]['groups']; locale: Locale }) {
  return <Batch items={groups} locale={locale} render={(visible) => <div className={inspectionStyles.groups}>
    {visible.map((group, index) => <div key={index} data-inspection-check-group>
      <Disclosure marker="check-group" locale={locale} title={<><Text value={group.name} /><Count value={group.defects} locale={locale} /></>}>
        <CheckItems items={group.items} locale={locale} />
      </Disclosure>
    </div>)}
  </div>} />;
}

function CheckCategories({ checks, locale }: { checks: NonNullable<Inspection['checks']>; locale: Locale }) {
  return <Batch items={checks} locale={locale} render={(visible) => <div className={inspectionStyles.groups}>
    {visible.map((category, index) => <div key={index} data-inspection-check-category>
      <Disclosure marker="check-category" locale={locale} title={<><Text value={category.category} /><Count value={category.defects} locale={locale} /></>}>
        <CheckGroups groups={category.groups} locale={locale} />
      </Disclosure>
    </div>)}
  </div>} />;
}

function DefectDetails({ details, locale }: { details: NonNullable<Inspection['defects']>[number]['items'][number]['details']; locale: Locale }) {
  return <Batch items={details} locale={locale} render={(visible) => <div className={inspectionStyles.notes}>
    {visible.map((detail, index) => {
      const value = locale === 'zh' ? detail.textZh ?? detail.text : detail.text ?? detail.textZh;
      return value && <p key={index} data-inspection-defect-detail><Text value={value} /></p>;
    })}
  </div>} />;
}

function DefectItems({ items, locale }: { items: NonNullable<Inspection['defects']>[number]['items']; locale: Locale }) {
  const copy = externalDetailCopy[locale];
  return <Batch items={items} locale={locale} render={(visible) => <div className={inspectionStyles.findings}>
    {visible.map((item, index) => <article key={index} data-inspection-defect-item>
      <h4><Text value={item.group} /> · <Text value={item.part} /></h4>
      <p><Text value={item.finding} /></p>
      {item.details.length > 0 && <Disclosure marker="defect-details" locale={locale} title={copy.moreInspection}>
        <DefectDetails details={item.details} locale={locale} />
      </Disclosure>}
    </article>)}
  </div>} />;
}

function DefectCategories({ defects, locale }: { defects: NonNullable<Inspection['defects']>; locale: Locale }) {
  return <Batch items={defects} locale={locale} render={(visible) => <div className={inspectionStyles.groups}>
    {visible.map((category, index) => <div key={index} data-inspection-defect-category>
      <Disclosure marker="defect-category" locale={locale} title={<><Text value={category.category} /><Count value={category.count} locale={locale} /></>}>
        <DefectItems items={category.items} locale={locale} />
      </Disclosure>
    </div>)}
  </div>} />;
}

export function VehicleInspectionReport({ id, inspection, locale }: { id: string; inspection: Inspection; locale: Locale }) {
  const copy = externalDetailCopy[locale];
  if (!hasInspectionContent(inspection)) return null;
  return <section id={id} className={`${styles.card} ${styles.reportCard}`} aria-labelledby={`${id}-title`} tabIndex={-1}>
    <h2 id={`${id}-title`} className={styles.cardHeading}><Icon name="document" className={styles.historyIcon} size={19} />{copy.inspection}</h2>
    <ReportEntries entries={inspection.entries} locale={locale} />
    {!!inspection.checks?.length && <section className={inspectionStyles.block} aria-label={copy.inspectionChecks}>
      <h3>{copy.inspectionChecks}</h3><CheckCategories checks={inspection.checks} locale={locale} />
    </section>}
    {!!inspection.defects?.length && <section className={inspectionStyles.block} aria-label={copy.inspectionDefects}>
      <h3>{copy.inspectionDefects}</h3><DefectCategories defects={inspection.defects} locale={locale} />
    </section>}
  </section>;
}

export function VehicleReportLink({ reportId, locale }: { reportId: string; locale: Locale }) {
  return <a className={styles.reportLink} href={`#${reportId}`}><Icon name="document" size={16} />{externalDetailCopy[locale].report}</a>;
}
