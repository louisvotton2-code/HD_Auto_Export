'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DisplayText, PublicInspectionEntry, PublicVehicle, PublicVehicleInspectionQuery, PublicVehicleInspectionResponse } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicVehicleReference } from '@/shared/lib/public-vehicle-reference';
import { publicVehicleTitle } from '@/shared/lib/public-vehicle-title';
import { PublicFreshnessBoundary, usePublicFreshness, usePublicResource } from '../application/use-public-resource';
import { VehicleSegmentContext, usePublicVehicleSegment } from '../application/use-public-vehicle-segment';
import { localizedVehicleSchema } from '../localized-projection';
import { inspectionPageCopy } from '../inspection-page-copy';
import { publicQueryString, publicUsdView } from '../public-query';
import { PublicResourceStatus } from './public-resource-status';
import styles from './vehicle-inspection-page.module.css';

export type InspectionPageFilters = Pick<PublicVehicleInspectionQuery, 'category' | 'part' | 'outcome'>;
type Props = {
  vehicle: PublicVehicle;
  locale: Locale;
  initialReport: PublicVehicleInspectionResponse | null;
  initialRetryAfter?: number;
  query?: InspectionPageFilters;
};

function Text({ field, fallback }: { field: DisplayText | null | undefined; fallback: string }) {
  return field?.status === 'ready'
    ? <span lang={field.contentLocale} dir="auto">{field.text}</span>
    : <span>{fallback}</span>;
}

function reportPath(vehicle: PublicVehicle, locale: Locale, filters: InspectionPageFilters = {}) {
  const params = new URLSearchParams();
  for (const key of ['category', 'part', 'outcome'] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return `/${locale}/cars/${vehicle.id}/inspection/${params.size ? `?${params}` : ''}`;
}

function groupEntries(items: PublicInspectionEntry[]) {
  const groups = new Map<string, { category: DisplayText | null; label: DisplayText | null; items: PublicInspectionEntry[] }>();
  for (const item of items) {
    const key = `${item.categoryId ?? item.category?.text ?? ''}:${item.groupId ?? item.group?.text ?? item.partId ?? ''}`;
    const group = groups.get(key) ?? { category: item.category, label: item.group ?? item.part, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups].map(([id, group]) => ({ id, ...group }));
}

function conclusionKey(name: DisplayText, value: DisplayText) {
  return name.status === 'ready' && value.status === 'ready'
    ? JSON.stringify([name.text, name.contentLocale, value.text, value.contentLocale]) : null;
}

/** The report is a separate public resource; a withdrawn vehicle removes the whole sheet. */
export function VehicleInspectionPage({ vehicle, locale, initialReport, initialRetryAfter = 0, query = {} }: Props) {
  const initial = useMemo(() => ({ data: vehicle, meta: { requestId: 'server-rendered' } }), [vehicle]);
  const url = `/api/v1/vehicles/${vehicle.id}/?${publicQueryString({ locale, ...publicUsdView })}`;
  const cooldown = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const resource = usePublicResource(url, initial, localizedVehicleSchema(locale, 'usd'), {
    navigationPath: `/${locale}/cars/${vehicle.id}/inspection/`, cooldown,
  });
  const context = useMemo(() => ({ cooldown, onMissing: resource.markMissing }), [resource.markMissing]);
  const copy = inspectionPageCopy[locale];
  return <PublicFreshnessBoundary url={url} phase={resource.phase}>
    <VehicleSegmentContext value={context}>
      {resource.missing || !resource.data ? <main id="main" className={styles.page} data-inspection-missing>
        <div className={styles.empty}><h1>{copy.title}</h1><p role="status">{copy.missing}</p><a href={`/${locale}/cars/`}>{copy.back}</a></div>
      </main> : <InspectionSheet vehicle={resource.data.data} locale={locale} initialReport={initialReport} query={query} />}
      <PublicResourceStatus locale={locale} phase={resource.phase} retry={resource.reload}
        retryAfter={resource.retryAfter} fallbackHref={reportPath(vehicle, locale, query)} floating />
    </VehicleSegmentContext>
  </PublicFreshnessBoundary>;
}

function InspectionSheet({ vehicle, locale, initialReport, query = {} }: Props) {
  const resource = usePublicVehicleSegment('inspection', vehicle, locale, {
    initialPage: initialReport?.data ?? null, ...query, order: 'faults_first',
  });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const fresh = usePublicFreshness() === 'fresh';
  const copy = inspectionPageCopy[locale];
  const reference = publicVehicleReference(vehicle);
  const title = publicVehicleTitle(vehicle, locale);
  const changed = resource.phase === 'changed';
  const summary = changed ? undefined : resource.inspectionSummary ?? vehicle.inspectionSummary;
  const status = resource.inspectionStatus ?? summary?.status ?? 'unknown';
  const available = status === 'available' && !changed;
  const items = changed ? [] : resource.items;
  const conclusions = changed ? [] : resource.inspectionConclusions;
  const conclusionKeys = new Set(conclusions.map(item => conclusionKey(item.name, item.value)).filter(key => key !== null));
  // Legacy summary rows may repeat the same saved conclusion. Keep each fact once;
  // the page progress still reflects all source entries consumed by the bounded API.
  const detailItems = items.filter(item => item.kind !== 'summary'
    || !conclusionKeys.has(conclusionKey(item.name, item.value) ?? ''));
  const findings = detailItems.filter(item => item.outcome === 'defect');
  const groups = groupEntries(detailItems);
  const format = (value: number | null | undefined) => value == null ? copy.notProvided : value.toLocaleString(locale);
  const language = summary?.contentLocale;
  let languageLabel = copy.unknownLanguage;
  if (language) {
    try { languageLabel = new Intl.DisplayNames(locale, { type: 'language' }).of(language) ?? language; }
    catch { languageLabel = language; }
  }
  const vin = vehicle.identifiers?.vin;
  const validVin = vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
  const loading = resource.phase === 'loading';
  const waiting = resource.retryAfter > 0;
  const blocked = loading || waiting || !fresh;
  const initialFailure = !resource.started && resource.phase === 'idle';
  const showAction = resource.phase !== 'missing' && (resource.phase !== 'ready' || resource.hasMore);
  const message = changed ? copy.changed : loading ? copy.loading : waiting
    ? copy.wait.replace('{seconds}', resource.retryAfter.toLocaleString(locale))
    : resource.phase === 'error' || initialFailure ? copy.error : '';
  const actionLabel = changed ? copy.restart : loading ? copy.loading : waiting
    ? copy.wait.replace('{seconds}', resource.retryAfter.toLocaleString(locale))
    : resource.phase === 'error' || initialFailure ? copy.retry : copy.more;
  const parts = [...new Map(items.filter(item => item.partId && item.part?.status === 'ready')
    .map(item => [item.partId!, { id: item.partId!, field: item.part! }])).values()];
  const hasSelectedPart = Boolean(query.part && parts.some(part => part.id === query.part));

  return <main id="main" className={styles.page} data-vehicle-inspection-page={vehicle.id} data-inspection-status={status}>
    <div className={styles.container}>
      <a className={styles.back} href={vehicle.detailPath}>← {copy.back}</a>
      <article className={styles.sheet}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>HD AUTO EXPORT <span aria-hidden="true">/</span> {copy.stored}</p>
          <h1>{copy.title}</h1>
          <p className={styles.vehicle} lang={title.lang}>{title.text}</p>
          <dl className={styles.identity}>
            <div><dt>{copy.inquiry}</dt><dd><bdi>{reference.code}</bdi></dd></div>
            {validVin && <div><dt>{copy.vin}</dt><dd className={styles.vin}><bdi>{validVin}</bdi></dd></div>}
            <div><dt>{copy.language}</dt><dd data-report-language={language ?? 'unknown'}>{languageLabel}{language && <bdi className={styles.languageCode}>{language}</bdi>}</dd></div>
            {reference.source && <div><dt>{copy.source}</dt><dd><bdi>{reference.source}</bdi></dd></div>}
          </dl>
        </header>

        <div className={styles.body}>
          <p className={styles.status} data-report-state={status}>{copy.statuses[status]}</p>
          {available && <>
            <section className={styles.section} aria-labelledby="inspection-overview">
              <div className={styles.sectionHeading}><h2 id="inspection-overview">{copy.overview}</h2>
                <p className={styles.legend}>{(['ok', 'defect', 'unknown'] as const).map(outcome => <span key={outcome} data-outcome={outcome}>{copy.outcomes[outcome]}</span>)}</p>
              </div>
              <dl className={styles.totals} data-report-complete-counts>
                <div><dt>{copy.checked}</dt><dd data-report-checked>{format(summary?.checked)}</dd></div>
                <div><dt>{copy.faults}</dt><dd data-report-faults>{format(summary?.faults)}</dd></div>
              </dl>
              {Boolean(summary?.categories.length) && <div className={styles.categoryCards}>
                {summary!.categories.map(category => <a key={category.id} href={blocked ? undefined : reportPath(vehicle, locale, { category: category.id, outcome: query.outcome })}
                  aria-disabled={blocked || undefined} tabIndex={blocked ? -1 : undefined}
                  className={styles.categoryCard} data-outcome={category.outcome} data-report-category={category.id}>
                  <span className={styles.categoryName}><Text field={category.label} fallback={copy.fallbackGroup} /></span>
                  <strong>{copy.outcomes[category.outcome]}</strong>
                  <span>{copy.checked}: <b>{format(category.checked)}</b> <span aria-hidden="true">·</span> {copy.faults}: <b>{format(category.faults)}</b></span>
                </a>)}
              </div>}
              <p className={styles.note}>{copy.note}</p>
            </section>

            {conclusions.length > 0 && <section className={styles.section} aria-labelledby="inspection-conclusions">
              <h2 id="inspection-conclusions">{copy.conclusions}</h2>
              <dl className={styles.conclusions}>{conclusions.map(item => <div key={item.id}>
                <dt><Text field={item.name} fallback={copy.notProvided} /></dt><dd><Text field={item.value} fallback={copy.notProvided} /></dd>
              </div>)}</dl>
            </section>}

            <section className={styles.section} aria-labelledby="inspection-findings">
              <h2 id="inspection-findings">{copy.findings}</h2><p className={styles.note}>{copy.loadedFindings}</p>
              {findings.length ? <ul className={styles.findings}>{findings.map(item => <li key={item.id}>
                <a href={`#inspection-item-${encodeURIComponent(item.id)}`}><Text field={item.part ?? item.name} fallback={copy.notProvided} /></a>
                <Text field={item.value} fallback={copy.notProvided} />
              </li>)}</ul> : <p className={styles.note}>{copy.noLoadedFindings}</p>}
            </section>

            <section className={styles.section} aria-labelledby="inspection-details">
              <h2 id="inspection-details">{copy.details}</h2>
              <nav className={styles.categoryNav} aria-label={copy.categories}>
                <a href={blocked ? undefined : reportPath(vehicle, locale, { outcome: query.outcome })} aria-disabled={blocked || undefined} tabIndex={blocked ? -1 : undefined} aria-current={!query.category ? 'page' : undefined}>{copy.all}</a>
                {summary?.categories.map(category => <a key={category.id} href={blocked ? undefined : reportPath(vehicle, locale, { category: category.id, outcome: query.outcome })}
                  aria-disabled={blocked || undefined} tabIndex={blocked ? -1 : undefined} aria-current={query.category === category.id ? 'page' : undefined}><Text field={category.label} fallback={copy.fallbackGroup} /></a>)}
              </nav>
              <form method="get" action={`/${locale}/cars/${vehicle.id}/inspection/`} className={styles.filters} onSubmit={event => { if (blocked) event.preventDefault(); }}>
                <label><span>{copy.categories}</span><select name="category" disabled={blocked} defaultValue={query.category ?? ''}>
                  <option value="">{copy.all}</option>{summary?.categories.map(category => <option key={category.id} value={category.id} lang={category.label.contentLocale ?? undefined}>
                    {category.label.status === 'ready' ? category.label.text : copy.fallbackGroup}</option>)}
                </select></label>
                {Boolean(parts.length || query.part) && <label><span>{copy.part}</span><select name="part" disabled={blocked} defaultValue={query.part ?? ''}>
                  <option value="">{copy.allResults}</option>{parts.map(part => <option key={part.id} value={part.id} lang={part.field.contentLocale ?? undefined}>{part.field.text}</option>)}
                  {query.part && !hasSelectedPart && <option value={query.part}>{copy.part}</option>}
                </select></label>}
                <label><span>{copy.outcome}</span><select name="outcome" disabled={blocked} defaultValue={query.outcome ?? ''}>
                  <option value="">{copy.allResults}</option>{(['defect', 'ok', 'unknown'] as const).map(outcome => <option key={outcome} value={outcome}>{copy.outcomes[outcome]}</option>)}
                </select></label>
                <button type="submit" disabled={blocked}>{copy.apply}</button>
              </form>
              {groups.length ? <div className={styles.groups}>{groups.map(group => <details key={group.id} className={styles.group}
                open={group.items.some(item => item.outcome === 'defect')}>
                <summary><span><Text field={group.category} fallback={copy.fallbackGroup} />{group.label && <> / <Text field={group.label} fallback={copy.notProvided} /></>}</span><span aria-hidden="true">⌄</span></summary>
                <div className={styles.tableWrap}><table>
                  <thead><tr><th scope="col">{copy.item}</th><th scope="col">{copy.result}</th><th scope="col">{copy.outcome}</th></tr></thead>
                  <tbody>{group.items.map(item => <tr id={`inspection-item-${encodeURIComponent(item.id)}`} key={item.id}
                    data-inspection-page-item={item.id} data-outcome={item.outcome}>
                    <th scope="row"><Text field={item.name} fallback={copy.notProvided} /></th><td><Text field={item.value} fallback={copy.notProvided} /></td><td><span className={styles.outcome} data-outcome={item.outcome}>{copy.outcomes[item.outcome]}</span></td>
                  </tr>)}</tbody>
                </table></div>
              </details>)}</div> : resource.phase === 'ready' && <p>{copy.noItems}</p>}
            </section>
          </>}

          <div className={styles.controls} aria-busy={loading}>
            {available && resource.total !== null && <p data-inspection-page-progress>{copy.detailsCount.replace('{loaded}', format(items.length)).replace('{total}', format(resource.total))}</p>}
            {message && <p role="status">{message}</p>}
            {mounted && showAction && <button type="button" data-inspection-page-load-more
              disabled={blocked} onClick={changed ? resource.restart : resource.loadMore}>{actionLabel}</button>}
            {available && resource.hasMore && <noscript><p>{copy.noScript}</p></noscript>}
            {initialFailure && <noscript><a href={reportPath(vehicle, locale, query)}>{copy.retry}</a></noscript>}
          </div>
          <footer className={styles.footer}><a href={`${vehicle.detailPath}#vehicle-contact-${vehicle.id}`}>{copy.contact} →</a><p>{copy.stored}</p></footer>
        </div>
      </article>
    </div>
  </main>;
}
