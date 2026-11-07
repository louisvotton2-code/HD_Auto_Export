import { describe, expect, it } from 'vitest';
import { handleCalculationRequest } from './handler';
import { MAX_CALCULATION_REQUEST_BYTES, readCalculationBody } from './request-body';

function streamRequest(chunks: Uint8Array[], headers?: HeadersInit, cancel?: () => void) {
  return new Request('http://localhost/api/v1/calculations', {
    method: 'POST',
    headers,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
      cancel,
    }),
    duplex: 'half',
  } as RequestInit);
}

describe('bounded public calculation requests', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('accepts an exact byte limit and multibyte characters split between chunks', async () => {
    const bytes = encode('中'.repeat(3333) + 'a');
    expect(bytes.byteLength).toBe(MAX_CALCULATION_REQUEST_BYTES);
    expect(await readCalculationBody(streamRequest([bytes.slice(0, 1), bytes.slice(1)]))).toEqual({
      ok: true,
      text: '中'.repeat(3333) + 'a',
    });
  });

  it('limits bytes rather than JavaScript character count without Content-Length', async () => {
    expect(await readCalculationBody(streamRequest([encode('中'.repeat(3334))]))).toEqual({
      ok: false,
      status: 413,
      error: 'request_too_large',
    });
  });

  it('a misleading small Content-Length cannot bypass the streamed limit', async () => {
    expect(
      await readCalculationBody(
        streamRequest([encode('a'.repeat(6000)), encode('a'.repeat(4001))], {
          'content-length': '1',
        }),
      ),
    ).toEqual({ ok: false, status: 413, error: 'request_too_large' });
  });

  it('rejects an oversized declared body without pulling it', async () => {
    let read = false;
    const request = {
      headers: new Headers({ 'content-length': '10001' }),
      get body() {
        read = true;
        throw new Error('must not read');
      },
    } as unknown as Request;
    expect(await readCalculationBody(request)).toEqual({
      ok: false,
      status: 413,
      error: 'request_too_large',
    });
    expect(read).toBe(false);
  });

  it('returns a controlled error for invalid UTF-8 or a failed stream', async () => {
    expect(await readCalculationBody(streamRequest([new Uint8Array([0xff])]))).toMatchObject({
      ok: false,
      status: 400,
      error: 'invalid_request',
    });
    const request = new Request('http://localhost/', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error('disconnected'));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(await readCalculationBody(request)).toMatchObject({ ok: false, status: 400 });
  });

  it('API errors retain no-store and reference-only headers', async () => {
    for (const body of ['{bad', 'null', '中'.repeat(3334)]) {
      const response = await handleCalculationRequest(
        new Request('http://localhost/', { method: 'POST', body }),
      );
      expect([400, 413]).toContain(response.status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-calculation-mode')).toBe('reference-only');
    }
  });
});
