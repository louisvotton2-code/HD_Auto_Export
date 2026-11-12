import { PublicCatalogVersionResponseSchema, type PublicCatalogCacheStamp } from '@hd/contracts/public';
import { getSsrServiceSecret } from '@/shared/config/ssr-service-secret';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { PublicApiError, publicApiOrigin, readPublicJsonBody } from './public-http';
import { anonymousPublicEnvelope, type SsrPublicDescriptor, type SsrPublicEnvelope } from './ssr-public-reader';

const prefix = '/internal/public-catalog';
const publicRoute = /^\/api\/v1\/(?:vehicles(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})?|vehicle-filters|home\/vehicles)$/;

/** A fixed allowlist, never a general reverse proxy or a private media/admin reader. */
export function internalCatalogPath(publicPath: string) {
  const parsed = new URL(publicPath, 'http://public-path.invalid');
  if (!publicPath.startsWith('/api/v1/') || parsed.origin !== 'http://public-path.invalid' || parsed.hash || !publicRoute.test(parsed.pathname))
    throw new PublicApiError(503);
  return `${prefix}${parsed.pathname.slice('/api/v1'.length)}${parsed.search}`;
}

async function requestInternal(path: string, visitorHeaders?: Record<string, string>) {
  try {
    const origin = publicApiOrigin();
    const target = new URL(path, origin);
    if (target.origin !== origin || !target.pathname.startsWith(`${prefix}/`)) throw new PublicApiError(503);
    const response = await fetch(target.href, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/json', 'Cache-Control': 'no-store', 'X-HD-SSR-Key': getSsrServiceSecret(),
        ...(visitorHeaders?.['X-Forwarded-For'] ? { 'X-Forwarded-For': visitorHeaders['X-Forwarded-For'] } : {}),
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

/** Caller resolves its trusted visitor IP before entering the shared cache. */
export async function readSsrServiceVersion(priceView: PublicCatalogCacheStamp['priceView'], visitorHeaders: Record<string, string>) {
  try {
    const response = await requestInternal(`${prefix}/version${priceView === 'usd' ? '?priceView=usd' : ''}`, visitorHeaders);
    return await readPublicJsonBody(response, PublicCatalogVersionResponseSchema, 16_384);
  } catch (error) {
    // A missing control endpoint/credential is an outage, never a missing vehicle.
    if (error instanceof PublicApiError && error.status === 429) throw error;
    throw new PublicApiError(503);
  }
}

/** Static service identity only. No Next headers, visitor IP, cookie or caller trace enters this loader. */
export async function readAnonymousPublicResource<T extends SsrPublicEnvelope>(descriptor: SsrPublicDescriptor<T>) {
  try {
    const response = await requestInternal(internalCatalogPath(descriptor.path));
    const parsed = await readPublicJsonBody(response, descriptor.schema);
    return anonymousPublicEnvelope(parsed);
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError(503);
  }
}
