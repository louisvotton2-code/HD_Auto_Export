'use client';

import type { Locale } from '@/i18n/routing';
import { companyMetrics } from '../content/company-metrics';
import { homeContent } from '../content/home-content';
import { CountUpValue } from '@/shared/ui/count-up-value';
import styles from './hero-stats.module.css';

/** API catalog totals and user-confirmed company figures have distinct sources. */
export function HeroStats({
  locale,
  catalogCount,
}: {
  locale: Locale;
  catalogCount: number | null;
}) {
  const t = homeContent[locale];
  const metrics = [
    { id: 'catalog', value: catalogCount, suffix: '', animated: true },
    {
      id: 'clients',
      value: companyMetrics.happyClients,
      suffix: companyMetrics.happyClientsSuffix,
      animated: true,
    },
    { id: 'years', value: companyMetrics.yearsOnMarket, suffix: t.yearsSuffix, animated: false },
  ];
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
            <CountUpValue
              value={metric.value}
              suffix={metric.suffix}
              locale={locale}
              animated={metric.animated}
              className={styles.value}
              suffixClassName={styles.suffix}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
