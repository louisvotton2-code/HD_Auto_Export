import {
  PublicFilterQuerySchema,
  PublicVehicleQuerySchema,
  isPublicCatalogOffsetAllowed,
  type PublicVehicleQuery,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { moneyCents } from '@/shared/lib/public-vehicle-price';

export const publicUsdView = { view: 'localized', priceView: 'usd' } as const;

export type UsdFilterScope = Pick<PublicVehicleQuery, 'q' | 'priceMin' | 'priceMax' | 'priceCurrency' | 'exportStatus'>;

/** Website whole-dollar limits match the rounded displayed value. Precise API limits stay exact. */
function wholeDollarBound(amount: string | undefined, edge: 'min' | 'max') {
  if (amount === undefined) return undefined;
  const cents = moneyCents(amount);
  if (cents % 100n !== 0n) return amount;
  if (edge === 'min' && cents === 0n) return '0';
  const bound = edge === 'min' ? cents - 50n : cents + 49n;
  return `${bound / 100n}.${String(bound % 100n).padStart(2, '0')}`;
}

function websitePriceBounds(scope: UsdFilterScope) {
  const { priceMin, priceMax, priceCurrency } = scope;
  if (priceCurrency !== 'USD') return { priceMin, priceMax, priceCurrency };
  return {
    priceMin: wholeDollarBound(priceMin, 'min'),
    priceMax: wholeDollarBound(priceMax, 'max'),
    priceCurrency,
  };
}

export function publicUsdFilterQuery(locale: Locale, scope: UsdFilterScope = {}) {
  return { catalog: 'curated', locale, q: scope.q, exportStatus: scope.exportStatus, ...websitePriceBounds(scope), ...publicUsdView };
}

export function publicUsdCatalogQuery(query: PublicVehicleQuery) {
  return { ...query, ...websitePriceBounds(query), ...publicUsdView, projection: 'card' as const };
}

export const catalogFilterKeys = [
  'q',
  'exportStatus',
  'sort',
  'make',
  'model',
  'generation',
  'trim',
  'powertrain',
  'drivetrain',
  'priceMin',
  'priceMax',
  'priceCurrency',
  'mileageMin',
  'mileageMax',
  'yearMin',
  'yearMax',
] as const;
export const catalogQueryKeys = [
  'catalog',
  'locale',
  'view',
  'priceView',
  'projection',
  ...catalogFilterKeys,
  'page',
  'pageSize',
];
const integerKeys = new Set(['page', 'pageSize', 'mileageMin', 'mileageMax', 'yearMin', 'yearMax']);

/** Identical validation for SSR, browser history and the allowlisted BFF. */
export function parseCatalogQuery(
  params: Record<string, string | string[] | undefined>,
  locale: Locale,
) {
  const input: Record<string, unknown> = { locale, catalog: 'curated' };
  for (const key of [...catalogFilterKeys, 'view', 'priceView', 'projection', 'page', 'pageSize']) {
    const value = params[key];
    if (value === undefined || (value === '' && key !== 'priceView')) continue;
    if (Array.isArray(value)) return null;
    input[key] = integerKeys.has(key)
      ? /^(0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : NaN
      : value;
  }
  const parsed = PublicVehicleQuerySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Old non-USD page bookmarks retain the vehicle filters without reinterpreting their amounts. */
export function parseCatalogPageQuery(
  params: Record<string, string | string[] | undefined>,
  locale: Locale,
) {
  const input = { ...params };
  if (typeof input.priceCurrency === 'string' && input.priceCurrency && input.priceCurrency !== 'USD') {
    if (!parseCatalogQuery(input, locale)) return null;
    delete input.priceMin;
    delete input.priceMax;
    delete input.priceCurrency;
  }
  return parseCatalogQuery({ ...input, ...publicUsdView }, locale);
}

export type CatalogPageRequest = {
  kind: 'query' | 'offset_limit';
  query: PublicVehicleQuery;
};

/** Only a valid offset beyond the public browsing window gets a readable recovery page. */
export function parseCatalogPageRequest(
  params: Record<string, string | string[] | undefined>,
  locale: Locale,
): CatalogPageRequest | null {
  if (catalogQueryKeys.some((key) => Array.isArray(params[key]))) return null;
  // Page presentation fixes these values, but malformed incoming transport fields
  // must not be hidden by that override and mistaken for an offset-only failure.
  for (const key of ['catalog', 'view', 'priceView'] as const) {
    const value = params[key] === '' && key !== 'priceView' ? undefined : params[key];
    if (!PublicVehicleQuerySchema.shape[key].safeParse(value).success) return null;
  }
  const query = parseCatalogPageQuery(params, locale);
  if (query) return { kind: 'query', query };
  if (typeof params.page !== 'string' || !/^[1-9]\d*$/.test(params.page)) return null;
  const page = PublicVehicleQuerySchema.shape.page.safeParse(Number(params.page));
  if (!page.success) return null;
  const firstPage = parseCatalogPageQuery({ ...params, page: '1' }, locale);
  if (!firstPage || isPublicCatalogOffsetAllowed(page.data, firstPage.pageSize)) return null;
  return { kind: 'offset_limit', query: firstPage };
}

export function parseFilterQuery(
  params: Record<string, string | string[] | undefined>,
  locale: Locale,
) {
  const query = parseCatalogQuery(params, locale);
  if (!query) return null;
  const { page: _page, pageSize: _size, projection: _projection, ...filters } = query;
  const parsed = PublicFilterQuerySchema.safeParse(filters);
  return parsed.success ? parsed.data : null;
}
export function publicQueryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
}
