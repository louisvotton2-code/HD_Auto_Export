import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, request, signIn } from './client';

afterEach(() => vi.unstubAllGlobals());
const schema = { parse: (value: unknown) => value };
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"user":{"id":"test"}}')));
    await expect(signIn('staff@example.invalid', 'synthetic')).resolves.toBeUndefined();
  });
  it('rejects third party URLs before sending cookies', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(request('https://other.example/api/test', schema)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
