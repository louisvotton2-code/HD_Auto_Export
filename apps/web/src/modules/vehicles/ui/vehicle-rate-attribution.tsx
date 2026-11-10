import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicUsdQuote } from '@/shared/lib/public-vehicle-price';
import styles from './vehicle-rate-attribution.module.css';

const dateLabel = {
  zh: '换算汇率日期',
  en: 'Exchange rates as of',
  ru: 'Курс на дату',
} satisfies Record<Locale, string>;

export function VehicleRateAttribution({
  vehicles,
  locale,
  className,
}: {
  vehicles: readonly PublicVehicle[];
  locale: Locale;
  className?: string;
}) {
  const dates = new Set<string>();
  let attributed = false;
  for (const vehicle of vehicles) {
    const conversion = publicUsdQuote(vehicle)?.conversion;
    if (!conversion) continue;
    dates.add(conversion.asOf.slice(0, 10));
    if (conversion.source === 'exchange_rate_api') attributed = true;
  }
  if (!dates.size) return null;

  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <p className={className ? `${styles.note} ${className}` : styles.note} data-vehicle-rate-note>
      {dateLabel[locale]}{' '}
      {[...dates].sort().map((date, index) => (
        <span key={date}>
          {index > 0 && ', '}
          <time dateTime={date}>{format.format(new Date(date))}</time>
        </span>
      ))}
      {attributed && (
        <>
          {' · '}
          <a href="https://www.exchangerate-api.com" lang="en">Rates By Exchange Rate API</a>
        </>
      )}
    </p>
  );
}
