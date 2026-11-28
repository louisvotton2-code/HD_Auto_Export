'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { formatTruncatedDisplayAmount } from '@/shared/lib/display-amount';
import { Icon } from '@/shared/ui/icon';
import { usePublicVehicleSegment } from '../application/use-public-vehicle-segment';
import { usePublicFreshness } from '../application/use-public-resource';
import { publicVehicleRecordsCopy } from '../public-vehicle-records-copy';
import { VehiclePriceHistoryChart } from './vehicle-price-history-chart';
import styles from './public-detail.module.css';
import recordsStyles from './public-vehicle-records.module.css';

type ControlsResource = {
  phase: string;
  started: boolean;
  hasMore: boolean;
  retryAfter: number;
  loadMore: () => void;
  restart: () => void;
};

function Controls({ resource, locale, initialLabel, repeatable = false }: {
  resource: ControlsResource;
  locale: Locale;
  initialLabel: string;
  repeatable?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const fresh = usePublicFreshness() === 'fresh';
  const copy = publicVehicleRecordsCopy[locale];
  const loading = resource.phase === 'loading';
  const waiting = resource.retryAfter > 0;
  const changed = resource.phase === 'changed';
  const restart = changed || (repeatable && resource.phase === 'ready' && !resource.hasMore);
  const showButton = resource.phase !== 'missing' && (resource.phase !== 'ready' || resource.hasMore || repeatable);
  const message = loading ? copy.loading : changed ? copy.changed
    : waiting ? copy.retryIn.replace('{seconds}', resource.retryAfter.toLocaleString(locale))
      : resource.phase === 'error' ? copy.error : '';
  const label = loading ? copy.loading : waiting ? copy.retryIn.replace('{seconds}', resource.retryAfter.toLocaleString(locale))
    : restart ? copy.reload : resource.phase === 'error' ? copy.retry : resource.started ? copy.loadMore : initialLabel;
  return <div className={recordsStyles.controls} aria-busy={loading}>
    <div className={recordsStyles.status} role="status" aria-live="polite" aria-atomic="true">{message && <p>{message}</p>}</div>
    {mounted && showButton && <button type="button" className={recordsStyles.action}
      onClick={restart ? resource.restart : resource.loadMore} disabled={loading || waiting || !fresh}>{label}</button>}
    <noscript><p className={recordsStyles.notice}>{copy.enableDetails}</p></noscript>
  </div>;
}

/** Historical amounts are rendered without the current vehicle's USD or FX projection. */
export function PublicVehiclePriceHistory({ vehicle, locale }: { vehicle: PublicVehicle; locale: Locale }) {
  const resource = usePublicVehicleSegment('price-history', vehicle, locale);
  const fresh = usePublicFreshness() === 'fresh';
  const copy = publicVehicleRecordsCopy[locale];
  const id = `vehicle-price-history-${vehicle.id}`;
  const section = useRef<HTMLElement>(null);
  const scrolledTo = useRef<string | null>(null);
  const requestedFromLink = useRef<string | null>(null);
  const waiting = resource.retryAfter > 0;
  const openLinkedHistory = useEffectEvent(() => {
    if (!fresh || window.location.hash !== `#${id}`) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current !== id) {
      scrolledTo.current = id;
      section.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    if (resource.phase !== 'idle' || waiting || requestedFromLink.current === id) return;
    requestedFromLink.current = id;
    resource.loadMore();
  });
  useEffect(() => {
    if (!fresh) return;
    const open = () => openLinkedHistory();
    // The detail's scroll reset and Strict Mode's setup/cleanup finish before the deep link opens.
    const timer = window.setTimeout(open, 0);
    window.addEventListener('hashchange', open);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', open);
    };
  }, [fresh, id, waiting]);
  const changed = resource.phase === 'changed';
  // An explicit zone keeps the SSR and browser on the same date and preserves the source instant.
  const date = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return <section ref={section} id={id} tabIndex={-1} className={`${styles.card} ${recordsStyles.section}`} data-public-price-history aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className={styles.cardHeading}><Icon name="clock" className={styles.historyIcon} size={19} />{copy.priceHistory}</h2>
    <div className={recordsStyles.body}>
      <p className={recordsStyles.notice}>{copy.originalCurrency}</p>
      {!changed && resource.items.length > 0 && <>
        {resource.hasMore && <p className={recordsStyles.notice}>{copy.priceTrendPending}</p>}
        {resource.phase === 'ready' && !resource.hasMore && <VehiclePriceHistoryChart items={resource.items} locale={locale} />}
        <table className={recordsStyles.history} aria-labelledby={`${id}-title`}>
          <thead><tr><th scope="col">{copy.priceDate}</th><th scope="col">{copy.priceAmount}</th><th scope="col">{copy.priceCurrency}</th></tr></thead>
          <tbody>{resource.items.map(item => <tr key={item.id} data-price-history-item={item.id}>
            <td>{item.at ? <time dateTime={item.at}>{date.format(new Date(item.at))}</time> : copy.unknownDate}</td>
            <td><bdi>{formatTruncatedDisplayAmount(item.money.amount, locale)}</bdi></td>
            <td><bdi>{item.money.currency}</bdi></td>
          </tr>)}</tbody>
        </table>
      </>}
      {resource.phase === 'ready' && resource.total === 0 && <p className={recordsStyles.status}>{copy.noPriceHistory}</p>}
      <Controls resource={resource} locale={locale} initialLabel={copy.viewPriceHistory} />
    </div>
  </section>;
}
