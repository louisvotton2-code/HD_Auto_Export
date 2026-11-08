'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/routing';
import { SocialIcon } from '@/shared/ui/social-icon';
import { partsContent } from '../content/parts-content';
import { buildPartContactLinks } from '../contact';
import { partHref, partsHref, parsePartQuantity } from '../query';
import type { Part } from '../types';
import { PartCard } from './part-card';
import { PartGallery } from './part-gallery';
import { PartSaveButton } from './part-save-button';
import { usePartFavorites } from '../use-part-favorites';
import styles from './parts.module.css';

export function PartDetail({ part, related, locale, knownPartIds, initialQuantity = 1 }: { part: Part; related: readonly Part[]; locale: Locale; knownPartIds: readonly string[]; initialQuantity?: number }) {
  usePartFavorites(knownPartIds);
  const t = partsContent[locale], [quantity, setQuantity] = useState(initialQuantity), [draft, setDraft] = useState(String(initialQuantity)), [enhanced, setEnhanced] = useState(false);
  const parsed = parsePartQuantity(draft), invalid = parsed === null;
  const links = buildPartContactLinks(part, locale, quantity);
  useEffect(() => setEnhanced(true), []);
  function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (parsed === null) return; setQuantity(parsed);
    window.history.replaceState(null, '', `${partHref(locale, part.slug)}?quantity=${parsed}`);
  }
  function step(delta: number) { const next = Math.min(999, Math.max(1, (parsed ?? quantity) + delta)); setDraft(String(next)); setQuantity(next); }
  return <main id="main" className={`${styles.page} ${styles.detail}`} data-testid="part-detail" data-part-detail={part.slug}>
    <div className={styles.wrap}>
      <nav className={styles.breadcrumb} aria-label={t.back}><Link href={`/${locale}/`}>{t.home}</Link><span>/</span><Link href={partsHref(locale)}>{t.catalog}</Link><span>/</span><span>{part.oem}</span></nav>
      <div className={styles.detailGrid}>
        <div><PartGallery images={part.images} title={part.name[locale]} locale={locale} /><section className={styles.specifications}><h2>{t.specifications}</h2><dl><div><dt>{t.oem}</dt><dd>{part.oem}</dd></div><div><dt>{t.brand}</dt><dd>{part.brand || t.unknown}</dd></div><div><dt>{t.category}</dt><dd>{t.categories[part.category]}</dd></div></dl></section></div>
        <aside className={styles.detailPanel}>
          <p className={styles.kicker}>{t.categories[part.category]}</p><h1>{part.name[locale]}</h1><p className={styles.detailOem}>{part.oem}</p><PartSaveButton slug={part.slug} locale={locale} detail />
          <div className={styles.detailPrice}><p>{t.referencePrice}</p><strong>{part.referencePriceUsd === null ? t.priceOnRequest : `$${part.referencePriceUsd.toLocaleString(locale)}`}</strong><small>{t.priceNote}</small></div>
          <form className={styles.quantityForm} method="get" action={partHref(locale, part.slug)} onSubmit={update}>
            <label htmlFor="part-quantity">{t.quantity}</label>
            <div>{enhanced && <button type="button" aria-label={t.decrease} disabled={(parsed ?? quantity) <= 1} onClick={() => step(-1)}>−</button>}<input id="part-quantity" name="quantity" type="number" min="1" max="999" step="1" required value={draft} onChange={(event) => { setDraft(event.target.value); const next = parsePartQuantity(event.target.value); if (next !== null) setQuantity(next); }} />{enhanced && <button type="button" aria-label={t.increase} disabled={(parsed ?? quantity) >= 999} onClick={() => step(1)}>+</button>}<button className={styles.secondary} type="submit">{t.updateQuantity}</button></div>
            <small>{t.quantityHelp}</small>{invalid && <p className={styles.error} role="alert">{t.invalidQuantity}</p>}
          </form>
          <div className={styles.detailContacts} data-part-contacts={part.slug}>
            <a href={invalid ? undefined : links.telegram} aria-disabled={invalid || undefined} tabIndex={invalid ? -1 : undefined} target="_blank" rel="noopener noreferrer"><SocialIcon platform="telegram" size={20} />{t.telegram}</a>
            <a href={invalid ? undefined : links.whatsapp} aria-disabled={invalid || undefined} tabIndex={invalid ? -1 : undefined} target="_blank" rel="noopener noreferrer"><SocialIcon platform="whatsapp" size={20} />{t.whatsapp}</a>
          </div>
          <p className={styles.note}>{t.contactNote}</p>
          <section className={styles.fitment}><h2>{t.fitment}</h2><p>{t.fitmentBody}</p></section>
        </aside>
      </div>
      {related.length > 0 && <section className={styles.related}><h2>{t.related}</h2><p>{t.relatedBody}</p><div className={styles.relatedGrid}>{related.map((item) => <PartCard key={item.slug} part={item} locale={locale} />)}</div></section>}
    </div>
  </main>;
}
