import {
  INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER,
  InternalPublicCatalogCacheStampSchema,
  InternalPublicCatalogHomepageVersionResponseSchema,
  InternalPublicCatalogVersionResponseSchema,
  PublicCatalogCacheStampSchema,
  PublicCatalogVersionResponseSchema,
  type PublicCatalogCacheStamp,
} from '@hd/contracts/public';
import { getSsrServiceSecret } from '@/shared/config/ssr-service-secret';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { PublicApiError, publicApiOrigin, readPublicJsonBody } from './public-http';
import { anonymousPublicEnvelope, type SsrCacheProtocol, type SsrPublicDescriptor, type SsrPublicEnvelope } from './ssr-public-reader';

const prefix = '/internal/public-catalog';
const offsetSnapshotHeader = 'X-HD-Catalog-Offset-Snapshot';
const inlineSnapshotHeader = 'X-HD-Catalog-Inline-Snapshot';
const publicRoute = /^\/api\/v1\/(?:vehicles(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})?|vehicle-filters|home\/vehicles)$/;

/** A fixed allowlist, never a general reverse proxy or a private media/admin reader. */
export function internalCatalogPath(publicPath: string) {
  const parsed = new URL(publicPath, 'http://public-path.invalid');
  if (!publicPath.startsWith('/api/v1/') || parsed.origin !== 'http://public-path.invalid' || parsed.hash || !publicRoute.test(parsed.pathname))
    throw new PublicApiError(503);
  return `${prefix}${parsed.pathname.slice('/api/v1'.length)}${parsed.search}`;
}

type SnapshotOptions = Pick<SsrPublicDescriptor<SsrPublicEnvelope>, 'allowOffsetSnapshot' | 'allowInlineSnapshot'>;
async function requestInternal(path: string, visitorHeaders?: Record<string, string>, scope?: 'filters', snapshot?: SnapshotOptions, signal?: AbortSignal) {
  try {
    const origin = publicApiOrigin();
    const target = new URL(path, origin);
    if (target.origin !== origin || !target.pathname.startsWith(`${prefix}/`)
      || (scope && target.pathname !== `${prefix}/vehicle-filters`)
      || (snapshot?.allowOffsetSnapshot && (target.pathname !== `${prefix}/vehicles` || target.searchParams.has('cursor')
        || target.searchParams.has('pagination')))
      || (snapshot?.allowInlineSnapshot && (!target.pathname.startsWith(`${prefix}/vehicles/`)
        || target.searchParams.get('projection') !== 'detail-inline-v1'))) throw new PublicApiError(503);
    const response = await fetch(target.href, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: signal ?? AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json', 'Cache-Control': 'no-store', 'X-HD-SSR-Key': getSsrServiceSecret(),
        [INTERNAL_PUBLIC_CATALOG_CACHE_PROTOCOL_HEADER]: '2',
        ...(visitorHeaders?.['X-Forwarded-For'] ? { 'X-Forwarded-For': visitorHeaders['X-Forwarded-For'] } : {}),
        ...(scope ? { 'X-HD-Catalog-Scope': scope } : {}),
        ...(snapshot?.allowOffsetSnapshot ? { [offsetSnapshotHeader]: '1' } : {}),
        ...(snapshot?.allowInlineSnapshot ? { [inlineSnapshotHeader]: '1' } : {}),
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new PublicApiError([400, 404, 429].includes(response.status) ? response.status : 503,
        response.status === 429 ? String(retryAfterSeconds(response.headers.get('retry-after'))) : undefined);
    }
    if (!response.headers.get('cache-control')?.toLowerCase().split(',').some(value => value.trim() === 'no-store')) {
      await response.body?.cancel().catch(() => undefined);
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
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (priceView === 'usd') query.set('priceView', 'usd');
  if (scope) query.set('scope', scope);
  try {
    const response = await requestInternal(`${prefix}/version${query.size ? `?${query}` : ''}`, visitorHeaders, undefined, undefined, signal);
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PublicApiError(503);
    }
    const protocol = confirmedProtocol(response);
    const schema = protocol === 2 ? InternalPublicCatalogVersionResponseSchema : PublicCatalogVersionResponseSchema;
    return { protocol, value: await readPublicJsonBody(response, schema, 16_384) };
  } catch (error) {
    // A missing control endpoint/credential is an outage, never a missing vehicle.
    if (error instanceof PublicApiError && error.status === 429) throw error;
    throw new PublicApiError(503);
  }
}

function validateAtomicVersions(catalog: PublicCatalogCacheStamp, filters: PublicCatalogCacheStamp) {
  if (catalog.priceView !== 'usd' || filters.priceView !== 'usd'
    || catalog.fx?.version !== filters.fx?.version || catalog.fx?.expiresAt !== filters.fx?.expiresAt
    || Date.parse(catalog.checkedAt) !== Date.parse(filters.checkedAt)) {
    throw new PublicApiError(503);
  }
}

type SsrVersionOutcome = PromiseSettledResult<Awaited<ReturnType<typeof readSsrServiceVersion>>>;

/** Both live scopes share one authenticated check and, for old APIs, one fallback deadline. */
export async function readSsrServiceVersions(visitorHeaders: Record<string, string>, signal?: AbortSignal):
  Promise<{ catalog: Promise<SsrVersionOutcome>; filters: Promise<SsrVersionOutcome> }> {
  const timeout = AbortSignal.timeout(5000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await requestInternal(`${prefix}/version?priceView=usd&scope=homepage`,
      visitorHeaders, undefined, undefined, deadline).catch((error: unknown) => {
      if (error instanceof PublicApiError && error.status === 400) return null;
      throw error;
    });
    if (response) {
      if (response.status !== 200 || confirmedProtocol(response) !== 2) {
        await response.body?.cancel();
        throw new PublicApiError(503);
      }
      const { data, meta } = await readPublicJsonBody(response, InternalPublicCatalogHomepageVersionResponseSchema, 16_384);
      validateAtomicVersions(data.catalog, data.filters);
      return {
        catalog: Promise.resolve({ status: 'fulfilled', value: { protocol: 2, value: { data: data.catalog, meta } } }),
        filters: Promise.resolve({ status: 'fulfilled', value: { protocol: 2, value: { data: data.filters, meta } } }),
      };
    }
    deadline.throwIfAborted();
    // Preserve independent completion on old APIs. The HTML proof consumer still requires both.
    const read = (scope?: 'filters'): Promise<SsrVersionOutcome> =>
      readSsrServiceVersion('usd', visitorHeaders, scope, deadline).then(
        value => ({ status: 'fulfilled', value }),
        (reason: unknown) => ({ status: 'rejected', reason }),
      );
    return { catalog: read(), filters: read('filters') };
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 429) throw error;
    throw new PublicApiError(503);
  }
}

/** Static service identity only. No Next headers, visitor IP, cookie or caller trace enters this loader. */
export async function readAnonymousPublicResource<T extends SsrPublicEnvelope>(descriptor: SsrPublicDescriptor<T>) {
  try {
    const response = await requestInternal(internalCatalogPath(descriptor.path), undefined, descriptor.scope, descriptor);
    const protocol = confirmedProtocol(response);
    const schema = protocol === 2 ? internalResourceSchema(descriptor.schema) : descriptor.schema;
    const parsed = await readPublicJsonBody(response, schema);
    const snapshot = descriptor.allowOffsetSnapshot ? response.headers.get(offsetSnapshotHeader) : null;
    const stampSchema = protocol === 2 ? InternalPublicCatalogCacheStampSchema : PublicCatalogCacheStampSchema;
    return { protocol, value: anonymousPublicEnvelope(parsed),
      ...(snapshot ? { offsetSnapshot: stampSchema.parse(JSON.parse(snapshot)) } : {}),
      ...(descriptor.allowInlineSnapshot && response.headers.get(inlineSnapshotHeader) === '1' ? { inlineSnapshot: true as const } : {}) };
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}
