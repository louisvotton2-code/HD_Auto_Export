import type { PublicFilterQuery } from '@hd/contracts/public';
import type { FxQuote } from './fx.js';

export type CatalogAnchor = { publishedAt: string; id: string; sortValue?: string | null };
export type CatalogSort = NonNullable<PublicFilterQuery['sort']>;
export const numericSort = (sort?: CatalogSort) => !!sort && sort !== 'newest';
export const sortDirection = (sort?: CatalogSort) => sort === 'price_asc' || sort === 'mileage_asc' ? 'ASC' : 'DESC';
export const catalogOrder = (column: string, id: string, sort?: CatalogSort) => `${column} ${sortDirection(sort)} NULLS LAST,${id} ASC`;

/** Same positive half-up cents and supported amount range as projectUsdPrice. */
export function usdSortAmount(amount: string, currency: string, quote: FxQuote | null, params: unknown[]): string {
  params.push(JSON.stringify(quote?.rates ?? {}));
  const rate = `CASE WHEN ${currency}='USD' THEN 1::numeric ELSE ($${params.length}::jsonb->>(${currency}))::numeric END`;
  const converted = `round((${amount})/nullif((${rate}),0),2)`;
  return `CASE WHEN (${rate})>0 AND (${converted}) BETWEEN 0 AND 99999999999999.99 THEN ${converted} END`;
}

/** Nulls are last in both directions. IDs always ascend, including the null tail. */
export function catalogSeek(column: string, id: string, anchor: CatalogAnchor, sort: CatalogSort, params: unknown[]): string {
  params.push(anchor.sortValue ?? null, anchor.id);
  const value = `$${params.length - 1}::numeric`, key = `$${params.length}::uuid`;
  if (anchor.sortValue === null) return `(${column} IS NULL AND ${id}>${key})`;
  const op = sortDirection(sort) === 'ASC' ? '>' : '<';
  return `(${column} ${op} ${value} OR (${column}=${value} AND ${id}>${key}) OR ${column} IS NULL)`;
}
