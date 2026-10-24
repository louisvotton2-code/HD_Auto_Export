export const MAX_CALCULATION_REQUEST_BYTES = 10_000;

type BodyResult = { ok: true; text: string } | { ok: false; status: 400 | 413; error: string };

/** Bound streamed bytes before accumulating or parsing a public API request. */
export async function readCalculationBody(request: Request): Promise<BodyResult> {
  const tooLarge = { ok: false, status: 413, error: 'request_too_large' } as const;
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_CALCULATION_REQUEST_BYTES
  )
    return tooLarge;
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_CALCULATION_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return tooLarge;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return { ok: true, text: text + decoder.decode() };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, status: 400, error: 'invalid_request' };
  } finally {
    reader.releaseLock();
  }
}
