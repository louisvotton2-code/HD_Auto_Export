'use client';

import { useEffect, useRef, useState } from 'react';
import { recordPublicAnalyticsAction } from '@/shared/lib/public-analytics-actions';
import { currentAnalyticsGrant } from '@/shared/lib/tracking-consent';

/** The forms recalculate as the user types. Report one settled result per edit, never defaults. */
export function useCalculatorCompletion(successful: boolean) {
  const [attempt, setAttempt] = useState(0);
  const reported = useRef(0);
  const grant = useRef<number | null>(null);
  useEffect(() => {
    if (!successful || attempt <= reported.current) return;
    const timer = setTimeout(() => {
      reported.current = attempt;
      if (grant.current !== null && grant.current === currentAnalyticsGrant())
        recordPublicAnalyticsAction('calculator_complete');
    }, 450);
    return () => clearTimeout(timer);
  }, [attempt, successful]);
  return () => {
    grant.current = currentAnalyticsGrant();
    if (grant.current !== null) setAttempt(previous => previous + 1);
  };
}
