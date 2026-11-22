import { InternalPublicCatalogHomepageVersionResponseSchema, InternalPublicCatalogVersionResponseSchema } from '@hd/contracts/public';
import { getSsrServiceSecret } from '@/shared/config/ssr-service-secret';
import {
  matchPublicHtmlCacheScopes,
  parsePublicHtmlCacheStamp,
  type PublicHtmlCacheData,
} from '@/shared/lib/public-html-render-proof';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { isPublicApiError, PublicApiError, publicApiOrigin, readPublicJsonBody } from './public-http';
import { trustedVisitorHeaders } from './public-request-context';

const versionPath = '/internal/public-catalog/version?priceView=usd';
const versionBodyLimit = 16_384;
const versionTimeoutMs = 5_000;

async function requestVersion(url: URL, headers: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
    headers,
  });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429)
      throw new PublicApiError(429, String(retryAfterSeconds(response.headers.get('retry-after'))));
    throw new PublicApiError(response.status === 400 ? 400 : 503);
  }
  const noStore = response.headers.get('cache-control')?.toLowerCase().split(',')
    .some(directive => directive.trim() === 'no-store');
  if (!noStore || response.headers.get('x-hd-cache-protocol') !== '2') {
    await response.body?.cancel().catch(() => undefined);
    throw new PublicApiError(503);
  }
  return response;
}

async function readLegacyVersions(origin: string, headers: Record<string, string>, signal: AbortSignal) {
  const read = async (path: string) => (await readPublicJsonBody(
    await requestVersion(new URL(path, origin), headers, signal), InternalPublicCatalogVersionResponseSchema, versionBodyLimit,
  )).data;
  const [catalog, filters] = await Promise.allSettled([read(versionPath), read(`${versionPath}&scope=filters`)]);
  const retryAfter = [catalog, filters].flatMap(result =>
    result.status === 'rejected' && isPublicApiError(result.reason) && result.reason.status === 429
      ? [retryAfterSeconds(result.reason.retryAfter)]
      : []);
  if (retryAfter.length) throw new PublicApiError(429, String(Math.max(...retryAfter)));
  if (catalog.status !== 'fulfilled' || filters.status !== 'fulfilled') throw new PublicApiError(503);
  return { catalog: catalog.value, filters: filters.value };
}

/** The document boundary checks both live scopes before authorizing an anonymous HTML cache hit. */
export async function getPublicHtmlCacheVersions(visitor: string, signal: AbortSignal): Promise<PublicHtmlCacheData> {
  try {
    const forwarded = trustedVisitorHeaders({ get: name => name === 'x-hd-visitor-ip' ? visitor : null });
    if (!forwarded['X-Forwarded-For']) throw new PublicApiError(503);
    const origin = publicApiOrigin();
    const headers = {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'X-HD-SSR-Key': getSsrServiceSecret(),
      'X-HD-Cache-Protocol': '2',
      ...forwarded,
    };
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(versionTimeoutMs)]);
    const batch = await requestVersion(new URL(`${versionPath}&scope=homepage`, origin), headers, deadline)
      .catch((error: unknown) => {
        // An older authenticated API rejects the newly negotiated scope before it reads a version.
        if (isPublicApiError(error) && error.status === 400) return null;
        throw error;
      });
    const stamps = batch
      ? (await readPublicJsonBody(batch, InternalPublicCatalogHomepageVersionResponseSchema, versionBodyLimit)).data
      : await readLegacyVersions(origin, headers, deadline);
    const now = Date.now();
    const catalog = parsePublicHtmlCacheStamp(stamps.catalog, now);
    const filters = parsePublicHtmlCacheStamp(stamps.filters, now);
    const versions = catalog && filters && matchPublicHtmlCacheScopes(catalog, filters);
    if (!versions) throw new PublicApiError(503);
    return versions;
  } catch (error) {
    if (isPublicApiError(error)) throw error;
    throw new PublicApiError(503);
  }
}
