'use client';
import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { SocialIcon } from '@/shared/ui/social-icon';
import { partsContent } from '../content/parts-content';
import { defaultPartsQuery, parsePartsQuery, partCategories, partsHref } from '../query';
import type { Part, PartsQuery } from '../types';
import { PartCard } from './part-card';
import { usePartFavorites } from '../use-part-favorites';
import styles from './parts.module.css';

const demoPages = 20;
const existingRowsPerPage = 12;

export function PartsCatalog({ parts, locale, initialQuery, invalid = false }: { parts: readonly Part[]; locale: Locale; initialQuery: PartsQuery; invalid?: boolean }) {
  const t = partsContent[locale];
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery), [hasError, setError] = useState(invalid), [savedOnly, setSavedOnly] = useState(false), [ready, setReady] = useState(false);
  const knownIds = useMemo(() => parts.map((part) => part.slug), [parts]);
  const { ids } = usePartFavorites(knownIds);
  const [page, setPage] = useState(1);
  const [searched, setSearched] = useState(false);
  const savedParts = parts.filter((part) => ids.includes(part.slug));
  const baseParts = parts.slice(0, existingRowsPerPage);
  const visible = savedOnly ? savedParts : baseParts;
  // ponytail: a fixed sample page until the parts service supplies real results and counts.
  const samples = parts.slice(existingRowsPerPage, existingRowsPerPage * 2);
  const demoTotal = (baseParts.length + samples.length) * demoPages;
  const brands = [...new Set(parts.map((part) => part.brand))];
  const key = JSON.stringify(query);
  function apply(next: { query: PartsQuery; invalid: boolean }) {
    setError(next.invalid);
    if (next.invalid) return;
    setQuery(next.query);
    setSearched(true);
    // Let Next copy its own router state and notify useSearchParams subscribers.
    window.history.replaceState(null, '', partsHref(locale, next.query));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); apply(parsePartsQuery(Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>));
  }
  function quick(event: MouseEvent<HTMLAnchorElement>, category: PartsQuery['category']) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); apply({ query: { ...query, category }, invalid: false });
    document.getElementById('parts-catalog')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  useEffect(() => {
    setReady(true);
    // Next links can reuse this component after a native history update. The URL,
    // including Back/Forward and header/footer reset links, remains authoritative.
    const raw: Record<string, string | string[]> = {};
    for (const key of searchParams.keys()) {
      const values = searchParams.getAll(key); raw[key] = values.length === 1 ? values[0] : values;
    }
    const parsed = parsePartsQuery(raw);
    setQuery(parsed.query);
    setError(parsed.invalid);
    if (!searchParams.size) setPage(1);
  }, [searchParams]);
  return <main id="main" className={styles.page} data-testid="parts-catalog">
    <section className={styles.hero}><div className={styles.wrap}>
      <p className={styles.kicker}>{t.kicker}</p>
      <h1>{t.title} <span>{t.titleAccent}</span></h1><p className={styles.heroText}>{t.subtitle}</p>
      <form key={`hero-${key}`} className={styles.search} method="get" action={partsHref(locale)} onSubmit={submit}>
        {Object.entries(query).filter(([name, value]) => name !== 'q' && value).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <span aria-hidden="true">⌕</span><input name="q" type="search" maxLength={100} defaultValue={query.q} placeholder={t.searchHint} aria-label={t.search} />
        <button className={styles.primary} type="submit">{t.search}</button>
      </form>
      <div className={styles.stats}>{[demoTotal, partCategories.length, 'USD'].map((value, i) => <div key={t.stats[i]}><strong>{value}</strong><span>{t.stats[i]}</span></div>)}</div>
    </div></section>
    <div className={styles.wrap}>
      <section className={styles.quick}><p className={styles.kicker}>{t.quickBrowse}</p><div>{partCategories.map((category) => <a key={category} href={partsHref(locale, { ...query, category })} onClick={(event) => quick(event, category)} aria-current={query.category === category ? 'true' : undefined}>{t.categories[category]}</a>)}</div></section>
      <section id="parts-catalog" className={styles.catalog}>
        <div className={styles.catalogHeading}><h2>{t.catalog}</h2><p>{t.catalogBody}</p></div>
        <div className={`${styles.search} ${styles.catalogSearch}`} key={`search-${key}`}><span aria-hidden="true">⌕</span><input form="parts-filters" type="search" name="q" maxLength={100} defaultValue={query.q} placeholder={t.searchHint} aria-label={t.search} /><button className={styles.primary} form="parts-filters" type="submit">{t.search}</button></div>
        <div className={styles.layout}>
          <form id="parts-filters" key={`filters-${key}`} className={styles.filters} method="get" action={partsHref(locale)} onSubmit={submit}>
            <h3>{t.filters}</h3>
            <label>{t.brand}<select name="brand" defaultValue={query.brand}><option value="">{t.all}</option>{brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></label>
            <fieldset><legend>{t.category}</legend><label><input type="radio" name="category" value="" defaultChecked={!query.category} />{t.all}</label>{partCategories.map((category) => <label key={category}><input type="radio" name="category" value={category} defaultChecked={query.category === category} />{t.categories[category]}<small>{(parts.slice(0, existingRowsPerPage * 2).filter((p) => p.category === category).length) * demoPages}</small></label>)}</fieldset>
            <fieldset><legend>{t.price}</legend><div className={styles.priceRange}><input name="min" inputMode="decimal" defaultValue={query.min} placeholder="0" aria-label={t.min} /><input name="max" inputMode="decimal" defaultValue={query.max} placeholder="∞" aria-label={t.max} /></div></fieldset>
            <button className={styles.primary} type="submit">{t.apply}</button>
            <a href={partsHref(locale)} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); apply({ query: defaultPartsQuery, invalid: false }); } }}>{t.reset}</a>
          </form>
          <div className={styles.results}>
            {ready && <div className={styles.savedTabs}><button type="button" aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>{t.allParts}</button><button type="button" aria-pressed={savedOnly} data-testid="saved-parts-filter" onClick={() => setSavedOnly(true)}>{t.favorites} ({savedParts.length})</button></div>}
            <div className={styles.resultsBar}><p aria-live="polite">{savedOnly ? t.count(savedParts.length) : t.demoCount(demoTotal, page, demoPages)}</p><label className={styles.sort}>{t.sort}<select key={`sort-${key}`} name="sort" form="parts-filters" defaultValue={query.sort} onChange={(event) => { const form = event.currentTarget.form; if (form) apply(parsePartsQuery(Object.fromEntries(new FormData(form)) as Record<string, string>)); }}><option value="default">{t.defaultSort}</option><option value="price-asc">{t.ascending}</option><option value="price-desc">{t.descending}</option><option value="name">{t.byName}</option></select></label></div>
            {hasError && <p className={styles.error} role="alert">{t.invalidPrice}</p>}
            <p className={styles.demoNote} role="status">{searched ? t.demoSearched : t.demoNotice}</p>
            {visible.length || !savedOnly ? <div className={styles.grid}>
              {visible.map((part) => <PartCard key={part.slug} part={part} locale={locale} />)}
              {!savedOnly && samples.map((part, index) => (
                <PartCard key={part.slug} part={part} locale={locale} sampleNumber={index + 1} />
              ))}
            </div> : <div className={styles.empty}><p>{t.favoritesEmpty}</p><a href={partsHref(locale)}>{t.reset}</a></div>}
            {!savedOnly && <nav className={styles.pagination} aria-label={t.demoPagination}>
              <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>{t.previousPage}</button>
              <span aria-current="page">{page}</span>
              <button type="button" disabled={page === demoPages} onClick={() => setPage(page + 1)}>{t.nextPage}</button>
            </nav>}
          </div>
        </div>
      </section>
      <section className={styles.service}><div><p className={styles.kicker}>HD AUTO EXPORT</p><h2>{t.serviceTitle}</h2><p>{t.serviceBody}</p></div><ol>{t.services.map((service, i) => <li key={service}><span>{String(i + 1).padStart(2, '0')}</span>{service}</li>)}</ol></section>
      <section className={styles.enquiry}><h2>{t.enquiryTitle}</h2><p>{t.enquiryBody}</p><div className={styles.contacts}><a href={siteConfig.contacts.telegram.href} target="_blank" rel="noopener noreferrer"><SocialIcon platform="telegram" size={20} />{t.telegram}</a><a href={siteConfig.contacts.whatsapp.href} target="_blank" rel="noopener noreferrer"><SocialIcon platform="whatsapp" size={20} />{t.whatsapp}</a></div></section>
    </div>
  </main>;
}
