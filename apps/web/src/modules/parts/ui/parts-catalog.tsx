'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { CountUpValue } from '@/shared/ui/count-up-value';
import { Icon } from '@/shared/ui/icon';
import { SocialIcon } from '@/shared/ui/social-icon';
import { catalogModels } from '../content/catalog-models';
import { partsContent } from '../content/parts-content';
import {
  catalogPageCount,
  catalogRecordCount,
  filterParts,
  partCategories,
  partsHref,
} from '../query';
import type { Part, PartsQuery } from '../types';
import { usePartFavorites } from '../use-part-favorites';
import { PartCard } from './part-card';
import styles from './parts.module.css';

const filtersId = 'parts-filters';
const catalogAnchor = '#parts-catalog';
const serviceIcons = ['document', 'car', 'calculator', 'box'] as const;

function PartsSearchFields({ locale, value, form }: { locale: Locale; value: string; form?: string }) {
  const t = partsContent[locale];
  return (
    <>
      <Icon name="search" size={18} className={styles.searchIcon} />
      <input
        type="search"
        name="q"
        form={form}
        maxLength={100}
        defaultValue={value}
        placeholder={t.searchHint}
        aria-label={t.search}
      />
      <button className={styles.primary} form={form} type="submit">{t.search}</button>
    </>
  );
}

function PartsPagination({ locale, page }: { locale: Locale; page: number }) {
  const t = partsContent[locale];
  const firstNearby = Math.max(1, Math.min(page - 2, catalogPageCount - 4));
  const nearby = Array.from({ length: Math.min(5, catalogPageCount) }, (_, index) => firstNearby + index);
  const pages = [...new Set([1, ...nearby, catalogPageCount])];
  const submitPage = {
    type: 'submit',
    form: filtersId,
    name: 'page',
    className: styles.pageButton,
  } as const;
  return (
    <nav className={styles.pagination} aria-label={t.pagination}>
      <button {...submitPage} value={page - 1} aria-label={t.previousPage} disabled={page === 1}>←</button>
      {pages.map((number, index) => (
        <Fragment key={number}>
          {index > 0 && number - pages[index - 1]! > 1 && <span aria-hidden="true">…</span>}
          {number === page ? (
            <span className={styles.pageButton} aria-current="page">{number}</span>
          ) : (
            <button
              {...submitPage}
              value={number}
              aria-label={t.pageLabel(number)}
              data-page-secondary={
                number !== 1 && number !== catalogPageCount && Math.abs(number - page) > 1
                  ? '' : undefined
              }
            >
              {number}
            </button>
          )}
        </Fragment>
      ))}
      <button {...submitPage} value={page + 1} aria-label={t.nextPage} disabled={page === catalogPageCount}>→</button>
    </nav>
  );
}

function PartsSupport({ locale }: { locale: Locale }) {
  const t = partsContent[locale];
  const { phone, phone2, telegram, whatsapp } = siteConfig.contacts;
  return (
    <>
      <section className={styles.serviceBanner}>
        <div>
          <h2>{t.serviceTitle}</h2>
          <p>{t.serviceBody}</p>
        </div>
        <a className={styles.primary} href="#parts-enquiry">{t.enquiryAction}<Icon name="arrow" size={16} /></a>
      </section>
      <ul className={styles.serviceFeatures}>
        {t.services.map(([title, body], index) => (
          <li key={title}>
            <Icon name={serviceIcons[index]!} size={24} />
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ul>
      <section className={styles.enquiry} id="parts-enquiry">
        <div className={styles.catalogHeading}>
          <h2>{t.enquiryTitle}</h2>
          <p>{t.enquiryBody}</p>
        </div>
        <div className={styles.enquiryGrid}>
          <div className={styles.contactPanel}>
            <h3>{t.contactLabel}</h3>
            <dl>
              <div><dt>{t.phoneLabel}</dt><dd><a href={phone.href}>{phone.display}</a></dd></div>
              <div><dt>{t.phoneLabel}</dt><dd><a href={phone2.href}>{phone2.display}</a></dd></div>
              <div><dt>Telegram</dt><dd><a href={telegram.href} target="_blank" rel="noopener noreferrer">{telegram.display}</a></dd></div>
            </dl>
          </div>
          <div className={styles.quotePanel}>
            <ul>
              <li><Icon name="document" size={18} />{t.oem}</li>
              <li><Icon name="car" size={18} />{t.fitment}</li>
              <li><Icon name="box" size={18} />{t.quantity}</li>
            </ul>
            <div className={styles.quoteActions}>
              <a className={styles.primary} href={telegram.href} target="_blank" rel="noopener noreferrer"><SocialIcon platform="telegram" size={18} />{t.telegram}</a>
              <a className={styles.primary} href={whatsapp.href} target="_blank" rel="noopener noreferrer"><SocialIcon platform="whatsapp" size={18} />{t.whatsapp}</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function PartsCatalog({
  parts,
  locale,
  initialQuery: query,
  page,
  invalid = false,
}: {
  parts: readonly Part[];
  locale: Locale;
  initialQuery: PartsQuery;
  page: number;
  invalid?: boolean;
}) {
  const t = partsContent[locale];
  const [savedOnly, setSavedOnly] = useState(false);
  const [ready, setReady] = useState(false);
  const knownIds = useMemo(() => parts.map((part) => part.slug), [parts]);
  const { ids } = usePartFavorites(knownIds);
  const savedParts = parts.filter((part) => ids.includes(part.slug));
  const visible = savedOnly ? savedParts : filterParts(parts, query, locale);
  const brands = [...new Set(parts.map((part) => part.brand))];
  const stats = [partCategories.length, catalogRecordCount, parts.length];
  const referenceCount = t.referenceCount(catalogRecordCount.toLocaleString(locale));
  const key = JSON.stringify(query);
  const catalogUrl = partsHref(locale) + catalogAnchor;
  useEffect(() => setReady(true), []);

  return (
    <main id="main" className={`${styles.page} ${styles.catalogPage}`} data-testid="parts-catalog">
      <section className={styles.hero}>
        <div className={styles.wrap}>
          <p className={styles.kicker}>{t.kicker}</p>
          <h1>{t.title} <span>{t.titleAccent}</span></h1>
          <p className={styles.heroText}>{t.subtitle}</p>
          <form key={`hero-${key}`} className={styles.search} method="get" action={catalogUrl}>
            {Object.entries(query)
              .filter(([name, value]) => name !== 'q' && value)
              .map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
            <PartsSearchFields locale={locale} value={query.q} />
          </form>
          <div className={styles.stats}>
            {stats.map((value, index) => (
              <div key={t.stats[index]}>
                <CountUpValue value={value} locale={locale} className={styles.statValue} />
                <span className={styles.statLabel}>{t.stats[index]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className={styles.wrap}>
        <section className={styles.quick}>
          <p className={styles.kicker}>{t.quickBrowse}</p>
          <div>
            {catalogModels.map(([brand, model]) => (
              <a key={model} href={catalogAnchor}>
                <span className={styles.modelIcon} data-model-brand={brand} aria-hidden="true">{brand[0]}</span>
                {model}
              </a>
            ))}
          </div>
        </section>
        <section id="parts-catalog" className={styles.catalog}>
          <div className={styles.catalogHeading}>
            <h2>{t.catalog}</h2>
            <p>{t.catalogBody}</p>
          </div>
          <div className={`${styles.search} ${styles.catalogSearch}`} key={`search-${key}`}>
            <PartsSearchFields locale={locale} value={query.q} form={filtersId} />
          </div>
          <div className={styles.layout}>
            <form id={filtersId} key={`filters-${key}`} className={styles.filters} method="get" action={catalogUrl}>
              <h3>{t.filters}</h3>
              <fieldset>
                <legend>{t.brand}</legend>
                <label><input type="radio" name="brand" value="" defaultChecked={!query.brand} />{t.all}</label>
                {brands.map((brand) => (
                  <label key={brand}>
                    <input type="radio" name="brand" value={brand} defaultChecked={query.brand === brand} />
                    {brand}<small>{parts.filter((part) => part.brand === brand).length}</small>
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>{t.category}</legend>
                <label><input type="radio" name="category" value="" defaultChecked={!query.category} />{t.all}</label>
                {partCategories.map((category) => (
                  <label key={category}>
                    <input type="radio" name="category" value={category} defaultChecked={query.category === category} />
                    {t.categories[category]}<small>{parts.filter((part) => part.category === category).length}</small>
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>{t.price}</legend>
                <div className={styles.priceRange}>
                  <input name="min" inputMode="decimal" defaultValue={query.min} placeholder="0" aria-label={t.min} />
                  <input name="max" inputMode="decimal" defaultValue={query.max} placeholder="∞" aria-label={t.max} />
                </div>
              </fieldset>
              <button className={styles.primary} type="submit">{t.apply}</button>
              <a href={catalogUrl}>{t.reset}</a>
            </form>
            <div className={styles.results}>
              {ready && (
                <div className={styles.savedTabs}>
                  <button type="button" aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>{t.allParts}</button>
                  <button type="button" aria-pressed={savedOnly} data-testid="saved-parts-filter" onClick={() => setSavedOnly(true)}>
                    {t.favorites} ({savedParts.length})
                  </button>
                </div>
              )}
              <div className={styles.resultsBar}>
                <p aria-live="polite">
                  {savedOnly || !visible.length ? t.count(visible.length) : t.shownRange(visible.length)}
                  {!savedOnly && <span className={styles.referenceCount}>{referenceCount}</span>}
                </p>
                <label className={styles.sort}>
                  {t.sort}
                  <select key={`sort-${key}`} name="sort" form={filtersId} defaultValue={query.sort} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
                    <option value="default">{t.defaultSort}</option>
                    <option value="price-asc">{t.ascending}</option>
                    <option value="price-desc">{t.descending}</option>
                    <option value="name">{t.byName}</option>
                  </select>
                </label>
              </div>
              {invalid && <p className={styles.error} role="alert">{t.invalidPrice}</p>}
              {visible.length > 0 ? (
                <div className={styles.grid}>
                  {visible.map((part) => <PartCard key={part.slug} part={part} locale={locale} />)}
                </div>
              ) : (
                <div className={styles.empty}>
                  <p>{savedOnly ? t.favoritesEmpty : t.empty}</p>
                  <a href={catalogUrl}>{savedOnly ? t.allParts : t.reset}</a>
                </div>
              )}
              {!savedOnly && visible.length > 0 && <PartsPagination locale={locale} page={page} />}
            </div>
          </div>
        </section>
        <PartsSupport locale={locale} />
      </div>
    </main>
  );
}
