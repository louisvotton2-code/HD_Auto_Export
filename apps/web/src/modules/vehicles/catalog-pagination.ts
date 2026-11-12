import { PublicVehicleQuerySchema, type CatalogMeta } from '@hd/contracts/public';

export type CatalogPageItem = number | 'ellipsis';

type PaginationInput = Pick<CatalogMeta, 'total' | 'totalKind' | 'accessibleTotal'> & {
  page: number;
  pageSize: number;
  hasMore: boolean;
};

const validPage = (page: number) => PublicVehicleQuerySchema.safeParse({ page }).success;

/** Keep the displayed browsable range inside the API contract without duplicating its page limit. */
function accessiblePageCount(pages: number): number {
  if (pages === 0 || validPage(pages)) return pages;
  let low = 1;
  let high = pages - 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (validPage(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** API totals describe the whole matching result; a page's item count cannot establish its last page. */
export function catalogPagination(input: PaginationInput) {
  const exactTotal = input.totalKind === 'exact' ? input.total : null;
  const count = input.accessibleTotal ?? exactTotal;
  const theoreticalPages = count === null ? null : Math.ceil(count / input.pageSize);
  const totalPages = theoreticalPages === null ? null : accessiblePageCount(theoreticalPages);
  const totalKind = totalPages === null ? null
    : totalPages === theoreticalPages && exactTotal !== null && (input.accessibleTotal === null || input.accessibleTotal === exactTotal)
      ? 'exact' : 'accessible';
  const outOfRange = totalPages !== null && input.page > Math.max(1, totalPages);
  const items: CatalogPageItem[] = [];
  if (totalPages === null) items.push(input.page);
  else if (totalPages > 0) {
    // Match the reference's current / next / … / last layout without duplicating the last page.
    const first = Math.min(input.page, totalPages);
    if (validPage(first)) items.push(first);
    if (first < totalPages && validPage(first + 1)) items.push(first + 1);
    if (first + 1 < totalPages && validPage(totalPages)) {
      if (first + 2 < totalPages) items.push('ellipsis');
      items.push(totalPages);
    }
  }
  const previous = input.page > 1
    ? Math.max(1, Math.min(input.page - 1, totalPages ?? input.page - 1)) : null;
  const next = input.hasMore && (totalPages === null || input.page < totalPages) && validPage(input.page + 1)
    ? input.page + 1 : null;
  return { items, totalPages, totalKind, outOfRange, previous, next };
}
