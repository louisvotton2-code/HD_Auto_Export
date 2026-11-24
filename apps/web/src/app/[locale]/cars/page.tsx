import type { Metadata } from 'next';
import { cache } from 'react';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { CatalogOffsetLimitNotice, parseCatalogPageRequest, PublicVehicleList, publicVehicleMessages } from '@/modules/vehicles';
import {
  catalogFacetProjection,
  catalogFacetOverviewScope,
  createCatalogVersionScope,
  getPublicCatalog,
  getPublicFilters,
  projectCatalogFacetOverview,
  projectCatalogFacetScope,
  publicRetryAfter,
} from '@/modules/vehicles/server';
import { siteConfig } from '@/shared/config/site';
import { pageMetadata, publicPageSchema } from '@/shared/lib/page-seo';
import { JsonLd } from '@/shared/ui/json-ld';
import { isPublicBrowseRender, markPublicHtmlRenderComplete, publicHtmlRenderTicketHeader } from '@/shared/lib/public-html-render-proof';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const catalogRender = cache(async () => {
  // Same-origin navigation fetches can load facets after the cards.
  const incoming = await headers();
  const deferFilters = incoming.get('sec-fetch-dest') === 'empty' &&
    incoming.get('sec-fetch-site') === 'same-origin' && incoming.get('accept') === '*/*';
  return { deferFilters, versions: deferFilters ? undefined : createCatalogVersionScope(), ticket: incoming.get(publicHtmlRenderTicketHeader) };
});

const readBaseCatalog = cache(async (locale: Locale) => {
  const request = parseCatalogPageRequest({}, locale);
  if (!request || request.kind !== 'query') notFound();
  const { versions } = await catalogRender();
  return getPublicCatalog(request.query, versions?.catalog);
});

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = publicVehicleMessages(locale);
  const base = Object.keys(await searchParams).length === 0;
  const data = siteConfig.indexable && base ? await readBaseCatalog(locale).catch(() => null) : null;
  return pageMetadata({
    locale, path: '/cars/', title: t.title, description: t.intro,
    eligible: base && (!siteConfig.indexable || Boolean(data?.data.items.some((item) => item.source.kind !== 'demo'))),
  });
}
export default async function CarsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const search = await searchParams;
  const base = Object.keys(search).length === 0;
  const request = parseCatalogPageRequest(search, locale);
  if (!request) notFound();
  if (request.kind === 'offset_limit') return <CatalogOffsetLimitNotice locale={locale} query={request.query} />;
  const { query } = request;
  if (request.kind === 'short_query') return <PublicVehicleList
    key={locale} locale={locale} query={query} result={null} filters={null}
    initialBrandFilters={null} initialModelFilters={null}
  />;
  const { make, model } = query;
  const { deferFilters, versions, ticket } = await catalogRender();
  const [result, filters, brandFilters, modelFilters] = await Promise.allSettled([
    base ? readBaseCatalog(locale) : getPublicCatalog(query, versions?.catalog),
    deferFilters ? null : getPublicFilters(locale, catalogFacetOverviewScope(query), catalogFacetProjection({ selectedModel: make ? undefined : model }), versions?.filters),
    !deferFilters && make ? getPublicFilters(locale, query, catalogFacetProjection({ make }), versions?.filters) : null,
    !deferFilters && make && model ? getPublicFilters(locale, query, catalogFacetProjection({ make, model }), versions?.filters) : null,
  ]);
  const t = publicVehicleMessages(locale);
  if (isPublicBrowseRender(ticket) && !deferFilters && result.status === 'fulfilled' &&
      filters.status === 'fulfilled' && filters.value &&
      (!make || brandFilters.status === 'fulfilled' && brandFilters.value) &&
      (!make || !model || modelFilters.status === 'fulfilled' && modelFilters.value)) markPublicHtmlRenderComplete(ticket);
  return <>
    {base && result.status === 'fulfilled' && result.value.data.items.some((item) => item.source.kind !== 'demo') &&
      <JsonLd data={publicPageSchema(locale, '/cars/', t.title, 'CollectionPage', t.intro)} />}
    <PublicVehicleList
      key={locale}
      locale={locale}
      query={query}
      result={result.status === 'fulfilled' ? result.value : null}
      filters={filters.status === 'fulfilled' && filters.value ? projectCatalogFacetOverview(filters.value) : null}
      initialBrandFilters={brandFilters.status === 'fulfilled' && brandFilters.value && make
        ? projectCatalogFacetScope(brandFilters.value, make)
        : null}
      initialModelFilters={modelFilters.status === 'fulfilled' && modelFilters.value && make && model
        ? projectCatalogFacetScope(modelFilters.value, make, model)
        : null}
      error={result.status === 'rejected'}
      initialRetryAfter={publicRetryAfter(result, filters, brandFilters, modelFilters)}
      deferFilters={deferFilters}
    />
  </>;
}
