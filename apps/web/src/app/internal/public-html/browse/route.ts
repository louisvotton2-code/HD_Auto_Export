import { catalogQueryKeys, parseCatalogPageRequest } from '@/modules/vehicles';
import { isPublicApiError, readSsrBrowseGeneration } from '@/modules/vehicles/server';
import { readPublicBrowseFence } from '@/shared/config/public-browse-fence';
import { getServerReleaseIdentity } from '@/shared/config/server-runtime';
import { publicBrowseRenderRequest, publicHtmlCacheStatus } from '@/shared/lib/public-html-cache-control';
import { capturePublicBrowseRender, publicHtmlRenderTicketHeader } from '@/shared/lib/public-html-render-proof';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';

function validTarget(target: string) {
  if (!/^[\x21-\x7e]{1,1800}$/.test(target) || target.includes('#')) return false;
  const match = /^\/([^/?]+)\/(?:cars\/(\?[^#]+)?)?$/.exec(target);
  const locale = match?.[1];
  if (!hasLocale(routing.locales, locale)) return false;
  if (target === `/${locale}/`) return true;
  const search = match?.[2];
  const query = new URLSearchParams(search);
  if (search) {
    const fields = search.slice(1).split('&');
    if (fields.slice().sort().join('&') !== fields.join('&') || new Set(query.keys()).size !== fields.length) return false;
    for (const field of fields) {
      const equals = field.indexOf('=');
      if (equals < 1 || !catalogQueryKeys.includes(field.slice(0, equals))) return false;
      try { decodeURIComponent(field.slice(equals + 1)); } catch { return false; }
    }
  }
  const request = parseCatalogPageRequest(Object.fromEntries(query), locale);
  return request?.kind === 'query';
}

export async function GET(request: Request) {
  const identity = publicBrowseRenderRequest(request);
  const target = request.headers.get('x-hd-render-target');
  const generation = request.headers.get('x-hd-browse-generation');
  if (!identity || !target || !validTarget(target) || !generation || generation !== readPublicBrowseFence() || new URL(request.url).search)
    return publicHtmlCacheStatus(404);
  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return publicHtmlCacheStatus(503);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(7500)]);
    const { response, proof, retryAfter } = await capturePublicBrowseRender(ticket => fetch(`http://127.0.0.1:${port}${target}`, {
      headers: {
        Accept: 'text/html', 'Accept-Encoding': 'identity', 'X-HD-Visitor-IP': identity.visitor,
        ...(ticket ? { [publicHtmlRenderTicketHeader]: ticket } : {}),
      },
      cache: 'no-store', credentials: 'omit', redirect: 'manual', signal,
    }));
    if (retryAfter || response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      return publicHtmlCacheStatus(429, retryAfter ? String(retryAfter) : response.headers.get('retry-after') ?? '60');
    }
    const headers = new Headers(response.headers);
    for (const name of [...headers.keys()]) {
      if (/^x-hd-|^(?:connection|content-encoding|content-length|keep-alive|trailer|transfer-encoding)$/i.test(name))
        headers.delete(name);
    }
    headers.set('Cache-Control', 'no-store');
    if (!proof || generation !== readPublicBrowseFence() ||
        proof.generation !== await readSsrBrowseGeneration({ 'X-Forwarded-For': identity.visitor }, signal) ||
        generation !== readPublicBrowseFence() || proof.expiresAt <= Date.now()) {
      await response.body?.cancel().catch(() => undefined);
      return publicHtmlCacheStatus(503);
    }
    headers.set('X-HD-Cache-Protocol', '4');
    headers.set('X-HD-HTML-Proof', Buffer.from(JSON.stringify({
      healthy: true, release: getServerReleaseIdentity().releaseId, nonce: identity.nonce,
      target, generation, observedAt: proof.observedAt, expiresAt: proof.expiresAt,
    })).toString('base64url'));
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (isPublicApiError(error) && error.status === 429) return publicHtmlCacheStatus(429, error.retryAfter);
    return publicHtmlCacheStatus(503);
  }
}
