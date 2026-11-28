'use client';

import type { Locale } from '@/i18n/routing';
import type { PublicMedia } from '@hd/contracts/public';
import type { ReactNode } from 'react';
import { formatTruncatedDisplayAmount } from '@/shared/lib/display-amount';
import { Icon } from '@/shared/ui/icon';
import { MarketExtremeCard } from './market-extreme-card';
import styles from './market-results.module.css';

export type MarketMoney = { usd: string | null; cny: string | null };

export type MarketExtreme = {
  id: string;
  href: string;
  title: string;
  trim: string | null;
  modelYear: number | null;
  mileageKm: number | null;
  image: PublicMedia | null;
  price: MarketMoney;
};

export type MarketResultView = {
  sampleCount: number;
  median: MarketMoney | null;
  mean: MarketMoney | null;
  minimum: MarketMoney | null;
  maximum: MarketMoney | null;
  p25: MarketMoney | null;
  p75: MarketMoney | null;
  calculatedAt: string;
  vehicleNames?: { make: string | null; model: string | null; trim: string | null };
  extremes?: { minimum?: MarketExtreme; maximum?: MarketExtreme };
};

const copy = {
  zh: {
    heading: '行情结果', sampleCount: '在售车源', calculatedAt: '统计时间',
    sampleLabel: (count: string) => `共 ${count} 辆在售车源`, filters: '查询条件', year: '年款',
    median: '中位价', mean: '平均价', minimum: '最低价', maximum: '最高价',
    empty: '没有符合条件的价格样本。试试放宽筛选条件。',
    single: '仅有 1 条样本，价格仅供参考。',
    limited: '样本较少，价格仅供参考。',
    insufficientForRange: '样本不足 10 条，暂不展示中间 50% 的价格区间。',
    cnyOnly: '美元价格暂不可用，当前以人民币显示。',
    listingRange: '当前挂牌价分布', interval: '中间 50% 的价格区间（P25–P75）',
    vehicles: '实车价格对比', lowVehicle: '最低价车源', highVehicle: '最高价车源',
    soleVehicle: '样本车辆', equalVehicle: '最低价和最高价样本',
    trim: '款型', mileage: '里程', kilometres: '公里', history: '单车调价记录',
  },
  en: {
    heading: 'Price summary', sampleCount: 'Listing count', calculatedAt: 'Calculated at',
    sampleLabel: (count: string) => `Listings for sale: ${count}`, filters: 'Search filters', year: 'Model year',
    median: 'Median price', mean: 'Average price', minimum: 'Lowest price', maximum: 'Highest price',
    empty: 'No price samples match these filters. Try broadening your search.',
    single: 'Only one sample is available. Use its price as a reference.',
    limited: 'The sample is small. Use these prices as a reference.',
    insufficientForRange: 'At least 10 samples are needed to show the middle 50% price range.',
    cnyOnly: 'USD prices are unavailable. Prices are shown in CNY.',
    listingRange: 'Current listing price distribution', interval: 'Middle 50% price range (P25–P75)',
    vehicles: 'Compare listings', lowVehicle: 'Lowest-priced vehicle', highVehicle: 'Highest-priced vehicle',
    soleVehicle: 'Sample vehicle', equalVehicle: 'Vehicle at both price limits',
    trim: 'Trim', mileage: 'Mileage', kilometres: 'km', history: 'Vehicle price history',
  },
  ru: {
    heading: 'Сводка цен', sampleCount: 'Размер выборки', calculatedAt: 'Время расчёта',
    sampleLabel: (count: string) => `Авто в продаже: ${count}`, filters: 'Параметры поиска', year: 'Модельный год',
    median: 'Медианная цена', mean: 'Средняя цена', minimum: 'Минимальная цена', maximum: 'Максимальная цена',
    empty: 'По этим параметрам цены не найдены. Попробуйте расширить поиск.',
    single: 'Найдена только одна цена. Используйте её как ориентир.',
    limited: 'Выборка мала. Используйте цены как ориентир.',
    insufficientForRange: 'Диапазон средних 50% цен доступен при наличии не менее 10 цен.',
    cnyOnly: 'Цены в долларах недоступны. Цены показаны в юанях.',
    listingRange: 'Распределение цен в объявлениях', interval: 'Диапазон средних 50% цен (P25–P75)',
    vehicles: 'Сравнение объявлений', lowVehicle: 'Автомобиль с минимальной ценой', highVehicle: 'Автомобиль с максимальной ценой',
    soleVehicle: 'Автомобиль в выборке', equalVehicle: 'Автомобиль с общей минимальной и максимальной ценой',
    trim: 'Комплектация', mileage: 'Пробег', kilometres: 'км', history: 'История цены автомобиля',
  },
} as const;

function makeMoneyFormat(locale: Locale, currency: 'USD' | 'CNY') {
  return (amount: string | null | undefined) => amount == null ? null : `${formatTruncatedDisplayAmount(amount, locale)} ${currency}`;
}

function rangeText(format: ReturnType<typeof makeMoneyFormat>, lower?: string | null, upper?: string | null) {
  const start = format(lower);
  const end = format(upper);
  return start && end ? `${start} – ${end}` : null;
}

function Price({ usd, cny }: { usd: string | null; cny: string | null }) {
  return (
    <span className={styles.price}>
      <span className={styles.primaryPrice}>{usd ?? cny ?? '—'}</span>
      {usd && cny && <span className={styles.cny}>≈ {cny}</span>}
    </span>
  );
}

function MarketPrice({ value, locale }: { value: MarketMoney | null; locale: Locale }) {
  return <Price usd={makeMoneyFormat(locale, 'USD')(value?.usd)} cny={makeMoneyFormat(locale, 'CNY')(value?.cny)} />;
}

function listingScale({ sampleCount, minimum, maximum, median, p25, p75 }: MarketResultView) {
  // One currency per scale. Numeric conversion is only used for drawing positions.
  const currency = minimum?.usd != null && maximum?.usd != null && median?.usd != null ? 'usd' : 'cny';
  const amount = (price: MarketMoney | null) => Number(price?.[currency] ?? NaN);
  const low = amount(minimum);
  const high = amount(maximum);
  const middle = amount(median);
  if (!Number.isFinite(high - low) || high <= low || !(low <= middle && middle <= high)) return null;
  const position = (value: number) => (value - low) / (high - low) * 100;
  const lowerQuartile = amount(p25);
  const upperQuartile = amount(p75);
  const hasBand = sampleCount >= 10 && low <= lowerQuartile && lowerQuartile <= middle
    && middle <= upperQuartile && upperQuartile <= high;
  return { center: position(middle), band: hasBand ? [position(lowerQuartile), position(upperQuartile)] as const : null };
}

export function MarketResults({ locale, result, filters, share }: {
  locale: Locale; result: MarketResultView; filters: string[]; share: ReactNode;
}) {
  const t = copy[locale];
  const { sampleCount, median, mean, minimum, maximum, p25, p75, calculatedAt, extremes } = result;
  const timestamp = Date.parse(calculatedAt);
  const formattedTime = Number.isFinite(timestamp) ? new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
  }).format(timestamp) : null;
  const usdRange = sampleCount >= 10 ? rangeText(makeMoneyFormat(locale, 'USD'), p25?.usd, p75?.usd) : null;
  const cnyRange = sampleCount >= 10 ? rangeText(makeMoneyFormat(locale, 'CNY'), p25?.cny, p75?.cny) : null;
  const state = sampleCount === 0 ? 'empty' : sampleCount === 1 ? 'single' : sampleCount < 5 ? 'limited' : sampleCount < 10 ? 'insufficientForRange' : 'standard';
  const lowVehicle = extremes?.minimum;
  const highVehicle = extremes?.maximum;
  const sharedVehicle = lowVehicle && highVehicle?.href === lowVehicle.href;
  const scale = sampleCount > 1 ? listingScale(result) : null;

  return (
    <section className={styles.results} aria-labelledby="market-result-title" data-testid="market-results" data-sample-state={state}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id="market-result-title">{t.heading}</h2>
          <dl className={styles.metadata}>
            <div className={styles.sample}><dt className="sr-only">{t.sampleCount}</dt><dd>{t.sampleLabel(new Intl.NumberFormat(locale).format(sampleCount))}</dd></div>
            {formattedTime && <div><dt>{t.calculatedAt}</dt><dd><time dateTime={calculatedAt}>{formattedTime} (UTC+8)</time></dd></div>}
          </dl>
        </div>
        {share}
      </div>
      <ul className={styles.criteria} aria-label={t.filters} data-testid="market-submitted-filters">
        {filters.map((label, index) => <li key={index}>{label}</li>)}
      </ul>
      {sampleCount > 0 && <div className={styles.overview}>
        <dl className={styles.prices}>
          <div className={styles.median}>
            <dt>{scale && <span className={styles.medianKey} aria-hidden="true" />}{t.median}</dt>
            <dd><MarketPrice value={median} locale={locale} /></dd>
          </div>
          {sampleCount > 1 && <div className={styles.mean}><dt>{t.mean}</dt><dd><MarketPrice value={mean} locale={locale} /></dd></div>}
        </dl>
        {sampleCount > 1 && <div className={styles.distribution}>
          <h3>{t.listingRange}</h3>
          {scale && <div className={styles.track} aria-hidden="true" data-testid="market-listing-range">
            {scale.band && <span className={styles.band} style={{ insetInlineStart: `${scale.band[0]}%`, inlineSize: `${scale.band[1] - scale.band[0]}%` }} />}
            <span className={styles.marker} style={{ insetInlineStart: `${scale.center}%` }} />
          </div>}
          <dl className={styles.endpoints}>
            <div><dt>{t.minimum}</dt><dd><MarketPrice value={minimum} locale={locale} /></dd></div>
            <div><dt>{t.maximum}</dt><dd><MarketPrice value={maximum} locale={locale} /></dd></div>
          </dl>
          {(usdRange || cnyRange) && <dl className={styles.interval} data-testid="market-percentile-range">
            <dt>{scale?.band && <span className={styles.bandKey} aria-hidden="true" />}{t.interval}</dt>
            <dd><Price usd={usdRange} cny={cnyRange} /></dd>
          </dl>}
        </div>}
      </div>}
      {sampleCount > 0 && median?.usd === null && median.cny !== null && <p className={styles.currencyNotice}>{t.cnyOnly}</p>}
      {state !== 'standard' && <p className={styles.note}><Icon name="info" size={19} />{t[state]}</p>}
      {sampleCount > 0 && (lowVehicle || highVehicle) && <div className={styles.examples}>
        <h3>{sampleCount === 1 ? t.soleVehicle : t.vehicles}</h3>
        <div className={styles.cards}>
          {lowVehicle && <MarketExtremeCard locale={locale} vehicle={lowVehicle} facts={t}
            label={sampleCount === 1 ? t.soleVehicle : sharedVehicle ? t.equalVehicle : t.lowVehicle}
            price={sampleCount > 1 ? <MarketPrice value={lowVehicle.price} locale={locale} /> : undefined} />}
          {highVehicle && !sharedVehicle && (sampleCount > 1 || !lowVehicle) && <MarketExtremeCard locale={locale} vehicle={highVehicle} facts={t}
            label={sampleCount === 1 ? t.soleVehicle : t.highVehicle}
            price={sampleCount > 1 ? <MarketPrice value={highVehicle.price} locale={locale} /> : undefined} />}
        </div>
      </div>}
    </section>
  );
}
