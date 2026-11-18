import { getPublicHtmlCacheVersions, PublicApiError } from '@/modules/vehicles/server';
import { getServerReleaseIdentity } from '@/shared/config/server-runtime';
import { publicHtmlCacheRequest, publicHtmlCacheStatus } from '@/shared/lib/public-html-cache-control';

export async function GET(request: Request) {
  const identity = publicHtmlCacheRequest(request);
  const query = new URL(request.url).searchParams;
  if (!identity || query.size !== 1 || !/^(?:zh|en|ru)$/.test(query.get('locale') ?? ''))
    return publicHtmlCacheStatus(404);
  try {
    const release = getServerReleaseIdentity().releaseId;
    const data = await getPublicHtmlCacheVersions(identity.visitor, request.signal);
    return Response.json({ release, nonce: identity.nonce, data }, {
      headers: { 'Cache-Control': 'no-store', 'X-HD-Cache-Protocol': '2' },
    });
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 429)
      return publicHtmlCacheStatus(429, error.retryAfter);
    return publicHtmlCacheStatus(503);
  }
}
