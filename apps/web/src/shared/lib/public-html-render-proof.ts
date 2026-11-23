import {
  INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS,
  INTERNAL_PUBLIC_HOMEPAGE_CACHE_MAX_TTL_MS,
} from '@hd/contracts/public';

const maxLifetimeMs = {
  2: INTERNAL_PUBLIC_CATALOG_CACHE_MAX_TTL_MS,
  3: INTERNAL_PUBLIC_HOMEPAGE_CACHE_MAX_TTL_MS,
};
const maxDocumentBytes = 512 * 1024;
const maxPendingRenders = 4;

export const publicHtmlRenderTicketHeader = 'x-hd-public-html-render-ticket';

export type PublicHtmlCacheProtocol = 2 | 3;
export type PublicHtmlCacheScope = 'catalog' | 'filters';
export type PublicHtmlCacheStamp = Readonly<{
  version: string;
  priceView: 'usd';
  fx: Readonly<{ version: string; expiresAt: string }> | null;
  checkedAt: string;
  validUntil: string;
}>;
export type PublicHtmlCacheData = Readonly<Record<PublicHtmlCacheScope, PublicHtmlCacheStamp>>;
export type PublicHtmlRenderProof = { healthy: true; data: PublicHtmlCacheData };
type PendingRender = {
  observed: Partial<Record<PublicHtmlCacheScope, PublicHtmlCacheStamp>>;
  protocol: PublicHtmlCacheProtocol;
  now: () => number;
  complete: boolean;
  failed: boolean;
};

// A loopback render is a separate HTTP request and may run in another Next route bundle.
const pendingSymbol = Symbol.for('hd-auto.public-html-render-proof.v1');
const processState = globalThis as typeof globalThis & { [pendingSymbol]?: Map<string, PendingRender> };
function pendingRenders() { return processState[pendingSymbol] ??= new Map(); }

function timestamp(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
    ? Date.parse(value) : NaN;
}

export function parsePublicHtmlCacheStamp(
  value: unknown, now = Date.now(), protocol: PublicHtmlCacheProtocol = 2,
): PublicHtmlCacheStamp | null {
  if (!value || typeof value !== 'object') return null;
  const { version, priceView, fx, checkedAt, validUntil } = value as Partial<PublicHtmlCacheStamp>;
  const checked = timestamp(checkedAt);
  const deadline = timestamp(validUntil);
  if (
    typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || priceView !== 'usd'
    || !(checked <= now + 5_000 && deadline > Math.max(checked, now) && deadline - checked <= maxLifetimeMs[protocol])
  ) return null;
  if (fx === null) {
    return { version, priceView, fx, checkedAt: new Date(checked).toISOString(), validUntil: new Date(deadline).toISOString() };
  }
  if (
    !fx || typeof fx.version !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(fx.version)
    || !(timestamp(fx.expiresAt) >= deadline)
  ) return null;
  return {
    version, priceView, fx: { version: fx.version, expiresAt: new Date(timestamp(fx.expiresAt)).toISOString() },
    checkedAt: new Date(checked).toISOString(), validUntil: new Date(deadline).toISOString(),
  };
}

function sameFx(left: PublicHtmlCacheStamp, right: PublicHtmlCacheStamp) {
  return left.fx?.version === right.fx?.version && left.fx?.expiresAt === right.fx?.expiresAt;
}

export function matchPublicHtmlCacheScopes(
  catalog: PublicHtmlCacheStamp, filters: PublicHtmlCacheStamp,
): PublicHtmlCacheData | null {
  const validUntil = catalog.validUntil < filters.validUntil ? catalog.validUntil : filters.validUntil;
  if (!sameFx(catalog, filters) || validUntil <= catalog.checkedAt || validUntil <= filters.checkedAt)
    return null;
  return { catalog: { ...catalog, validUntil }, filters: { ...filters, validUntil } };
}

export function publicHtmlRenderProtocol(ticket: string | null): PublicHtmlCacheProtocol | undefined {
  return ticket ? pendingRenders().get(ticket)?.protocol : undefined;
}

/** Copy only the actual version and deadline accepted for a rendered dependency. */
export function recordPublicHtmlRenderStamp(
  ticket: string | null, scope: PublicHtmlCacheScope, value: unknown, acceptedDeadline?: number,
  protocol: PublicHtmlCacheProtocol = 2,
) {
  const render = ticket ? pendingRenders().get(ticket) : undefined;
  if (!render || render.failed) return;
  const now = render.now();
  const actual = protocol === render.protocol ? parsePublicHtmlCacheStamp(value, now, protocol) : null;
  const previous = render.observed[scope];
  const deadline = Math.min(Date.parse(actual?.validUntil ?? ''), acceptedDeadline ?? Infinity);
  if (
    !actual || !(deadline > Math.max(now, Date.parse(actual.checkedAt)))
    || (previous && (previous.version !== actual.version || !sameFx(previous, actual)))
  ) {
    render.failed = true;
    return;
  }
  const validUntil = new Date(deadline).toISOString();
  if (!previous || validUntil < previous.validUntil) render.observed[scope] = { ...actual, validUntil };
}

export function invalidatePublicHtmlRender(ticket: string | null) {
  const render = ticket ? pendingRenders().get(ticket) : undefined;
  if (render) render.failed = true;
}

/** A page can confirm its required data rendered successfully, but cannot issue proof. */
export function markPublicHtmlRenderComplete(ticket: string | null) {
  const render = ticket ? pendingRenders().get(ticket) : undefined;
  if (render) render.complete = true;
}

function withBody(response: Response, body: BodyInit) {
  const headers = new Headers(response.headers);
  for (const name of ['connection', 'content-length', 'keep-alive', 'trailer', 'transfer-encoding']) {
    headers.delete(name);
  }
  return new Response(body, { headers, status: response.status, statusText: response.statusText });
}

async function captureDocument(response: Response, body: ReadableStream<Uint8Array>, release: () => void) {
  const reader = body.getReader();
  const bytes = new Uint8Array(maxDocumentBytes);
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxDocumentBytes) {
      // Send the buffered prefix and continue the existing response without requesting a second render.
      const prefix = size > 0 ? [bytes.subarray(0, size), value] : [value];
      return {
        response: withBody(response, new ReadableStream<Uint8Array>({
          async pull(controller) {
            const buffered = prefix.shift();
            if (buffered) {
              controller.enqueue(buffered);
              if (!prefix.length) release();
              return;
            }
            const remainder = await reader.read();
            if (remainder.done) controller.close();
            else controller.enqueue(remainder.value);
          },
          cancel(reason) {
            prefix.length = 0;
            release();
            return reader.cancel(reason);
          },
        }, { highWaterMark: 0 })),
        complete: false,
        replaying: true,
      };
    }
    bytes.set(value, size);
    size += value.byteLength;
  }
  const contentLength = response.headers.get('content-length');
  return {
    response: withBody(response, bytes.subarray(0, size)),
    complete: size > 0 && (contentLength === null || Number(contentLength) === size),
    replaying: false,
  };
}

/**
 * Called only by the trusted anonymous document boundary. A clean EOF, a successful
 * page outcome and both consistent actual data scopes are required. The gateway
 * compares the resulting proof against its separately obtained live versions.
 */
export async function capturePublicHtmlRender(
  render: (ticket: string | null) => Promise<Response>,
  { now = Date.now, protocol = 2 }: { now?: () => number; protocol?: PublicHtmlCacheProtocol } = {},
): Promise<{ response: Response; proof: PublicHtmlRenderProof | null }> {
  const pending = pendingRenders();
  if (pending.size >= maxPendingRenders)
    return { response: await render(null), proof: null };

  const ticket = crypto.randomUUID();
  const record: PendingRender = {
    observed: {},
    protocol,
    now,
    complete: false,
    failed: false,
  };
  pending.set(ticket, record);
  const release = () => { pending.delete(ticket); };
  let replaying = false;
  try {
    const response = await render(ticket);
    const encoding = response.headers.get('content-encoding');
    if (
      response.status !== 200 || !response.body || response.headers.has('set-cookie')
      || !/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      || (encoding !== null && encoding.toLowerCase() !== 'identity')
      || Number(response.headers.get('content-length')) > maxDocumentBytes
    ) return { response, proof: null };

    const captured = await captureDocument(response, response.body, release);
    replaying = captured.replaying;
    const { catalog, filters } = record.observed;
    if (!captured.complete || !record.complete || record.failed || !catalog || !filters)
      return { response: captured.response, proof: null };
    const data = matchPublicHtmlCacheScopes(catalog, filters);
    const proof = data && Date.parse(data.catalog.validUntil) > now() ? { healthy: true as const, data } : null;
    return { response: captured.response, proof };
  } finally {
    if (!replaying) release();
  }
}
