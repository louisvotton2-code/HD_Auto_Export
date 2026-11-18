import type { PublicFilterQuery } from '@hd/contracts/public';
import type { FxQuote } from './fx.js';

export type CatalogAnchor = { publishedAt: string; id: string; sortValue?: string | null };
export type CatalogSort = NonNullable<PublicFilterQuery['sort']>;
export const numericSort = (sort?: CatalogSort) => !!sort && sort !== 'newest';
export const sortDirection = (sort?: CatalogSort) => sort === 'price_asc' || sort === 'mileage_asc' ? 'ASC' : 'DESC';
export const catalogOrder = (column: string, id: string, sort?: CatalogSort) => `${column} ${sortDirection(sort)} NULLS LAST,${id} ASC`;

/** Compute rounded USD cents with one integer quotient, matching the public price projection. */
export function exactUsdSortValue(amount: string, rate: string): string {
  return `(div((${amount})*200+(${rate}),2*nullif((${rate}),0))*0.01)`;
}

/** Same positive half-up cents and supported amount range as projectUsdPrice. */
export function usdSortAmount(amount: string, currency: string, quote: FxQuote | null, params: unknown[]): string {
  params.push(JSON.stringify(quote?.rates ?? {}));
  const rate = `CASE WHEN ${currency}='USD' THEN 1::numeric ELSE ($${params.length}::jsonb->>(${currency}))::numeric END`;
  const converted = exactUsdSortValue(amount,rate);
  return `CASE WHEN (${rate})>0 AND (${converted}) BETWEEN 0 AND 99999999999999.99 THEN ${converted} END`;
}

/** Nulls are last in both directions. IDs always ascend, including the null tail. */
export function catalogSeek(column: string, id: string, anchor: CatalogAnchor, sort: CatalogSort, params: unknown[]): string {
  if (anchor.sortValue === null) {
    const key = `$${params.push(anchor.id)}::uuid`;
    return `(${column} IS NULL AND ${id}>${key})`;
  }
  params.push(anchor.sortValue ?? null, anchor.id);
  const value = `$${params.length - 1}::numeric`, key = `$${params.length}::uuid`;
  const op = sortDirection(sort) === 'ASC' ? '>' : '<';
  return `(${column} ${op} ${value} OR (${column}=${value} AND ${id}>${key}) OR ${column} IS NULL)`;
}
