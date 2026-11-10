import { afterEach, expect, it, vi } from 'vitest';
import { makeImportedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { proxyExternalPhotoFailure } from './public-media-report';

const id = makeImportedPublicVehicleFixture('en').images[0]!.id;
const origin = 'https://cars.test';
const path = `/api/v1/external-media/${id}/failure`;
const request = (body: string, originHeader = origin, suffix = '') => new Request(`${origin}${path}/${suffix}`, {
  method: 'POST',
  headers: { Origin: originHeader, 'Content-Type': 'application/json', Cookie: 'private', Authorization: 'private' },
  body,
});
afterEach(() => vi.unstubAllGlobals());

it('forwards only the validated media ID and revision to the fixed upstream endpoint', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { queued: true }, meta: { requestId: 'test' } }));
  vi.stubGlobal('fetch', fetcher);
  const response = await proxyExternalPhotoFailure(request('{"revision":1}'), id);
  expect(response.status).toBe(202);
  expect((await response.json()).data).toEqual({ queued: true });
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe(path);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST', body: '{"revision":1}', redirect: 'error', cache: 'no-store',
    headers: { Accept: 'application/json, image/*;q=0.9', 'Content-Type': 'application/json' },
  });
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Cookie');
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
});

it('rejects cross-site, malformed and oversized signals without reaching the API', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const [input, imageId, status] of [
    [request('{"revision":1}', 'https://other.test'), id, 403],
    [request('{"revision":1}'), '../admin', 404],
    [request('{"revision":1,"url":"https://untrusted.test"}'), id, 400],
    [request('{"revision":0}'), id, 400],
    [request(' '.repeat(256) + '{"revision":1}'), id, 400],
    [request('{"revision":1}', origin, '?url=https://untrusted.test'), id, 400],
  ] as const) expect((await proxyExternalPhotoFailure(input, imageId)).status).toBe(status);
  const brokenBody = new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.error(new Error('Truncated upload')); } }),
  } as RequestInit & { duplex: 'half' });
  expect((await proxyExternalPhotoFailure(brokenBody, id)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});


it('accepts Next standalone loopback aliases on the same port while rejecting another port', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { queued: false }, meta: { requestId: 'test' } }));
  vi.stubGlobal('fetch', fetcher);
  const local = (port: number) => new Request(`http://localhost:3100${path}`, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    body: '{"revision":1}',
  });
  expect((await proxyExternalPhotoFailure(local(3100), id)).status).toBe(202);
  expect((await proxyExternalPhotoFailure(local(3101), id)).status).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
