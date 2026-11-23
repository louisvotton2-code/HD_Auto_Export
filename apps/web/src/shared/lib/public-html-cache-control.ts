import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { readPrivateServiceSecret } from '@/shared/config/ssr-service-secret';

const privateHeaders = [
  'cookie', 'authorization', 'proxy-authorization', 'rsc', 'next-router-state-tree',
  'next-router-prefetch', 'next-router-segment-prefetch', 'next-url', 'purpose', 'sec-purpose',
  'range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'if-range',
  'x-hd-public-html-render-ticket',
];

let key: Buffer | undefined;
function serviceKey() {
  if (key) return key;
  const value = readPrivateServiceSecret(process.env.HD_HTML_CACHE_SECRET_FILE);
  if (value) key = Buffer.from(value);
  return key;
}

export function publicHtmlCacheRequest(request: Request) {
  const { headers } = request;
  const protocol = headers.get('x-hd-cache-protocol');
  if (
    request.method !== 'GET' || (protocol !== '2' && protocol !== '3')
    || process.env.VEHICLE_API_TRUST_PROXY_IP !== 'true' || privateHeaders.some(name => headers.has(name))
  ) return null;
  const provided = headers.get('x-hd-html-key');
  const nonce = headers.get('x-hd-html-nonce');
  const visitor = headers.get('x-hd-visitor-ip');
  if (!provided || !/^[\x21-\x7e]{32,256}$/.test(provided) || !nonce || !/^[a-f0-9]{32}$/.test(nonce)
    || !visitor || visitor.includes('%') || !isIP(visitor))
    return null;
  const expected = serviceKey();
  const candidate = Buffer.from(provided);
  if (!expected || expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) return null;
  return { nonce, visitor, protocol: protocol === '2' ? 2 as const : 3 as const };
}

export function publicHtmlCacheStatus(status: 404 | 429 | 503, retryAfter?: string) {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) },
  });
}
