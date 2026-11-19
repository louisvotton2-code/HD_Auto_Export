import { createElement } from 'react';
import type { Locale } from '@/i18n/routing';
import { partsCatalogReferenceCount } from '@/shared/config/parts-catalog';
import { companyMetrics } from '../content/company-metrics';
import { homeContent } from '../content/home-content';
import styles from './hero-stats.module.css';

const presetCatalogCount = 470_000;

function HeroValue({ value, locale, suffix, className }: {
  value: number;
  locale: Locale;
  suffix?: string;
  className: string;
}) {
  const final = new Intl.NumberFormat(locale).format(value);
  const animate = value > 0;
  return (
    <>
      <strong className={className} aria-hidden="true" data-counter-target={value}>
        <span className={styles.digits}>
          {animate && createElement('hd-home-count', {
            // The async script owns this one visual text node; React owns the final value and label.
            key: `${locale}:${value}`,
            className: styles.animatedValue,
            lang: locale,
            'data-count-to': value,
            'data-final-text': final,
            'data-counter-value': 0,
            suppressHydrationWarning: true,
          }, '0')}
          {animate
            ? <span className={styles.finalValue} style={{ visibility: 'hidden' }}>{final}</span>
            : <span data-counter-value={value}>{final}</span>}
        </span>
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </strong>
      <span className="sr-only" style={{ position: 'absolute', clipPath: 'inset(50%)' }}>{final}{suffix}</span>
    </>
  );
}

export function HeroStats({
  locale,
  catalogTotal,
}: {
  locale: Locale;
  catalogTotal: number | null;
}) {
  const t = homeContent[locale];
  const metrics = [
    { id: 'catalog', value: catalogTotal, suffix: undefined },
    { id: 'parts', value: partsCatalogReferenceCount, suffix: undefined },
    { id: 'years', value: companyMetrics.yearsOnMarket, suffix: t.yearsSuffix },
  ] as const;
  return (
    <>
      <script async fetchPriority="high" src="/media/home/hero-counts.js" />
      <dl className={styles.stats} data-testid="hero-stats">
        {metrics.map((metric, index) => (
          <div
            className={styles.item}
            data-hero-stat={metric.id}
            data-testid={`hero-stat-${metric.id}`}
            key={metric.id}
          >
            <dt className={styles.label}>
              {metric.value === null ? t.catalogCountPresetLabel : t.stats[index]}
            </dt>
            <dd className={styles.number}>
              {metric.value === null ? (
                <strong className={`${styles.value} ${styles.catalogPreset}`}>
                  {new Intl.NumberFormat(locale).format(presetCatalogCount)}
                  <span className={styles.suffix}>+</span>
                </strong>
              ) : (
                <HeroValue
                  value={metric.value}
                  suffix={metric.suffix}
                  locale={locale}
                  className={metric.id === 'catalog' ? `${styles.value} ${styles.catalogValue}` : styles.value}
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
