import { PublicVehicleFiltersSchema, type PublicVehicleFilters } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicQueryString, publicUsdFilterQuery, type UsdFilterScope } from './public-query';

export function catalogFacetUrl(
  locale: Locale,
  scope: UsdFilterScope,
  parents: { make?: string; model?: string; selectedModel?: string } = {},
) {
  return `/catalog-facets.json?${publicQueryString({ ...publicUsdFilterQuery(locale, scope), ...parents })}`;
}

/** The website's overview keeps the filter controls visible without sending every option. */
export function projectCatalogFacetOverview(filters: PublicVehicleFilters, selectedModel?: string) {
  const { catalog, total, makes, models, powertrains, drivetrains, modelYears, trims, generations } =
    filters.data;
  return {
    data: {
      catalog, total, makes,
      // Existing model-only bookmarks permit switching models without picking a brand first.
      models: selectedModel ? models : [],
      powertrains, drivetrains, modelYears,
    },
    meta: filters.meta,
    hasTrims: Boolean(trims?.length),
    hasGenerations: Boolean(generations?.length),
  };
}

export type CatalogFacetOverview = ReturnType<typeof projectCatalogFacetOverview>;

const overviewResponse = PublicVehicleFiltersSchema.extend({
  data: PublicVehicleFiltersSchema.shape.data.omit({
    trims: true, generations: true, priceCurrencies: true,
  }),
});

export const catalogFacetOverviewSchema = {
  parse(value: unknown): CatalogFacetOverview {
    if (value === null || typeof value !== 'object' ||
      !('hasTrims' in value) || typeof value.hasTrims !== 'boolean' ||
      !('hasGenerations' in value) || typeof value.hasGenerations !== 'boolean') {
      throw new Error('Invalid catalog filter overview');
    }
    const { hasTrims, hasGenerations, ...response } = value;
    const { data, meta } = overviewResponse.parse(response);
    const { catalog, total, makes, models, powertrains, drivetrains, modelYears } = data;
    return { data: { catalog, total, makes, models, powertrains, drivetrains, modelYears },
      meta, hasTrims, hasGenerations };
  },
};

export function projectCatalogFacetScope(
  filters: PublicVehicleFilters,
  make: string,
  model?: string,
): PublicVehicleFilters {
  const { catalog, models, trims, generations } = filters.data;
  return {
    data: {
      catalog,
      makes: [],
      powertrains: [],
      models: model ? [] : models.filter((item) => item.makeId === make),
      ...(model ? {
        trims: trims?.filter((item) => item.makeId === make && item.modelId === model),
        generations: generations?.filter((item) => item.makeId === make && item.modelId === model),
      } : {}),
    },
    meta: filters.meta,
  };
}
