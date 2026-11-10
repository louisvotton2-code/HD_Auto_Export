import { PublicVehicleFiltersSchema, type PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicRequestHeaders } from './public-request-context';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { publicUsdCatalogQuery, publicUsdFilterQuery, publicUsdView, type UsdFilterScope } from '../public-query';
import {
  legacyListSchema,
  legacyVehicleSchema,
  localizedHomeSchema,
  localizedListSchema,
  localizedVehicleSchema,
} from '../localized-projection';
export { parseCatalogQuery, parseCatalogPageQuery } from '../public-query';

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: string,
  ) {
    super('Public vehicle service unavailable');
  }
}

/** Parallel page reads, including facets, share the public JSON rate bucket. */
export function publicRetryAfter(...outcomes: PromiseSettledResult<unknown>[]): number {
  return Math.max(
    0,
    ...outcomes.map((outcome) =>
      outcome.status === 'rejected' &&
      outcome.reason instanceof PublicApiError &&
      outcome.reason.status === 429
        ? retryAfterSeconds(outcome.reason.retryAfter)
        : 0,
    ),
  );
}

/** Server-only configuration. Never passed to client components or serialized in errors. */
export function publicApiOrigin() {
  const url = new URL(process.env.VEHICLE_API_BASE_URL || 'http://127.0.0.1:3320');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new PublicApiError(503);
  return url.origin;
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
        [400, 404, 429].includes(response.status) ? response.status : 503,
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
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new PublicApiError(503);
    const reader = response.body?.getReader();
    if (!reader) throw new PublicApiError(503);
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8_000_000) throw new PublicApiError(503);
        parts.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}

export const queryString = (query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
};

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
    localizedListSchema(query.locale, 'usd'),
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
