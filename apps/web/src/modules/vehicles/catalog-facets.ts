import { publicCatalogSearchIssue, PublicVehicleFiltersSchema, type PublicVehicleFilters, type PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicQueryString, publicUsdFilterQuery, type UsdFilterScope } from './public-query';

type FacetSelection = { make?: string; model?: string; selectedModel?: string };

/** The overview supplies brand choices across the catalog. Scoped lists and model options keep the keyword. */
export function catalogFacetOverviewScope(query: PublicVehicleQuery): UsdFilterScope {
  const { locale, q } = query;
  return publicCatalogSearchIssue({ locale, q }) ? { ...query, q: undefined } : query;
}

export function catalogFacetUrl(
  locale: Locale,
  scope: UsdFilterScope,
  parents: FacetSelection = {},
) {
  return `/catalog-facets.json?${publicQueryString({ ...publicUsdFilterQuery(locale, scope), ...parents })}`;
}

export function catalogFacetProjection({ make, model, selectedModel }: FacetSelection) {
  if (make) return { projection: model ? 'variants' as const : 'models' as const, make, model };
  // Model-only bookmarks still need the model picker when no brand is selected.
  return { projection: selectedModel ? 'overview-models' as const : 'overview' as const };
}

/** Keep the browser's existing overview envelope. */
export function projectCatalogFacetOverview(filters: PublicVehicleFilters) {
  const {
    catalog, total, makes, models, powertrains, drivetrains, modelYears,
    hasTrims = false, hasGenerations = false,
  } = filters.data;
  return {
    data: { catalog, total, makes, models, powertrains, drivetrains, modelYears },
    meta: filters.meta,
    hasTrims,
    hasGenerations,
  };
}

export type CatalogFacetOverview = ReturnType<typeof projectCatalogFacetOverview>;

const overviewResponse = PublicVehicleFiltersSchema.extend({
  data: PublicVehicleFiltersSchema.shape.data.omit({
    trims: true, generations: true, priceCurrencies: true, hasTrims: true, hasGenerations: true,
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
