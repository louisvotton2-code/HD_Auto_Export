'use client';

import type { Locale } from '@/i18n/routing';
import { approximateCatalogVehicleCount, companyMetrics } from '../content/company-metrics';
import { homeContent } from '../content/home-content';
import { CountUpValue } from '@/shared/ui/count-up-value';
import styles from './hero-stats.module.css';

export function HeroStats({ locale }: { locale: Locale }) {
  const t = homeContent[locale];
  const metrics = [
    { id: 'catalog', value: approximateCatalogVehicleCount },
    {
      id: 'clients',
      value: companyMetrics.happyClients,
      suffix: companyMetrics.happyClientsSuffix,
      animated: true,
    },
    { id: 'years', value: companyMetrics.yearsOnMarket, suffix: t.yearsSuffix, animated: false },
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
            {t.stats[index]}
            {metric.id === 'catalog' && <><wbr />{t.catalogApproximation}</>}
          </dt>
          <dd className={styles.number}>
            {metric.id === 'catalog' ? (
              <strong className={`${styles.value} ${styles.catalogValue}`}>
                {new Intl.NumberFormat(locale).format(metric.value)}
              </strong>
            ) : (
              <CountUpValue
                value={metric.value}
                suffix={metric.suffix}
                locale={locale}
                animated={metric.animated}
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
