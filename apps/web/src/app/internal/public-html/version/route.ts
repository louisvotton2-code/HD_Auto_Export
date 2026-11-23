import { getPublicHtmlCacheVersions, PublicApiError } from '@/modules/vehicles/server';
import { getServerReleaseIdentity } from '@/shared/config/server-runtime';
import { publicHtmlCacheRequest, publicHtmlCacheStatus } from '@/shared/lib/public-html-cache-control';

export async function GET(request: Request) {
  const identity = publicHtmlCacheRequest(request);
  const query = new URL(request.url).searchParams;
  const locale = query.get('locale');
  if (!identity || query.size !== 1 || (locale !== 'zh' && locale !== 'en' && locale !== 'ru'))
    return publicHtmlCacheStatus(404);
  try {
    const release = getServerReleaseIdentity().releaseId;
    const data = await getPublicHtmlCacheVersions(identity.visitor, request.signal, locale, identity.protocol);
    return Response.json({ release, nonce: identity.nonce, data }, {
      headers: { 'Cache-Control': 'no-store', 'X-HD-Cache-Protocol': String(identity.protocol) },
    });
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 429)
      return publicHtmlCacheStatus(429, error.retryAfter);
    return publicHtmlCacheStatus(503);
  }
}
