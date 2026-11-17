'use client';

import type { Locale } from '@/i18n/routing';
import { companyMetrics } from '../content/company-metrics';
import { homeContent } from '../content/home-content';
import { CountUpValue } from '@/shared/ui/count-up-value';
import styles from './hero-stats.module.css';

export function HeroStats({
  locale,
  catalogTotal,
}: {
  locale: Locale;
  catalogTotal: number | null;
}) {
  const t = homeContent[locale];
  const metrics = [
    { id: 'catalog', value: catalogTotal },
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
          <dt className={styles.label}>{t.stats[index]}</dt>
          <dd className={styles.number}>
            {metric.id === 'catalog' ? (
              <strong className={`${styles.value} ${styles.catalogValue}`}>
                {metric.value === null ? '—' : new Intl.NumberFormat(locale).format(metric.value)}
              </strong>
            ) : (
              <CountUpValue
                value={metric.value}
                suffix={metric.suffix}
                locale={locale}
                startAtZero
                className={styles.value}
                suffixClassName={styles.suffix}
              />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
