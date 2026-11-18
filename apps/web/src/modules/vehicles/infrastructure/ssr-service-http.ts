import {
  INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER,
  InternalPublicCatalogCacheStampSchema,
  InternalPublicCatalogVersionResponseSchema,
  PublicCatalogVersionResponseSchema,
  type PublicCatalogCacheStamp,
} from '@hd/contracts/public';
import { getSsrServiceSecret } from '@/shared/config/ssr-service-secret';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { PublicApiError, publicApiOrigin, readPublicJsonBody } from './public-http';
import { anonymousPublicEnvelope, type SsrCacheProtocol, type SsrPublicDescriptor, type SsrPublicEnvelope } from './ssr-public-reader';

const prefix = '/internal/public-catalog';
const publicRoute = /^\/api\/v1\/(?:vehicles(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})?|vehicle-filters|home\/vehicles)$/;

/** A fixed allowlist, never a general reverse proxy or a private media/admin reader. */
export function internalCatalogPath(publicPath: string) {
  const parsed = new URL(publicPath, 'http://public-path.invalid');
  if (!publicPath.startsWith('/api/v1/') || parsed.origin !== 'http://public-path.invalid' || parsed.hash || !publicRoute.test(parsed.pathname))
    throw new PublicApiError(503);
  return `${prefix}${parsed.pathname.slice('/api/v1'.length)}${parsed.search}`;
}

async function requestInternal(path: string, visitorHeaders?: Record<string, string>, scope?: 'filters') {
  try {
    const origin = publicApiOrigin();
    const target = new URL(path, origin);
    if (target.origin !== origin || !target.pathname.startsWith(`${prefix}/`)
      || (scope && target.pathname !== `${prefix}/vehicle-filters`)) throw new PublicApiError(503);
    const response = await fetch(target.href, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json', 'Cache-Control': 'no-store', 'X-HD-SSR-Key': getSsrServiceSecret(),
        [INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER]: '2',
        ...(visitorHeaders?.['X-Forwarded-For'] ? { 'X-Forwarded-For': visitorHeaders['X-Forwarded-For'] } : {}),
        ...(scope ? { 'X-HD-Catalog-Scope': scope } : {}),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PublicApiError([400, 404, 429].includes(response.status) ? response.status : 503,
        response.status === 429 ? String(retryAfterSeconds(response.headers.get('retry-after'))) : undefined);
    }
    if (!response.headers.get('cache-control')?.toLowerCase().split(',').some(value => value.trim() === 'no-store')) {
      await response.body?.cancel();
      throw new PublicApiError(503);
    }
    return response;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}

function confirmedProtocol(response: Response): SsrCacheProtocol {
  return response.headers.get(INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER) === '2' ? 2 : 1;
}

function internalResourceSchema<T extends SsrPublicEnvelope>(schema: SsrPublicDescriptor<T>['schema']) {
  return { parse(body: unknown): T {
    // Validate the negotiated stamp separately; the public DTO parser remains strict
    // and never learns to accept a longer stamp on a browser or public API response.
    if (body === null || typeof body !== 'object' || !('meta' in body)) return schema.parse(body);
    const metadata = body.meta;
    if (metadata === null || typeof metadata !== 'object' || !('catalogCache' in metadata)) return schema.parse(body);
    const { catalogCache, ...meta } = metadata;
    const stamp = InternalPublicCatalogCacheStampSchema.parse(catalogCache);
    const value = schema.parse({ ...body, meta });
    return { ...value, meta: { ...value.meta, catalogCache: stamp } };
  } };
}

/** Caller resolves its trusted visitor IP before entering the shared cache. */
export async function readSsrServiceVersion(
  priceView: PublicCatalogCacheStamp['priceView'],
  visitorHeaders: Record<string, string>,
  scope?: 'filters',
) {
  const query = new URLSearchParams();
  if (priceView === 'usd') query.set('priceView', 'usd');
  if (scope) query.set('scope', scope);
  try {
    const response = await requestInternal(`${prefix}/version${query.size ? `?${query}` : ''}`, visitorHeaders);
    const protocol = confirmedProtocol(response);
    const schema = protocol === 2 ? InternalPublicCatalogVersionResponseSchema : PublicCatalogVersionResponseSchema;
    return { protocol, value: await readPublicJsonBody(response, schema, 16_384) };
  } catch (error) {
    // A missing control endpoint/credential is an outage, never a missing vehicle.
    if (error instanceof PublicApiError && error.status === 429) throw error;
    throw new PublicApiError(503);
  }
}

/** Static service identity only. No Next headers, visitor IP, cookie or caller trace enters this loader. */
export async function readAnonymousPublicResource<T extends SsrPublicEnvelope>(descriptor: SsrPublicDescriptor<T>) {
  try {
    const response = await requestInternal(internalCatalogPath(descriptor.path), undefined, descriptor.scope);
    const protocol = confirmedProtocol(response);
    const schema = protocol === 2 ? internalResourceSchema(descriptor.schema) : descriptor.schema;
    const parsed = await readPublicJsonBody(response, schema);
    return { protocol, value: anonymousPublicEnvelope(parsed) };
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}
