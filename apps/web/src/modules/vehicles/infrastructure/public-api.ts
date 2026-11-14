import { PublicVehicleInspectionQuerySchema, type PublicVehicleInspectionQuery } from '@hd/contracts/public';
import { parseVehicleSegment } from '../public-segments';
import { PublicVehicleFiltersSchema, type PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicRequestHeaders } from './public-request-context';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { publicUsdCatalogQuery, publicUsdFilterQuery, publicUsdView, publicQueryString as queryString, type UsdFilterScope } from '../public-query';
import { PublicApiError, publicApiOrigin, readPublicJsonBody, isPublicApiError } from './public-http';
import {
  legacyListSchema,
  legacyVehicleSchema,
  localizedHomeSchema,
  localizedCardListSchema,
  localizedVehicleSchema,
} from '../localized-projection';
export { parseCatalogQuery, parseCatalogPageQuery } from '../public-query';
export { publicQueryString as queryString } from '../public-query';
export { PublicApiError, publicApiOrigin } from './public-http';

/** Parallel page reads, including facets, share the public JSON rate bucket. */
export function publicRetryAfter(...outcomes: PromiseSettledResult<unknown>[]): number {
  return Math.max(
    0,
    ...outcomes.map((outcome) =>
      outcome.status === 'rejected' &&
      isPublicApiError(outcome.reason) &&
      outcome.reason.status === 429
        ? retryAfterSeconds(outcome.reason.retryAfter)
        : 0,
    ),
  );
}

export async function requestPublicApi(
  path: string,
  fetcher: typeof fetch = fetch,
  incoming?: Pick<Headers, 'get'>,
  postJson?: string,
) {
  const target = new URL(path, publicApiOrigin());
  if (target.origin !== publicApiOrigin() || !target.pathname.startsWith('/api/v1/'))
    throw new PublicApiError(503);
  try {
    const response = await fetcher(target.href, {
      cache: 'no-store',
      ...(postJson !== undefined ? { method: 'POST', body: postJson } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json, image/*;q=0.9',
        ...(postJson !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(await publicRequestHeaders(incoming)),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PublicApiError(
        [400, 404, 409, 429].includes(response.status) ? response.status : 503,
        response.status === 429
          ? String(retryAfterSeconds(response.headers.get('retry-after')))
          : undefined,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}

export async function readPublicJson<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  incoming?: Pick<Headers, 'get'>,
  postJson?: string,
) {
  try {
    const response = await requestPublicApi(path, fetch, incoming, postJson);
    return await readPublicJsonBody(response, schema);
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}

export function getPublicHome(locale: Locale) {
  return readPublicJson(
    `/api/v1/home/vehicles?${queryString({ locale, ...publicUsdView })}`,
    localizedHomeSchema(locale, 'usd'),
  );
}
export function getPublicFilters(locale: Locale, scope?: UsdFilterScope) {
  return readPublicJson(
    `/api/v1/vehicle-filters?${queryString(publicUsdFilterQuery(locale, scope))}`,
    PublicVehicleFiltersSchema,
  );
}
export function getPublicCatalog(query: PublicVehicleQuery) {
  return readPublicJson(
    `/api/v1/vehicles?${queryString(publicUsdCatalogQuery(query))}`,
    localizedCardListSchema(query.locale, 'usd'),
  );
}
/** Keep sitemap traversal on the bounded editorial catalog when localized browsing includes imports. */
export function getPublicSitemapCatalog(locale: Locale, page: number) {
  return readPublicJson(
    `/api/v1/vehicles?${queryString({ locale, catalog: 'curated', view: 'legacy', page, pageSize: 48 })}`,
    legacyListSchema,
  );
}
export async function getPublicVehicle(
  id: string,
  locale: Locale,
  incoming?: Pick<Headers, 'get'>,
  view?: 'legacy' | 'localized',
  priceView?: 'usd',
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) return null;
  try {
    const result = await readPublicJson(
      `/api/v1/vehicles/${id}?${queryString({ locale, view, priceView })}`,
      view === 'localized' ? localizedVehicleSchema(locale, priceView) : legacyVehicleSchema,
      incoming,
    );
    if (result.data.id !== id || result.data.detailPath !== `/${locale}/cars/${id}/`)
      throw new PublicApiError(503);
    return result.data;
  } catch (error) {
    if (error instanceof PublicApiError && [400, 404].includes(error.status)) return null;
    throw error;
  }
}

/** Report pages read only the existing public, bounded stored projection, with no internal alias or cache. */
export function getPublicVehicleInspection(id: string, locale: Locale,
  options: Partial<Pick<PublicVehicleInspectionQuery, 'category' | 'part' | 'outcome' | 'order' | 'limit'>> = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) throw new PublicApiError(404);
  const query = PublicVehicleInspectionQuerySchema.parse({ ...options, locale, limit: options.limit ?? 50 });
  return readPublicJson(`/api/v1/vehicles/${id}/inspection?${queryString(query)}`, {
    parse: value => parseVehicleSegment('inspection', value, id, locale),
  });
}
