'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Locale } from '@/i18n/routing';
import { animateCount } from '@/shared/lib/count-up';

export function CountUpValue({
  value,
  locale,
  suffix = '',
  animated = true,
  className,
  suffixClassName,
}: {
  value: number | null;
  locale: Locale;
  suffix?: string;
  animated?: boolean;
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
      <strong className={className} aria-hidden="true" data-counter-target={count ?? 'unknown'}>
        <span ref={text} data-counter-value={count ?? 'unknown'}>{finalNumber}</span>
        {count !== null && suffix && <span className={suffixClassName}>{suffix}</span>}
      </strong>
      <span className="sr-only">
        {finalNumber}{count === null ? '' : suffix}
      </span>
    </>
  );
}
