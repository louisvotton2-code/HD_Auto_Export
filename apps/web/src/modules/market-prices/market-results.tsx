'use client';

import { useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { formatDisplayAmount } from '@/shared/lib/display-amount';
import { publicMediaUrl } from '@/shared/lib/public-media';
import { isPublicVehicleDetailPath } from '@/shared/lib/public-vehicle-detail-path';
import { Icon } from '@/shared/ui/icon';
import styles from './market-results.module.css';

export type MarketMoney = { usd: string | null; cny: string | null };

export type MarketExtreme = {
  href: string;
  title: string;
  trim: string | null;
  modelYear: number | null;
  mileageKm: number | null;
  image: { url: string; alt: string } | null;
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
    interval: '中间 50% 的价格区间（P25–P75）',
    vehicles: '价格两端的样本车辆', lowVehicle: '最低价车源', highVehicle: '最高价车源',
    soleVehicle: '样本车辆', equalVehicle: '最低价和最高价样本',
    trim: '款型', mileage: '里程', kilometres: '公里',
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
    interval: 'Middle 50% price range (P25–P75)',
    vehicles: 'Vehicles at the price limits', lowVehicle: 'Lowest-priced vehicle', highVehicle: 'Highest-priced vehicle',
    soleVehicle: 'Sample vehicle', equalVehicle: 'Vehicle at both price limits',
    trim: 'Trim', mileage: 'Mileage', kilometres: 'km',
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
    interval: 'Диапазон средних 50% цен (P25–P75)',
    vehicles: 'Автомобили с крайними ценами', lowVehicle: 'Автомобиль с минимальной ценой', highVehicle: 'Автомобиль с максимальной ценой',
    soleVehicle: 'Автомобиль в выборке', equalVehicle: 'Автомобиль с общей минимальной и максимальной ценой',
    trim: 'Комплектация', mileage: 'Пробег', kilometres: 'км',
  },
} as const;

function makeMoneyFormat(locale: Locale, currency: 'USD' | 'CNY') {
  return (amount: string | null | undefined) => amount == null ? null : `${formatDisplayAmount(amount, locale)} ${currency}`;
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

function ExtremePhoto({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.photo}>
      <Icon name="car" size={30} />
      {src && !failed && <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    </span>
  );
}

function ExtremeCard({ locale, vehicle, label, showPrice }: { locale: Locale; vehicle: MarketExtreme; label: string; showPrice: boolean }) {
  const t = copy[locale];
  const imageUrl = vehicle.image?.url;
  // Only use same-origin public images supplied by the site; placeholders cover other cases.
  const src = imageUrl && /^\/(?!\/)[^\\\s]+$/.test(imageUrl) ? publicMediaUrl(imageUrl) : null;
  const alt = vehicle.image?.alt === vehicle.title ? '' : vehicle.image?.alt ?? '';
  const children = (
    <>
      <ExtremePhoto key={src} src={src} alt={alt} />
      <span className={styles.cardContent}>
        <span className={styles.cardLabel}>{label}</span>
        <span className={styles.cardTitle}>{vehicle.title}</span>
        {(vehicle.modelYear !== null || vehicle.trim || vehicle.mileageKm !== null) && <span className={styles.cardFacts}>
          {vehicle.modelYear !== null && <span><span className="sr-only">{t.year} </span>{vehicle.modelYear}</span>}
          {vehicle.trim && <span><span className="sr-only">{t.trim} </span>{vehicle.trim}</span>}
          {vehicle.mileageKm !== null && <span><span className="sr-only">{t.mileage} </span>
            {new Intl.NumberFormat(locale).format(vehicle.mileageKm)} {t.kilometres}
          </span>}
        </span>}
        {showPrice && <MarketPrice value={vehicle.price} locale={locale} />}
      </span>
    </>
  );

  return isPublicVehicleDetailPath(vehicle.href) ? (
    <a className={styles.card} href={vehicle.href}>
      {children}
      <Icon className={styles.cardArrow} name="diagonal" size={18} />
    </a>
  ) : <div className={styles.card}>{children}</div>;
}

export function MarketResults({ locale, result, filters }: { locale: Locale; result: MarketResultView; filters: string[] }) {
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

  return (
    <section className={styles.results} aria-labelledby="market-result-title" data-testid="market-results" data-sample-state={state}>
      <div className={styles.header}>
        <h2 id="market-result-title">{t.heading}</h2>
        <dl className={styles.metadata}>
          <div><dt className="sr-only">{t.sampleCount}</dt><dd>{t.sampleLabel(new Intl.NumberFormat(locale).format(sampleCount))}</dd></div>
          {formattedTime && <div><dt>{t.calculatedAt}</dt><dd><time dateTime={calculatedAt}>{formattedTime} (UTC+8)</time></dd></div>}
        </dl>
      </div>
      <ul className={styles.criteria} aria-label={t.filters} data-testid="market-submitted-filters">
        {filters.map((label, index) => <li key={index}>{label}</li>)}
      </ul>
      {sampleCount > 0 && <div className={styles.prices}>
        <dl className={styles.median}>
          <dt>{t.median}</dt><dd><MarketPrice value={median} locale={locale} /></dd>
        </dl>
        {sampleCount > 1 && <dl className={styles.comparison}>
          <div><dt>{t.mean}</dt><dd><MarketPrice value={mean} locale={locale} /></dd></div>
          <div><dt>{t.minimum}</dt><dd><MarketPrice value={minimum} locale={locale} /></dd></div>
          <div><dt>{t.maximum}</dt><dd><MarketPrice value={maximum} locale={locale} /></dd></div>
        </dl>}
      </div>}
      {sampleCount > 0 && median?.usd === null && median.cny !== null && <p className={styles.currencyNotice}>{t.cnyOnly}</p>}
      {state !== 'standard' && <p className={styles.note}><Icon name="info" size={19} />{t[state]}</p>}
      {(usdRange || cnyRange) && <dl className={styles.interval} data-testid="market-percentile-range">
        <div><dt>{t.interval}</dt><dd><Price usd={usdRange} cny={cnyRange} /></dd></div>
      </dl>}
      {sampleCount > 0 && (lowVehicle || highVehicle) && <div className={styles.examples}>
        <h3>{sampleCount === 1 ? t.soleVehicle : t.vehicles}</h3>
        <div className={styles.cards}>
          {lowVehicle && <ExtremeCard locale={locale} vehicle={lowVehicle} showPrice={sampleCount > 1}
            label={sampleCount === 1 ? t.soleVehicle : sharedVehicle ? t.equalVehicle : t.lowVehicle} />}
          {highVehicle && !sharedVehicle && (sampleCount > 1 || !lowVehicle) && <ExtremeCard locale={locale} vehicle={highVehicle} showPrice={sampleCount > 1}
            label={sampleCount === 1 ? t.soleVehicle : t.highVehicle} />}
        </div>
      </div>}
    </section>
  );
}
