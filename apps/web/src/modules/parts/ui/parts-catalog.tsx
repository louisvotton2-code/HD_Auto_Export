'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { SocialIcon } from '@/shared/ui/social-icon';
import { partsContent } from '../content/parts-content';
import { partCategories, partsHref } from '../query';
import type { Part, PartsQuery } from '../types';
import { PartCard } from './part-card';
import { usePartFavorites } from '../use-part-favorites';
import styles from './parts.module.css';

const catalogSize = 12;

export function PartsCatalog({ parts, locale, initialQuery: query, invalid = false }: { parts: readonly Part[]; locale: Locale; initialQuery: PartsQuery; invalid?: boolean }) {
  const t = partsContent[locale];
  const [savedOnly, setSavedOnly] = useState(false);
  const [ready, setReady] = useState(false);
  const knownIds = useMemo(() => parts.map((part) => part.slug), [parts]);
  const { ids } = usePartFavorites(knownIds);
  const savedParts = parts.filter((part) => ids.includes(part.slug));
  const catalogParts = parts.slice(0, catalogSize);
  const visible = savedOnly ? savedParts : catalogParts;
  const brands = [...new Set(parts.map((part) => part.brand))];
  const key = JSON.stringify(query);
  useEffect(() => setReady(true), []);
  return <main id="main" className={styles.page} data-testid="parts-catalog">
    <section className={styles.hero}><div className={styles.wrap}>
      <p className={styles.kicker}>{t.kicker}</p>
      <h1>{t.title} <span>{t.titleAccent}</span></h1><p className={styles.heroText}>{t.subtitle}</p>
      <form key={`hero-${key}`} className={styles.search} method="get" action={partsHref(locale)}>
        {Object.entries(query).filter(([name, value]) => name !== 'q' && value).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <span aria-hidden="true">⌕</span><input name="q" type="search" maxLength={100} defaultValue={query.q} placeholder={t.searchHint} aria-label={t.search} />
        <button className={styles.primary} type="submit">{t.search}</button>
      </form>
      <div className={styles.stats}>{[catalogParts.length, partCategories.length, 'USD'].map((value, i) => <div key={t.stats[i]}><strong>{value}</strong><span>{t.stats[i]}</span></div>)}</div>
    </div></section>
    <div className={styles.wrap}>
      <section className={styles.quick}><p className={styles.kicker}>{t.quickBrowse}</p><div>{partCategories.map((category) => <a key={category} href={`${partsHref(locale, { ...query, category })}#parts-catalog`} aria-current={query.category === category ? 'true' : undefined}>{t.categories[category]}</a>)}</div></section>
      <section id="parts-catalog" className={styles.catalog}>
        <div className={styles.catalogHeading}><h2>{t.catalog}</h2><p>{t.catalogBody}</p></div>
        <div className={`${styles.search} ${styles.catalogSearch}`} key={`search-${key}`}><span aria-hidden="true">⌕</span><input form="parts-filters" type="search" name="q" maxLength={100} defaultValue={query.q} placeholder={t.searchHint} aria-label={t.search} /><button className={styles.primary} form="parts-filters" type="submit">{t.search}</button></div>
        <div className={styles.layout}>
          <form id="parts-filters" key={`filters-${key}`} className={styles.filters} method="get" action={partsHref(locale)}>
            <h3>{t.filters}</h3>
            <label>{t.brand}<select name="brand" defaultValue={query.brand}><option value="">{t.all}</option>{brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></label>
            <fieldset><legend>{t.category}</legend><label><input type="radio" name="category" value="" defaultChecked={!query.category} />{t.all}</label>{partCategories.map((category) => <label key={category}><input type="radio" name="category" value={category} defaultChecked={query.category === category} />{t.categories[category]}<small>{catalogParts.filter((part) => part.category === category).length}</small></label>)}</fieldset>
            <fieldset><legend>{t.price}</legend><div className={styles.priceRange}><input name="min" inputMode="decimal" defaultValue={query.min} placeholder="0" aria-label={t.min} /><input name="max" inputMode="decimal" defaultValue={query.max} placeholder="∞" aria-label={t.max} /></div></fieldset>
            <button className={styles.primary} type="submit">{t.apply}</button>
            <a href={partsHref(locale)}>{t.reset}</a>
          </form>
          <div className={styles.results}>
            {ready && <div className={styles.savedTabs}><button type="button" aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>{t.allParts}</button><button type="button" aria-pressed={savedOnly} data-testid="saved-parts-filter" onClick={() => setSavedOnly(true)}>{t.favorites} ({savedParts.length})</button></div>}
            <div className={styles.resultsBar}><p aria-live="polite">{t.count(visible.length)}</p><label className={styles.sort}>{t.sort}<select key={`sort-${key}`} name="sort" form="parts-filters" defaultValue={query.sort} onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="default">{t.defaultSort}</option><option value="price-asc">{t.ascending}</option><option value="price-desc">{t.descending}</option><option value="name">{t.byName}</option></select></label></div>
            {invalid && <p className={styles.error} role="alert">{t.invalidPrice}</p>}
            {visible.length || !savedOnly ? <div className={styles.grid}>
              {visible.map((part) => <PartCard key={part.slug} part={part} locale={locale} />)}
            </div> : <div className={styles.empty}><p>{t.favoritesEmpty}</p><a href={partsHref(locale)}>{t.allParts}</a></div>}
          </div>
        </div>
      </section>
      <section className={styles.service}><div><p className={styles.kicker}>HD AUTO EXPORT</p><h2>{t.serviceTitle}</h2><p>{t.serviceBody}</p></div><ol>{t.services.map((service, i) => <li key={service}><span>{String(i + 1).padStart(2, '0')}</span>{service}</li>)}</ol></section>
      <section className={styles.enquiry}><h2>{t.enquiryTitle}</h2><p>{t.enquiryBody}</p><div className={styles.contacts}><a href={siteConfig.contacts.telegram.href} target="_blank" rel="noopener noreferrer"><SocialIcon platform="telegram" size={20} />{t.telegram}</a><a href={siteConfig.contacts.whatsapp.href} target="_blank" rel="noopener noreferrer"><SocialIcon platform="whatsapp" size={20} />{t.whatsapp}</a></div></section>
    </div>
  </main>;
}
