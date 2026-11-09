import {
  IdSchema,
  PublicLocaleQuerySchema,
  PublicMediaQuerySchema,
  PublicVehicleFiltersSchema,
} from '@hd/contracts/public';
import {
  PublicApiError,
  parseCatalogQuery,
  queryString,
  readPublicJson,
  requestPublicApi,
  getPublicVehicle,
} from './public-api';
import type { Locale } from '@/i18n/routing';
import { catalogQueryKeys, parseFilterQuery } from '../public-query';
import {
  legacyHomeSchema,
  legacyListSchema,
  localizedHomeSchema,
  localizedListSchema,
} from '../localized-projection';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function failure(status: number, retryAfter?: string) {
  return Response.json(
    {
      error: {
        code:
          status === 404
            ? 'NOT_FOUND'
            : status === 400
              ? 'INVALID_REQUEST'
              : status === 429
                ? 'RATE_LIMITED'
                : 'SERVICE_UNAVAILABLE',
        message:
          status === 404
            ? 'Not found'
            : status === 400
              ? 'Invalid public query'
              : status === 429
                ? 'Too many requests. Please try again later.'
                : 'Service temporarily unavailable',
        retryable: status === 503 || status === 429,
      },
      meta: { requestId: crypto.randomUUID() },
    },
    {
      status,
      headers: {
        ...headers,
        ...(status === 429 && retryAfter !== undefined ? { 'Retry-After': retryAfter } : {}),
      },
    },
  );
}

/** An allowlisted public BFF, not an arbitrary reverse proxy or an admin/auth endpoint. */
export async function proxyPublicRequest(request: Request, parts: string[]) {
  const path = parts.join('/');
  const isMedia = /^media\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(path);
  const isDetail = /^vehicles\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(path);
  if (!['home/vehicles', 'vehicles', 'vehicle-filters'].includes(path) && !isMedia && !isDetail)
    return failure(404);
  const params = new URL(request.url).searchParams;
  const allowed = isMedia
    ? ['variant']
    : path === 'vehicles'
      ? catalogQueryKeys
      : path === 'vehicle-filters'
        ? catalogQueryKeys.filter((key) => key !== 'page' && key !== 'pageSize')
        : ['locale', 'view'];
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return failure(400);
  try {
    let query: Record<string, string | number | undefined> = {};
    if (isMedia) query = PublicMediaQuerySchema.parse(Object.fromEntries(params));
    else {
      const raw = Object.fromEntries(params);
      if (path === 'vehicles') {
        const locale = PublicLocaleQuerySchema.parse({ locale: raw.locale }).locale;
        const parsed = parseCatalogQuery(raw, locale);
        if (!parsed || (raw.catalog && raw.catalog !== 'curated')) return failure(400);
        query = parsed;
      } else if (path === 'vehicle-filters') {
        const locale = PublicLocaleQuerySchema.parse({ locale: raw.locale }).locale;
        const parsed = parseFilterQuery(raw, locale);
        if (!parsed || (raw.catalog && raw.catalog !== 'curated')) return failure(400);
        query = parsed;
      } else query = PublicLocaleQuerySchema.parse(raw);
    }
    if (isDetail) IdSchema.parse(parts[1]);
    if (isDetail) {
      const vehicle = await getPublicVehicle(
        parts[1]!,
        query.locale as Locale,
        request.headers,
        query.view as 'legacy' | 'localized' | undefined,
      );
      return vehicle
        ? Response.json({ data: vehicle, meta: { requestId: crypto.randomUUID() } }, { headers })
        : failure(404);
    }
    const upstream = `/api/v1/${path}${Object.keys(query).length ? `?${queryString(query)}` : ''}`;
    if (isMedia) {
      const response = await requestPublicApi(upstream, fetch, request.headers);
      const type = response.headers.get('content-type')?.split(';')[0].trim();
      if (
        !type ||
        !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(type)
      ) {
        await response.body?.cancel();
        return failure(503);
      }
      const reader = response.body?.getReader();
      if (!reader) return failure(503);
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 32_000_000) throw new PublicApiError(503);
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
      return new Response(bytes, { headers: { ...headers, 'Content-Type': type } });
    }
    // Each schema validates only the public DTO. Browser credentials are never forwarded.
    const locale = query.locale as Locale;
    const localized = query.view === 'localized';
    const schema = path === 'home/vehicles'
      ? (localized ? localizedHomeSchema(locale) : legacyHomeSchema)
      : path === 'vehicles'
        ? (localized ? localizedListSchema(locale) : legacyListSchema)
        : PublicVehicleFiltersSchema;
    const value = await readPublicJson(
      upstream,
      schema as { parse: (value: unknown) => unknown },
      request.headers,
    );
    return Response.json(value, { headers });
  } catch (error) {
    return failure(
      error instanceof PublicApiError ? error.status : 400,
      error instanceof PublicApiError ? error.retryAfter : undefined,
    );
  }
}
