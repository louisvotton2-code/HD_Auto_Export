import {
  PublicFilterQuerySchema,
  PublicVehicleQuerySchema,
  type PublicVehicleQuery,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

export const publicUsdView = { view: 'localized', priceView: 'usd' } as const;

export type UsdFilterScope = Pick<PublicVehicleQuery, 'q' | 'priceMin' | 'priceMax' | 'priceCurrency'>;
export function publicUsdFilterQuery(locale: Locale, scope: UsdFilterScope = {}) {
  const { q, priceMin, priceMax, priceCurrency } = scope;
  return { catalog: 'curated', locale, q, priceMin, priceMax, priceCurrency, ...publicUsdView };
}

export const catalogFilterKeys = [
  'q',
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
  for (const key of [...catalogFilterKeys, 'view', 'priceView', 'page', 'pageSize']) {
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
export function parseFilterQuery(
  params: Record<string, string | string[] | undefined>,
  locale: Locale,
) {
  const query = parseCatalogQuery(params, locale);
  if (!query) return null;
  const { page: _page, pageSize: _size, ...filters } = query;
  const parsed = PublicFilterQuerySchema.safeParse(filters);
  return parsed.success ? parsed.data : null;
}
export function publicQueryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
}
