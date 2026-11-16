'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Locale } from '@/i18n/routing';
import { animateCount } from '@/shared/lib/count-up';
import styles from './count-up-value.module.css';

export function CountUpValue({
  value,
  locale,
  suffix = '',
  animated = true,
  startAtZero = false,
  className,
  suffixClassName,
}: {
  value: number | null;
  locale: Locale;
  suffix?: string;
  animated?: boolean;
  startAtZero?: boolean;
  className?: string;
  suffixClassName?: string;
}) {
  const text = useRef<HTMLSpanElement>(null);
  const count = value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale],
  );
  const finalNumber = count === null ? '—' : formatter.format(count);
  const startsAtZero = startAtZero && animated && count !== null && count > 0;

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
    let pendingStart: number | undefined;
    let stopAnimation: (() => void) | undefined;
    const start = () => {
      pendingStart = undefined;
      stopAnimation = animateCount(
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
    };
    // Let the first frame paint the SSR zero before advancing the number.
    if (startsAtZero) pendingStart = requestAnimationFrame(start);
    else start();
    const stop = () => {
      if (pendingStart !== undefined) cancelAnimationFrame(pendingStart);
      stopAnimation?.();
    };
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
  }, [count, formatter, animated, startsAtZero]);

  return (
    <>
      <strong className={className} aria-hidden="true" data-counter-target={count ?? 'unknown'}>
        <span
          ref={text}
          className={startsAtZero ? styles.animatedValue : undefined}
          data-counter-value={startsAtZero ? 0 : count ?? 'unknown'}
        >
          {startsAtZero ? formatter.format(0) : finalNumber}
        </span>
        {startsAtZero && <span className={styles.staticValue} hidden>{finalNumber}</span>}
        {count !== null && suffix && <span className={suffixClassName}>{suffix}</span>}
      </strong>
      <span
        className="sr-only"
        // Keep the spoken final value off screen even before site styles arrive.
        style={startsAtZero ? { position: 'absolute', clipPath: 'inset(50%)' } : undefined}
      >
        {finalNumber}{count === null ? '' : suffix}
      </span>
    </>
  );
}
