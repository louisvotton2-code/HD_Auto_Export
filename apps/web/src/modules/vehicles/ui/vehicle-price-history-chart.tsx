import type { PublicVehiclePriceHistoryResponse } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { formatTruncatedDisplayAmount } from '@/shared/lib/display-amount';
import { publicVehicleRecordsCopy } from '../public-vehicle-records-copy';
import styles from './public-vehicle-records.module.css';

type PriceHistoryItem = PublicVehiclePriceHistoryResponse['data']['items'][number];
type Quote = { time: number; amount: string; cents: bigint };

function chartData(items: readonly PriceHistoryItem[]) {
  const byTime = new Map<number, Quote>();
  let currency: PriceHistoryItem['money']['currency'] | undefined;
  let kind: PriceHistoryItem['kind'] | undefined;

  for (const item of items) {
    if (!item.at) continue;
    const time = Date.parse(item.at);
    const [whole, fraction = ''] = item.money.amount.split('.');
    const cents = BigInt(whole + fraction.padEnd(2, '0'));
    if (!Number.isFinite(time) || cents <= 0n) continue;
    if (item.kind === 'unknown' || (kind && item.kind !== kind) || (currency && item.money.currency !== currency)) return null;
    currency = item.money.currency;
    kind = item.kind;
    const previous = byTime.get(time);
    if (previous && previous.cents !== cents) return null;
    byTime.set(time, { time, amount: item.money.amount, cents });
  }

  const quotes = [...byTime.values()].sort((left, right) => left.time - right.time);
  return quotes.length > 1 && currency ? { quotes, currency } : null;
}

// The existing table stays the textual equivalent and preserves all rows, including undated quotes.
export function VehiclePriceHistoryChart({ items, locale }: { items: readonly PriceHistoryItem[]; locale: Locale }) {
  const chart = chartData(items);
  if (!chart) return null;
  const { quotes, currency } = chart;
  const first = quotes[0]!;
  const last = quotes[quotes.length - 1]!;
  const timespan = last.time - first.time;
  let low = first;
  let high = first;
  for (const quote of quotes) {
    if (quote.cents < low.cents) low = quote;
    if (quote.cents > high.cents) high = quote;
  }
  const priceSpan = Number(high.cents - low.cents);
  const points = quotes.map(quote => ({
    ...quote,
    x: 12 + (quote.time - first.time) / timespan * 616,
    y: priceSpan === 0 ? 70 : 126 - Number(quote.cents - low.cents) / priceSpan * 112,
  }));
  const plottedFirst = points[0]!;
  const path = [`M${plottedFirst.x},${plottedFirst.y}`, ...points.slice(1).map(point => `L${point.x},${point.y}`)].join(' ');
  const axis = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', dateStyle: 'medium', timeStyle: timespan < 86_400_000 ? 'medium' : undefined,
  });
  const tooltip = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' });

  return <figure className={styles.chart} data-testid="vehicle-price-history-chart">
    <figcaption className={styles.chartCaption}>
      <span>{publicVehicleRecordsCopy[locale].priceTrend}</span>
      <bdi>{currency}</bdi>
    </figcaption>
    <div className={styles.chartAxes} aria-hidden="true">
      <div className={styles.chartAmounts}>
        <span>{formatTruncatedDisplayAmount(high.amount, locale)}</span>
        {priceSpan > 0 && <span>{formatTruncatedDisplayAmount(low.amount, locale)}</span>}
      </div>
      <svg className={styles.chartPlot} viewBox="0 0 640 140" preserveAspectRatio="none" focusable="false">
        <path className={styles.chartGuide} d="M12,14H628 M12,70H628 M12,126H628" />
        <path className={styles.chartLine} d={path} />
        {points.map(point => <circle key={point.time} className={styles.chartPoint} cx={point.x} cy={point.y} r={5}>
          <title>{tooltip.format(point.time)} · {formatTruncatedDisplayAmount(point.amount, locale)} {currency}</title>
        </circle>)}
      </svg>
      <div className={styles.chartDates}><span>{axis.format(first.time)}</span><span>{axis.format(last.time)}</span></div>
    </div>
    <p className={styles.chartNote}>{publicVehicleRecordsCopy[locale].priceTrendNote}</p>
  </figure>;
}
