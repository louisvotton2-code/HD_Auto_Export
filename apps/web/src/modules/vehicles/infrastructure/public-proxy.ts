import {
  IdSchema,
  PublicLocaleQuerySchema,
  PublicMediaQuerySchema,
  PublicVehicleFiltersSchema,
  PublicVehicleSegmentQuerySchema,
  PublicVehicleInspectionQuerySchema,
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
import { parseVehicleSegment, type VehicleSegmentKind } from '../public-segments';
import { catalogQueryKeys, parseFilterQuery } from '../public-query';
import {
  legacyHomeSchema,
  legacyListSchema,
  localizedHomeSchema,
  localizedListSchema,
  localizedCardListSchema,
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
                : status === 409
                  ? 'VERSION_CONFLICT'
                : 'SERVICE_UNAVAILABLE',
        message:
          status === 404
            ? 'Not found'
            : status === 400
              ? 'Invalid public query'
              : status === 429
                ? 'Too many requests. Please try again later.'
                : status === 409
                  ? 'Vehicle content changed. Reload this section.'
                : 'Service temporarily unavailable',
        retryable: status === 503 || status === 429 || status === 409,
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
  const isSegment = /^vehicles\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\/(gallery|configuration|inspection|price-history)$/.test(path);
  if (!['home/vehicles', 'vehicles', 'vehicle-filters'].includes(path) && !isMedia && !isDetail && !isSegment)
    return failure(404);
  const params = new URL(request.url).searchParams;
  const allowed = isSegment ? (parts[2] === 'inspection' ? ['locale', 'limit', 'cursor', 'category', 'part', 'outcome', 'order'] : ['locale', 'limit', 'cursor']) : isMedia
    ? ['variant']
    : path === 'vehicles'
      ? catalogQueryKeys
      : path === 'vehicle-filters'
        ? catalogQueryKeys.filter((key) => key !== 'page' && key !== 'pageSize' && key !== 'projection')
        : ['locale', 'view', 'priceView'];
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return failure(400);
  try {
    let query: Record<string, string | number | undefined> = {};
    if (isSegment) query = (parts[2] === 'inspection' ? PublicVehicleInspectionQuerySchema : PublicVehicleSegmentQuerySchema).parse(Object.fromEntries(params));
    else if (isMedia) query = PublicMediaQuerySchema.parse(Object.fromEntries(params));
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
    if (isDetail || isSegment) IdSchema.parse(parts[1]);
    if (isSegment) {
      const value = await readPublicJson(`/api/v1/${path}?${queryString(query)}`, {
        parse: body => parseVehicleSegment(parts[2] as VehicleSegmentKind, body, parts[1]!, query.locale as Locale),
      }, request.headers);
      return Response.json(value, { headers });
    }
    if (isDetail) {
      const vehicle = await getPublicVehicle(
        parts[1]!,
        query.locale as Locale,
        request.headers,
        query.view as 'legacy' | 'localized' | undefined,
        query.priceView as 'usd' | undefined,
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
    const priceView = query.priceView as 'usd' | undefined;
    const schema = path === 'home/vehicles'
      ? (localized ? localizedHomeSchema(locale, priceView) : legacyHomeSchema)
      : path === 'vehicles'
        ? (query.projection === 'card' ? localizedCardListSchema(locale, priceView) : localized ? localizedListSchema(locale, priceView) : legacyListSchema)
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
