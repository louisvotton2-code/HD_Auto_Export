import { getServerReleaseIdentity } from '@/shared/config/server-runtime';
import { publicHtmlCacheRequest, publicHtmlCacheStatus } from '@/shared/lib/public-html-cache-control';
import { capturePublicHtmlRender, publicHtmlRenderTicketHeader } from '@/shared/lib/public-html-render-proof';

export async function GET(request: Request) {
  const identity = publicHtmlCacheRequest(request);
  const target = request.headers.get('x-hd-render-target');
  if (!identity || !target || !/^\/(?:zh|en|ru)\/$/.test(target) || new URL(request.url).search)
    return publicHtmlCacheStatus(404);
  const port = process.env.PORT ?? '3000';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    return publicHtmlCacheStatus(503);

  try {
    const release = getServerReleaseIdentity().releaseId;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
    const { response, proof } = await capturePublicHtmlRender((ticket) =>
      fetch(`http://127.0.0.1:${port}${target}`, {
        headers: {
          Accept: 'text/html',
          'Accept-Encoding': 'identity',
          'X-HD-Visitor-IP': identity.visitor,
          ...(ticket ? { [publicHtmlRenderTicketHeader]: ticket } : {}),
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        signal,
      }),
    );
    const headers = new Headers(response.headers);
    for (const name of [...headers.keys()]) {
      if (/^x-hd-|^(?:connection|content-encoding|content-length|keep-alive|trailer|transfer-encoding)$/i.test(name))
        headers.delete(name);
    }
    headers.set('Cache-Control', 'no-store');
    headers.set('X-HD-Cache-Protocol', '2');
    if (proof) {
      const encoded = Buffer.from(JSON.stringify({ release, nonce: identity.nonce, ...proof })).toString('base64url');
      if (encoded.length <= 8192) headers.set('X-HD-HTML-Proof', encoded);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return publicHtmlCacheStatus(503);
  }
}
