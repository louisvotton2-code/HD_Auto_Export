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

async function readVersion(url: URL, headers: Record<string, string>, signal: AbortSignal) {
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
    throw new PublicApiError(503);
  }
  const noStore = response.headers.get('cache-control')?.toLowerCase().split(',')
    .some(directive => directive.trim() === 'no-store');
  if (!noStore || response.headers.get('x-hd-cache-protocol') !== '2') {
    await response.body?.cancel().catch(() => undefined);
    throw new PublicApiError(503);
  }
  return readPublicJsonBody(response, {
    parse(value: unknown) {
      const stamp = value && typeof value === 'object' && 'data' in value
        ? parsePublicHtmlCacheStamp(value.data)
        : null;
      if (!stamp) throw new PublicApiError(503);
      return stamp;
    },
  }, versionBodyLimit);
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
    const [catalog, filters] = await Promise.allSettled([
      readVersion(new URL(versionPath, origin), headers, deadline),
      readVersion(new URL(`${versionPath}&scope=filters`, origin), headers, deadline),
    ]);
    const retryAfter = [catalog, filters].flatMap(result =>
      result.status === 'rejected' && isPublicApiError(result.reason) && result.reason.status === 429
        ? [retryAfterSeconds(result.reason.retryAfter)]
        : []);
    if (retryAfter.length) throw new PublicApiError(429, String(Math.max(...retryAfter)));
    if (catalog.status !== 'fulfilled' || filters.status !== 'fulfilled') throw new PublicApiError(503);
    const versions = matchPublicHtmlCacheScopes(catalog.value, filters.value);
    if (!versions || Date.parse(versions.catalog.validUntil) <= Date.now()) throw new PublicApiError(503);
    return versions;
  } catch (error) {
    if (isPublicApiError(error)) throw error;
    throw new PublicApiError(503);
  }
}
