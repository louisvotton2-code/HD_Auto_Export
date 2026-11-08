import { PublicFilterQuerySchema, PublicVehicleQuerySchema } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

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
  for (const key of [...catalogFilterKeys, 'view', 'page', 'pageSize']) {
    const value = params[key];
    if (value === undefined || value === '') continue;
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
