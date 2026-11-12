import { z } from 'zod';

export type ProviderProbeState = 'not_configured' | 'ok' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'unavailable' | 'invalid_response';
export type ProviderProbeResult = {
  state: ProviderProbeState;
  checkedAt: string | null;
  plan: string | null;
  expiresAt: string | null;
  sources: string[];
  dailyLimit: number | null;
  remainingToday: number | null;
};
export type ProviderProbe = () => Promise<ProviderProbeResult>;
export type ProviderProbeDependencies = {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  monotonicNow?: () => number;
  timeoutMs?: number;
  ttlMs?: number;
};

// The supplied audit archive's analysis/openapi_latest.json documents this one
// account endpoint and x-api-key header. Never accept an endpoint from HTTP input.
const endpoint = 'https://api.chinacarapi.com/api/me';
const maxResponseBytes = 16 * 1024;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const accountSchema = z.object({
  product: z.enum(['chinacarapi', 'encarapi-addon']),
  plan: z.enum(['sandbox', 'trial', 'starter', 'business', 'scale', 'internal']),
  sources: z.array(z.enum(['dongchedi', 'che168'])).max(2).refine(values => new Set(values).size === values.length),
  expiresAt: z.iso.datetime({ offset: true }).max(64).nullable().optional(),
  dailyLimit: count.nullable().optional(),
  remainingToday: count.nullable().optional(),
});

const emptyResult = (state: ProviderProbeState, checkedAt: string | null): ProviderProbeResult => ({
  state, checkedAt, plan: null, expiresAt: null, sources: [], dailyLimit: null, remainingToday: null,
});
const copyResult = (result: ProviderProbeResult): ProviderProbeResult => ({ ...result, sources: [...result.sources] });
class InvalidResponse extends Error {}

function discard(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}

async function readAccountJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  const length = response.headers.get('content-length');
  if (!contentType || !/^application\/json(?:\s*;|\s*$)/i.test(contentType) || !response.body ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes))) {
    discard(response);
    throw new InvalidResponse();
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxResponseBytes) {
        cancel();
        throw new InvalidResponse();
      }
      chunks.push(next.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as unknown; }
    catch { throw new InvalidResponse(); }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Optional, read-only account check. This never fetches listings or reports,
 * retries requests, reads credential files, or exposes provider bodies/errors.
 * Cache lifetime uses a monotonic clock; checkedAt is the actual completed check.
 */
export function createProviderProbe(apiKey?: string, deps: ProviderProbeDependencies = {}): ProviderProbe {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const monotonicNow = deps.monotonicNow ?? (() => performance.now());
  const timeoutMs = deps.timeoutMs ?? 5_000;
  const ttlMs = deps.ttlMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error('Invalid provider probe timing.');
  }
  const key = apiKey?.trim();
  let cached: { result: ProviderProbeResult; expiresAt: number } | undefined;
  let inFlight: Promise<ProviderProbeResult> | undefined;

  async function check(): Promise<ProviderProbeResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Provider probe timeout.')); }, timeoutMs);
    });
    async function request(): Promise<ProviderProbeResult> {
      const response = await fetcher(endpoint, {
        method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { Accept: 'application/json', 'x-api-key': key! },
      });
      if (controller.signal.aborted) { discard(response); controller.signal.throwIfAborted(); }
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        discard(response);
        return emptyResult('unavailable', null);
      }
      if (!response.ok) {
        discard(response);
        const state = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' :
          response.status === 429 ? 'rate_limited' : 'unavailable';
        return emptyResult(state, null);
      }
      if (response.status !== 200) { discard(response); return emptyResult('invalid_response', null); }
      const parsed = accountSchema.safeParse(await readAccountJson(response, controller.signal));
      if (!parsed.success) return emptyResult('invalid_response', null);
      const account = parsed.data;
      return {
        state: 'ok', checkedAt: null, plan: account.plan,
        expiresAt: account.expiresAt ? new Date(account.expiresAt).toISOString() : null,
        sources: account.sources, dailyLimit: account.dailyLimit ?? null, remainingToday: account.remainingToday ?? null,
      };
    }
    let result: ProviderProbeResult;
    try { result = await Promise.race([request(), deadline]); }
    catch (error) { result = emptyResult(error instanceof InvalidResponse ? 'invalid_response' : 'unavailable', null); }
    finally { clearTimeout(timer!); controller.abort(); }
    result.checkedAt = now().toISOString();
    return result;
  }

  return async () => {
    if (!key) return emptyResult('not_configured', null);
    if (cached && monotonicNow() < cached.expiresAt) return copyResult(cached.result);
    if (!inFlight) {
      inFlight = check().then(result => {
        cached = { result, expiresAt: monotonicNow() + ttlMs };
        return result;
      }).finally(() => { inFlight = undefined; });
    }
    return copyResult(await inFlight);
  };
}
