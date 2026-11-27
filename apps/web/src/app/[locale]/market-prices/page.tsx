import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { routing, type Locale } from '@/i18n/routing';
import { MarketPricesFrame, MarketPricesScreen } from '@/modules/market-prices';
import { pageMetadata, publicPageSchema } from '@/shared/lib/page-seo';
import { JsonLd } from '@/shared/ui/json-ld';

const path = '/market-prices/';
const copy = {
  zh: {
    title: '中国二手车行情查询 | HD Auto Export',
    description: '按品牌和车型查询二手车挂牌行情，可按年款、款型、里程和动力筛选，查看样本量、中位价及价格范围。',
    loading: '正在加载查询条件…',
  },
  en: {
    title: 'Used Car Market Prices in China | HD Auto Export',
    description: 'Compare used-car asking prices by make and model. Filter by model year, trim, mileage or powertrain and see sample size, median price and price range.',
    loading: 'Loading search filters…',
  },
  ru: {
    title: 'Цены на авто с пробегом в Китае | HD Auto Export',
    description: 'Сравните цены предложений на авто с пробегом по марке, модели, году выпуска, комплектации, пробегу и типу двигателя. Посмотрите размер выборки, медиану и диапазон цен.',
    loading: 'Загружаем фильтры…',
  },
} satisfies Record<Locale, { title: string; description: string; loading: string }>;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const { title, description } = copy[locale];
  return pageMetadata({ locale, path, title, description });
}

export default async function MarketPricesPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { title, description, loading } = copy[locale];
  return (
    <>
      <JsonLd data={publicPageSchema(locale, path, title, 'WebApplication', description)} />
      <MarketPricesFrame locale={locale}>
        <Suspense fallback={<p role="status">{loading}</p>}>
          <MarketPricesScreen locale={locale} />
        </Suspense>
      </MarketPricesFrame>
    </>
  );
}
