import type { Locale } from '@/i18n/routing';
import type { Part, PartCategory, PartsQuery } from './types';

export const partCategories: readonly PartCategory[] = ['chassis', 'transmission', 'components', 'body'];
export const defaultPartsQuery: PartsQuery = { q: '', brand: '', category: '', min: '', max: '', sort: 'default' };
const money = (value: string) => !value || /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value);
export function parsePartsQuery(raw: Record<string, string | string[] | undefined>): { query: PartsQuery; invalid: boolean } {
  const one = (key: string) => typeof raw[key] === 'string' ? raw[key].trim() : '';
  const q = one('q').slice(0, 100), brand = one('brand'), category = one('category'), sort = one('sort');
  const min = one('min'), max = one('max');
  const invalid = Object.values(raw).some(Array.isArray) || !money(min) || !money(max) || Boolean(min && max && Number(min) > Number(max));
  return { invalid, query: { q, brand, category: partCategories.includes(category as PartCategory) ? category as PartCategory : '', min: invalid ? '' : min, max: invalid ? '' : max, sort: ['price-asc', 'price-desc', 'name'].includes(sort) ? sort as PartsQuery['sort'] : 'default' } };
}
export function filterParts(parts: readonly Part[], query: PartsQuery, locale: Locale): Part[] {
  const needle = query.q.toLocaleLowerCase();
  const rows = parts.filter((part) => {
    if (query.brand && part.brand !== query.brand) return false;
    if (query.category && part.category !== query.category) return false;
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
