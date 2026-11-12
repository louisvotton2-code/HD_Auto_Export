/** Shared HTTP primitives. No visitor headers, framework request context or caching. */
const apiErrorIdentity = Symbol.for('hd-auto.public-api-error.v1');
export class PublicApiError extends Error {
  readonly [apiErrorIdentity] = true;
  constructor(readonly status: number, readonly retryAfter?: string) {
    super('Public vehicle service unavailable');
  }
}

/** Shared in-flight reads may cross Next route bundles with different class constructors. */
export function isPublicApiError(value: unknown): value is PublicApiError {
  return value !== null && typeof value === 'object' && Reflect.get(value, apiErrorIdentity) === true
    && Number.isInteger(Reflect.get(value, 'status')) && Reflect.get(value, 'status') >= 400 && Reflect.get(value, 'status') <= 599
    && (Reflect.get(value, 'retryAfter') === undefined || typeof Reflect.get(value, 'retryAfter') === 'string');
}

export function publicApiOrigin() {
  const url = new URL(process.env.VEHICLE_API_BASE_URL || 'http://127.0.0.1:3320');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new PublicApiError(503);
  return url.origin;
}

export async function readPublicJsonBody<T>(response: Response, schema: { parse: (value: unknown) => T }, maxBytes = 8_000_000): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new PublicApiError(503);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PublicApiError(503);
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new PublicApiError(503);
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return schema.parse(JSON.parse(new TextDecoder().decode(bytes))); }
  catch { throw new PublicApiError(503); }
}
