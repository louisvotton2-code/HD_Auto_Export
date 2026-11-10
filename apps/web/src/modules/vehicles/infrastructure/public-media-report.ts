import {
  ExternalMediaFailureRequestSchema,
  ExternalMediaFailureResponseSchema,
  ExternalMediaIdSchema,
} from '@hd/contracts/public';
import { siteConfig } from '@/shared/config/site';
import { PublicApiError, readPublicJson } from './public-api';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

async function readRevision(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256) return null;
      raw += decoder.decode(value, { stream: true });
    }
    const parsed = ExternalMediaFailureRequestSchema.safeParse(JSON.parse(raw + decoder.decode()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function matchesOrigin(origin: string | null, url: URL) {
  if (origin === url.origin || origin === siteConfig.origin) return true;
  // Next's standalone adapter can rewrite a loopback listener to localhost.
  const candidate = origin ? URL.parse(origin) : null;
  const loopback = ['127.0.0.1', 'localhost'];
  if (!candidate || candidate.origin !== origin) return false;
  return (
    candidate.protocol === 'http:' &&
    url.protocol === 'http:' &&
    candidate.port === url.port &&
    loopback.includes(candidate.hostname) &&
    loopback.includes(url.hostname)
  );
}

export async function proxyExternalPhotoFailure(request: Request, id: string) {
  if (!ExternalMediaIdSchema.safeParse(id).success) return new Response(null, { status: 404, headers });
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!matchesOrigin(origin, url) || (fetchSite && fetchSite !== 'same-origin')) {
    return new Response(null, { status: 403, headers });
  }
  if (url.search || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return new Response(null, { status: 400, headers });
  }
  const revision = await readRevision(request);
  if (!revision) return new Response(null, { status: 400, headers });
  try {
    const value = await readPublicJson(
      `/api/v1/external-media/${id}/failure`,
      ExternalMediaFailureResponseSchema,
      request.headers,
      JSON.stringify(revision),
    );
    return Response.json(value, { status: 202, headers });
  } catch (error) {
    return new Response(null, {
      status: error instanceof PublicApiError ? error.status : 503,
      headers: error instanceof PublicApiError && error.retryAfter
        ? { ...headers, 'Retry-After': error.retryAfter }
        : headers,
    });
  }
}
