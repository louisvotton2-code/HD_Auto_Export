'use client';
import Link from 'next/link';
import type { Locale } from '@/i18n/routing';
import { partsContent } from '../content/parts-content';
import { buildPartContactLinks } from '../contact';
import { partHref } from '../query';
import { PartSaveButton } from './part-save-button';
import type { Part } from '../types';
import styles from './parts.module.css';

export function PartCard({ part, locale, sampleNumber }: { part: Part; locale: Locale; sampleNumber?: number }) {
  const t = partsContent[locale];
  if (sampleNumber !== undefined) {
    const code = `DEMO-${String(sampleNumber).padStart(3, '0')}`;
    return <article className={styles.card} data-part={code}>
      <div className={`${styles.cardImage} ${styles.sampleImage}`} aria-hidden="true">{code}</div>
      <div className={styles.cardBody}>
        <span className={styles.category}>{t.categories[part.category]}</span>
        <span className={styles.oem}>{t.demoPart}</span>
        <h3>{part.name[locale]}</h3>
        <div className={styles.cardFoot}><small>{t.demoUnavailable}</small></div>
      </div>
    </article>;
  }
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
