import {
  matchPublicHtmlCacheScopes,
  parsePublicHtmlCacheStamp,
  type PublicHtmlCacheData,
} from '@/shared/lib/public-html-render-proof';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { isPublicApiError, PublicApiError } from './public-http';
import { trustedVisitorHeaders } from './public-request-context';
import { readSsrServiceVersions } from './ssr-service-http';

/** Authorize an anonymous HTML cache hit using both live protocol-2 scopes. */
export async function getPublicHtmlCacheVersions(visitor: string, signal: AbortSignal): Promise<PublicHtmlCacheData> {
  const forwarded = trustedVisitorHeaders({ get: name => name === 'x-hd-visitor-ip' ? visitor : null });
  if (!forwarded['X-Forwarded-For']) throw new PublicApiError(503);
  const versionsRead = await readSsrServiceVersions(forwarded, signal);
  const [catalogRead, filtersRead] = await Promise.all([versionsRead.catalog, versionsRead.filters]);
  const retryAfter = [catalogRead, filtersRead].flatMap(result =>
    result.status === 'rejected' && isPublicApiError(result.reason) && result.reason.status === 429
      ? [retryAfterSeconds(result.reason.retryAfter)] : []);
  if (retryAfter.length) throw new PublicApiError(429, String(Math.max(...retryAfter)));
  if (catalogRead.status !== 'fulfilled' || filtersRead.status !== 'fulfilled'
    || catalogRead.value.protocol !== 2 || filtersRead.value.protocol !== 2) throw new PublicApiError(503);
  const now = Date.now();
  const catalog = parsePublicHtmlCacheStamp(catalogRead.value.value.data, now);
  const filters = parsePublicHtmlCacheStamp(filtersRead.value.value.data, now);
  const versions = catalog && filters && matchPublicHtmlCacheScopes(catalog, filters);
  if (!versions) throw new PublicApiError(503);
  return versions;
}
