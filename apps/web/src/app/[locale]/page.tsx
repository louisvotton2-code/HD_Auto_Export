import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { localizedAlternates } from '@/shared/config/site';
import { HomePage } from '@/modules/home';
import { getVehicles, getPopularModels } from '@/modules/vehicles';

const metadataByLocale = {
  zh: {
    title: '汽车出口与精选车源',
    description: '探索汽车出口服务、示例车源、购车流程和进口费用参考。',
  },
  en: {
    title: 'Cars from China',
    description:
      'Explore vehicle export services, sample cars, the buying process and import cost estimates.',
  },
  ru: {
    title: 'Автомобили из Китая',
    description:
      'Экспорт автомобилей, демонстрационный каталог, процесс покупки и предварительный расчёт ввоза.',
  },
} satisfies Record<Locale, { title: string; description: string }>;

type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return {
    ...metadataByLocale[locale],
    alternates: { canonical: `/${locale}/`, languages: localizedAlternates('/') },
  };
}

export default async function Home({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <HomePage
      locale={locale}
      vehicles={getVehicles()}
      models={getPopularModels().map((model) => ({
        name: model.model,
        brand: model.make,
        image: model.image,
        href: `/${locale}/cars/`,
        priceUsd: model.startingPriceUsd,
      }))}
    />
  );
}
