'use client';

import type { Locale } from '@/i18n/routing';
import { companyMetrics } from '../content/company-metrics';
import { homeContent } from '../content/home-content';
import { CountUpValue } from '@/shared/ui/count-up-value';
import styles from './hero-stats.module.css';

const presetCatalogCount = 470_000;

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
    {
      id: 'clients',
      value: companyMetrics.happyClients,
      suffix: companyMetrics.happyClientsSuffix,
    },
    { id: 'years', value: companyMetrics.yearsOnMarket, suffix: t.yearsSuffix },
  ] as const;
  return (
    <dl className={styles.stats} data-testid="hero-stats">
      {metrics.map((metric, index) => (
        <div
          className={styles.item}
          data-hero-stat={metric.id}
          data-testid={`hero-stat-${metric.id}`}
          key={metric.id}
        >
          <dt className={styles.label}>
            {metric.id === 'catalog' && metric.value === null ? t.catalogCountPresetLabel : t.stats[index]}
          </dt>
          <dd className={styles.number}>
            {metric.id === 'catalog' && metric.value === null ? (
              <strong className={`${styles.value} ${styles.catalogPreset}`}>
                {new Intl.NumberFormat(locale).format(presetCatalogCount)}
                <span className={styles.suffix}>+</span>
              </strong>
            ) : (
              <CountUpValue
                value={metric.value}
                suffix={metric.suffix}
                locale={locale}
                startAtZero
                className={metric.id === 'catalog' ? `${styles.value} ${styles.catalogValue}` : styles.value}
                suffixClassName={styles.suffix}
              />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
