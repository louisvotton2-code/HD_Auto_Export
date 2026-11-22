import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { routing, type Locale } from '@/i18n/routing';
import { pageMetadata, publicPageSchema } from '@/shared/lib/page-seo';
import { JsonLd } from '@/shared/ui/json-ld';
import { InterFontFaces, interFontUrls } from '@/shared/ui/inter-fonts';
import { markPublicHtmlRenderComplete, publicHtmlRenderTicketHeader } from '@/shared/lib/public-html-render-proof';
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
  return pageMetadata({ locale, path: '/', ...metadataByLocale[locale],
    image: { src: '/media/home/dawn-convoy-1056.webp' } });
}

export default async function Home({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const [home, overview, models] = await Promise.allSettled([
    getPublicHome(locale),
    getPublicFilters(locale, {}, { projection: 'overview' }),
    getPublicFilters(locale, {}, { projection: 'home-models' }),
  ]);
  const facets = overview.status === 'fulfilled' ? overview.value.data : null;
  let initialRetryAfter = publicRetryAfter(home, overview, models);
  let catalogTotal = facets?.total ?? null;
  // The headline can still use exact list metadata if the overview fails.
  if (catalogTotal === null && initialRetryAfter === 0) {
    const [catalog] = await Promise.allSettled([
      getPublicCatalog({ catalog: 'curated', locale, page: 1, pageSize: 1 }),
    ]);
    if (catalog.status === 'fulfilled' && catalog.value.meta.totalKind === 'exact') {
      catalogTotal = catalog.value.meta.total ?? null;
    }
    initialRetryAfter = publicRetryAfter(catalog);
  }
  if (home.status === 'fulfilled' && models.status === 'fulfilled' && facets?.total !== undefined) {
    markPublicHtmlRenderComplete((await headers()).get(publicHtmlRenderTicketHeader));
  }
  const { title, description } = metadataByLocale[locale];
  return <>
    <link rel="preload" as="font" href={interFontUrls.latin} type="font/woff2" crossOrigin="anonymous" />
    {locale === 'ru' && <link rel="preload" as="font" href={interFontUrls.cyrillic} type="font/woff2" crossOrigin="anonymous" />}
    <InterFontFaces home />
    <JsonLd data={publicPageSchema(locale, '/', title, 'WebSite', description)} />
    <PublicHome
      key={locale}
      locale={locale}
      home={home.status === 'fulfilled' ? {data:home.value.data,meta:{requestId:'server-rendered'}} : null}
      filters={facets ? {
        catalog: facets.catalog,
        total: facets.total,
        makes: facets.makes,
        models: [],
        powertrains: [],
      } : null}
      modelFilters={models.status === 'fulfilled' ? models.value.data : null}
      catalogTotal={catalogTotal}
      initialRetryAfter={initialRetryAfter}
    />
  </>;
}
