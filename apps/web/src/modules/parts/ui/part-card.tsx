'use client';
import Link from 'next/link';
import type { Locale } from '@/i18n/routing';
import { partsContent } from '../content/parts-content';
import { buildPartContactLinks } from '../contact';
import { partHref } from '../query';
import { PartSaveButton } from './part-save-button';
import type { Part } from '../types';
import styles from './parts.module.css';

export function PartCard({ part, locale }: { part: Part; locale: Locale }) {
  const t = partsContent[locale];
  return <article className={styles.card} data-part={part.slug}>
    <div className={styles.cardImage}>
      <Link href={partHref(locale, part.slug)} prefetch={false} tabIndex={-1} aria-hidden="true">
        {part.images[0] ? <img src={part.images[0].url} alt={`${part.name[locale]} · ${t.referenceImage}`} width={1000} height={1000} loading="lazy" /> : <span>{part.oem}</span>}
      </Link>
      <PartSaveButton slug={part.slug} locale={locale} />
    </div>
    <div className={styles.cardBody}>
      <span className={styles.category}>{t.categories[part.category]}</span>
      <span className={styles.oem}>{part.oem}</span>
      <h3><Link href={partHref(locale, part.slug)} prefetch={false}>{part.name[locale]}</Link></h3>
      <div className={styles.cardFoot}>
        <div><small>{t.referencePrice}</small><strong>{part.referencePriceUsd === null ? t.priceOnRequest : `$${part.referencePriceUsd.toLocaleString(locale)}`}</strong></div>
        <a className={styles.cardContact} href={buildPartContactLinks(part, locale).whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`${t.whatsapp} · ${part.oem}`}>↗</a>
      </div>
    </div>
  </article>;
}
