import type { Locale } from '@/i18n/routing';
import { catalogCategoryFilters, catalogSubcategoryFilters } from './mock/parts-filters';
import type { Part, PartCategory, PartsQuery } from './types';

export const partCategories: readonly PartCategory[] = ['chassis', 'transmission', 'components', 'body'];
export const defaultPartsQuery: PartsQuery = { q: '', brand: '', category: '', subcategory: '', min: '', max: '', sort: 'default' };
export const catalogRecordCount = 48_689;
// The reference catalog uses 24 entries per page for its page numbering.
export const catalogPageCount = Math.ceil(catalogRecordCount / 24);

export const selectedFilterValues = (value: string) => value ? value.split(',') : [];
const money = (value: string) => !value || /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value);

export function parsePartsQuery(raw: Record<string, string | string[] | undefined>): { query: PartsQuery; page: number; invalid: boolean } {
  const one = (key: string) => typeof raw[key] === 'string' ? raw[key].trim() : '';
  const many = (key: string) => [...new Set(
    [raw[key] ?? ''].flat().flatMap((value) => value.split(','))
      .map((value) => value.trim().slice(0, 60)).filter(Boolean),
  )].slice(0, 20);
  const q = one('q').slice(0, 100);
  const brand = many('brand').join(',');
  const categories = many('category').map((category) => category === 'components' ? 'engine' : category);
  const category = [...new Set(categories)].filter((id) => catalogCategoryFilters.some((item) => item.id === id)).join(',');
  const subcategory = catalogSubcategoryFilters.some((item) => item.id === one('subcategory')) ? one('subcategory') : '';
  const sort = one('sort');
  const min = one('min'), max = one('max');
  const invalid = Object.entries(raw).some(([key, value]) => !['page', 'brand', 'category'].includes(key) && Array.isArray(value))
    || !money(min) || !money(max) || Boolean(min && max && Number(min) > Number(max));
  const rawPage = one('page');
  const page = /^\d+$/.test(rawPage) ? Math.min(catalogPageCount, Math.max(1, Number(rawPage))) : 1;
  return {
    invalid,
    page,
    query: {
      q, brand, category, subcategory,
      min: invalid ? '' : min,
      max: invalid ? '' : max,
      sort: ['price-asc', 'price-desc', 'name'].includes(sort) ? sort as PartsQuery['sort'] : 'default',
    },
  };
}

export function filterParts(parts: readonly Part[], query: PartsQuery, locale: Locale): Part[] {
  const needle = query.q.toLocaleLowerCase();
  const brands = selectedFilterValues(query.brand);
  const categories = selectedFilterValues(query.category).map((category) => category === 'components' ? 'engine' : category);
  const recordCategories = catalogCategoryFilters.filter((item) => categories.includes(item.id)).map((item) => item.recordCategory);
  const subcategory = catalogSubcategoryFilters.find((item) => item.id === query.subcategory);
  const rows = parts.filter((part) => {
    if (brands.length && !brands.includes(part.brand)) return false;
    if (categories.length && !recordCategories.includes(part.category)) return false;
    if (subcategory && !subcategory.terms.some((term) => part.name.en.toLowerCase().includes(term))) return false;
    if (needle && ![part.oem, part.name[locale], part.name.en, part.brand].some((value) => value.toLocaleLowerCase().includes(needle))) return false;
    if ((query.min || query.max) && part.referencePriceUsd === null) return false;
    return (!query.min || part.referencePriceUsd! >= Number(query.min)) && (!query.max || part.referencePriceUsd! <= Number(query.max));
  });
  if (query.sort === 'price-asc') rows.sort((a, b) => (a.referencePriceUsd ?? Infinity) - (b.referencePriceUsd ?? Infinity));
  if (query.sort === 'price-desc') rows.sort((a, b) => (b.referencePriceUsd ?? -Infinity) - (a.referencePriceUsd ?? -Infinity));
  if (query.sort === 'name') rows.sort((a, b) => a.name[locale].localeCompare(b.name[locale], locale));
  return rows;
}
export function partsHref(locale: Locale, query: Partial<PartsQuery> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value && value !== 'default') params.set(key, value);
  return `/${locale}/parts/${params.size ? `?${params}` : ''}`;
}
export const partHref = (locale: Locale, slug: string) => `/${locale}/parts/${slug}/`;
export function parsePartQuantity(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value)) return null;
  const quantity = Number(value);
  return quantity <= 999 ? quantity : null;
}
