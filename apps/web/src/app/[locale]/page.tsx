import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { routing, type Locale } from '@/i18n/routing';
import { localizedAlternates } from '@/shared/config/site';
import { PublicHome } from '@/modules/home';
import { getPublicCatalog, getPublicHome, getPublicFilters, publicRetryAfter } from '@/modules/vehicles/server';

const metadataByLocale = {
  zh: {
    title: '汽车出口与精选车源',
    description: '探索汽车出口服务、精选车源、购车流程和进口费用参考。',
  },
  en: {
    title: 'Cars from China',
    description:
      'Explore vehicle export services, selected cars, the buying process and import cost estimates.',
  },
  ru: {
    title: 'Автомобили из Китая',
    description:
      'Экспорт автомобилей, каталог автомобилей, процесс покупки и предварительный расчёт ввоза.',
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
  await connection();
  const [home, filters] = await Promise.allSettled([
    getPublicHome(locale),
    getPublicFilters(locale, {}, { projection: 'overview-models' }),
  ]);
  const facets = filters.status === 'fulfilled' ? filters.value.data : null;
  const initialRetryAfter = publicRetryAfter(home, filters);
  let catalogTotal = facets?.total;
  // Staff-only API responses omit the facet total. Read exact list metadata only then.
  if (facets && catalogTotal === undefined && initialRetryAfter === 0) {
    const catalog = await getPublicCatalog({ catalog: 'curated', locale, page: 1, pageSize: 1 }).catch(() => null);
    if (catalog?.meta.totalKind === 'exact') catalogTotal = catalog.meta.total ?? undefined;
  }
  return (
    <PublicHome
      key={locale}
      locale={locale}
      home={home.status === 'fulfilled' ? home.value : null}
      filters={facets ? {
        catalog: facets.catalog,
        total: catalogTotal,
        makes: facets.makes,
        models: facets.models,
        powertrains: facets.powertrains,
      } : null}
      initialRetryAfter={initialRetryAfter}
    />
  );
}
