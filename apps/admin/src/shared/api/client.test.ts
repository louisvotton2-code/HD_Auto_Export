import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, request, requestWithTimeout, signIn } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const schema = { parse: (value: unknown) => value };

function fetchUntilAborted() {
  const fetcher = vi.fn((_path: string, { signal }: RequestInit) => new Promise<never>((_resolve, reject) => {
    if (!signal) throw new Error('Expected an abort signal');
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('staff HTTP boundary', () => {
  it('uses same-origin cookies and no-store; retains the idempotency key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"data":{}}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await request('/api/v1/admin/vehicles', schema, { method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'attempt-123' } });
    const [, options] = fetcher.mock.calls[0];
    expect(options.credentials).toBe('same-origin'); expect(options.cache).toBe('no-store');
    expect(options.headers.get('Idempotency-Key')).toBe('attempt-123');
    expect(options.headers.get('Content-Type')).toBe('application/json');
  });
  it('returns translated errors and field paths without leaking server text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',message:'private database details',fields:[{path:'draft.price',code:'invalid',message:'bad price'}],retryable:false},meta:{requestId:'test-request'}}), {status:409})));
    const failure = await request('/api/v1/admin/vehicles/example', schema).catch(error => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    if (!(failure instanceof ApiClientError)) throw new Error('Expected ApiClientError');
    expect(failure.status).toBe(409);
    expect(failure.message).not.toContain('private'); expect(failure.fields[0].path).toBe('draft.price');
    expect(failure.requestId).toBe('test-request');
  });
  it('does not retry uncertain writes or rate limits', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetcher);
    await expect(request('/api/v1/admin/vehicles', schema, {method:'POST',body:'{}'})).rejects.toMatchObject({code:'NETWORK_ERROR'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response('{}', {status:429}));
    await expect(request('/api/v1/admin/vehicles', schema)).rejects.toMatchObject({code:'RATE_LIMITED'});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects incompatible success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(request('/api/v1/admin/me', {parse(){ throw new Error('schema'); }})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('supports native auth envelopes without a business data wrapper', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"user":{"id":"test"}}'));
    vi.stubGlobal('fetch', fetcher);
    await expect(signIn(' Staff@Example.invalid ', 'synthetic')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith('/api/auth/sign-in/email', expect.objectContaining({
      body: JSON.stringify({ email: 'staff@example.invalid', password: 'synthetic' }),
    }));
  });
  it('maps short staff names to the internal email namespace', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await signIn(' Staff-Editor ', 'synthetic');
    expect(fetcher).toHaveBeenCalledWith('/api/auth/sign-in/email', expect.objectContaining({
      body: JSON.stringify({ email: 'staff-editor@staff.hd-auto.invalid', password: 'synthetic' }),
    }));
  });
  it('rejects third party URLs before sending cookies', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(request('https://other.example/api/test', schema)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('staff request timeout', () => {
  it('reports a timed-out write without retrying it', async () => {
    vi.useFakeTimers();
    const fetcher = fetchUntilAborted();
    const result = requestWithTimeout('/api/v1/admin/vehicles/example/configuration-import', schema, 25, { method: 'PUT' });
    const rejected = expect(result).rejects.toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards caller cancellation and releases the timer and listener', async () => {
    vi.useFakeTimers();
    fetchUntilAborted();
    const parent = new AbortController();
    const release = vi.spyOn(parent.signal, 'removeEventListener');
    const result = requestWithTimeout('/api/v1/admin/vehicles/example/translation-bundle', schema, 20_000, { signal: parent.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    parent.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(release).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
