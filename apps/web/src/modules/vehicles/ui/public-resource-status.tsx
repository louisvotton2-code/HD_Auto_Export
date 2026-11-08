'use client';
import type { Locale } from '@/i18n/routing';
import type { PublicFreshness } from '../application/use-public-resource';
import { liveVehicleCopy } from '../live-copy';

export function PublicResourceStatus({
  locale,
  phase,
  retry,
  retryAfter = 0,
  fallbackHref,
  floating = false,
}: {
  locale: Locale;
  phase: PublicFreshness;
  retry: () => void;
  retryAfter?: number;
  fallbackHref?: string;
  floating?: boolean;
}) {
  const t = liveVehicleCopy[locale];
  return (
    <div
      role="status"
      className={
        floating && phase !== 'fresh'
          ? 'public-resource-status public-resource-floating'
          : 'public-resource-status'
      }
      data-testid="public-resource-status"
      hidden={phase === 'fresh'}
    >
      <span>{retryAfter > 0 ? t.rateLimited : phase === 'checking' ? t.checking : t.error}</span>
      {phase === 'error' && (
        <button type="button" onClick={retry} disabled={retryAfter > 0}>
          {retryAfter > 0
            ? t.retryIn.replace('{seconds}', retryAfter.toLocaleString(locale))
            : t.retry}
        </button>
      )}
      {retryAfter > 0 && fallbackHref && (
        <noscript>
          <a href={fallbackHref}>{t.retry}</a>
        </noscript>
      )}
    </div>
  );
}
