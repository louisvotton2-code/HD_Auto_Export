'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Locale } from '@/i18n/routing';
import { companyMetrics } from '../content/company-metrics';
import { homeContent } from '../content/home-content';
import { animateCount } from './count-up';
import styles from './hero-stats.module.css';

function CountUpValue({
  value,
  locale,
  suffix = '',
  animated = true,
}: {
  value: number | null;
  locale: Locale;
  suffix?: string;
  animated?: boolean;
}) {
  const text = useRef<HTMLSpanElement>(null);
  const count = value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale],
  );
  const finalNumber = count === null ? '—' : formatter.format(count);

  useLayoutEffect(() => {
    const element = text.current;
    if (!element || count === null) return;
    const finish = () => {
      element.textContent = formatter.format(count);
      element.dataset.counterValue = String(count);
    };
    if (!animated) {
      finish();
      return;
    }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) {
      finish();
      return;
    }
    const stop = animateCount(
      count,
      (value) => {
        element.textContent = formatter.format(value);
        element.dataset.counterValue = String(value);
      },
      {
        now: () => performance.now(),
        request: (callback) => requestAnimationFrame(callback),
        cancel: (id) => cancelAnimationFrame(id),
      },
    );
    const reduceMotion = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      stop();
      finish();
    };
    preference.addEventListener('change', reduceMotion);
    return () => {
      stop();
      preference.removeEventListener('change', reduceMotion);
    };
  }, [count, formatter, animated]);

  return (
    <>
      <strong className={styles.value} aria-hidden="true" data-counter-target={count ?? 'unknown'}>
        <span ref={text} data-counter-value={count ?? 'unknown'}>{finalNumber}</span>
        {count !== null && suffix && <span className={styles.suffix}>{suffix}</span>}
      </strong>
      <span className={styles.srOnly}>
        {finalNumber}{count === null ? '' : suffix}
      </span>
    </>
  );
}

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
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
