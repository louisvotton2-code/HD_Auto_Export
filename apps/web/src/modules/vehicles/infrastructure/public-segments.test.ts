import { afterEach, expect, it, vi } from 'vitest';
import { makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { ApiErrorSchema, type DisplayText, type PublicVehicleInspectionResponse } from '@hd/contracts/public';
import { proxyPublicRequest } from './public-proxy';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const vehicle = makePublicVehicleFixture();
const payload = { data: { vehicleId: vehicle.id, locale: 'ru', revision: 'a'.repeat(64), total: 1, items: vehicle.images.slice(0, 1), nextCursor: null }, meta: { requestId: 'upstream' } };
const inspectionField = (text: string): DisplayText => ({
  status: 'ready', text, requestedLocale: 'zh', contentLocale: 'en', provenance: 'supplier', reviewed: false,
});
const inspectionPayload = (): PublicVehicleInspectionResponse => ({ data: {
  vehicleId: vehicle.id, locale: 'zh', revision: 'b'.repeat(64), status: 'available', total: 1, nextCursor: null,
  summary: { status: 'available', contentLocale: 'en', checked: 0, faults: null,
    categories: [{ id: 'accident', label: inspectionField('Accident inspection'), checked: 0, faults: null, outcome: 'unknown' }] },
  conclusions: [{ id: 'stored-conclusion', name: inspectionField('Recorded conclusion'), value: inspectionField('No conclusion supplied') }],
  items: [{ id: 'stored-item', categoryId: 'accident', partId: 'body', groupId: 'body', kind: 'summary',
    category: inspectionField('Accident inspection'), part: inspectionField('Body'), group: inspectionField('Stored checks'),
    name: inspectionField('Structural inspection'), value: inspectionField('No observation supplied'), outcome: 'unknown' }],
}, meta: { requestId: 'inspection-upstream' } });

it('only forwards the formal segment path/query and anonymous visitor policy', async () => {
  const fetcher = vi.fn(async () => Response.json(payload, { headers: { 'cache-control': 'no-store' } }));
  vi.stubGlobal('fetch', fetcher);
  const request = new Request(`https://site.invalid/api/v1/vehicles/${vehicle.id}/gallery?locale=ru&limit=50&cursor=opaque`, { headers: { Cookie: 'secret', Authorization: 'Bearer secret' } });
  const result = await proxyPublicRequest(request, ['vehicles', vehicle.id, 'gallery']);
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const actual = new URL(url);
  expect(actual.pathname).toBe(`/api/v1/vehicles/${vehicle.id}/gallery`);
  expect(Object.fromEntries(actual.searchParams)).toEqual({ locale: 'ru', limit: '50', cursor: 'opaque' });
  expect(new Headers(options.headers).has('cookie')).toBe(false);
  expect(new Headers(options.headers).has('authorization')).toBe(false);
  expect(options.cache).toBe('no-store');
});

it('forwards formal inspection filters while keeping the Chinese request locale and actual English body', async () => {
  const report = inspectionPayload();
  const fetcher = vi.fn(async () => Response.json(report));
  vi.stubGlobal('fetch', fetcher);
  const query = 'locale=zh&limit=50&cursor=opaque&category=accident&part=body&outcome=unknown&order=faults_first';
  const result = await proxyPublicRequest(new Request(`https://site.invalid/?${query}`, {
    headers: { Cookie: 'secret', Authorization: 'Bearer secret' },
  }), ['vehicles', vehicle.id, 'inspection']);
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  const body = await result.json();
  expect(body.data.locale).toBe('zh');
  expect(body.data.summary.contentLocale).toBe('en');
  expect(body.data.summary.checked).toBe(0);
  expect(body.data.summary.faults).toBeNull();
  expect(body.data.items[0].group).toMatchObject({ requestedLocale: 'zh', contentLocale: 'en' });
  expect(body.data.conclusions[0].value).toMatchObject({ requestedLocale: 'zh', contentLocale: 'en' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const actual = new URL(url);
  expect(actual.pathname).toBe(`/api/v1/vehicles/${vehicle.id}/inspection`);
  expect(Object.fromEntries(actual.searchParams)).toEqual({
    locale: 'zh', limit: '50', cursor: 'opaque', category: 'accident', part: 'body', outcome: 'unknown', order: 'faults_first',
  });
  expect(new Headers(options.headers).has('cookie')).toBe(false);
  expect(new Headers(options.headers).has('authorization')).toBe(false);
  expect(options.redirect).toBe('error');
  expect(options.cache).toBe('no-store');
});

it('rejects invalid, repeated and additional inspection parameters before an upstream request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const query of [
    'locale=zh&category=', 'locale=zh&category=Accident', 'locale=zh&part=../body', 'locale=zh&part=',
    'locale=zh&outcome=failed', 'locale=zh&order=descending', 'locale=zh&limit=101', 'locale=zh&cursor=',
    'locale=zh&reportLocale=en', 'locale=zh&bodyLocale=en', 'locale=zh&view=localized', 'locale=zh&priceView=usd',
    'locale=zh&locale=en', 'locale=zh&limit=20&limit=50', 'locale=zh&cursor=a&cursor=b',
    'locale=zh&category=accident&category=fire', 'locale=zh&part=body&part=chassis',
    'locale=zh&outcome=ok&outcome=defect', 'locale=zh&order=source&order=faults_first',
  ]) {
    const result = await proxyPublicRequest(new Request(`https://site.invalid/?${query}`), ['vehicles', vehicle.id, 'inspection']);
    expect(result.status, query).toBe(400);
    expect(result.headers.get('cache-control'), query).toBe('no-store');
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['summary', 'conclusion-name', 'conclusion-value', 'group'] as const)(
  'rejects an inspection %s DisplayText for another requested locale as unavailable', async field => {
    const report = inspectionPayload();
    const fields = {
      summary: report.data.summary!.categories[0].label,
      'conclusion-name': report.data.conclusions![0].name,
      'conclusion-value': report.data.conclusions![0].value,
      group: report.data.items[0].group!,
    };
    fields[field].requestedLocale = 'en';
    const fetcher = vi.fn(async () => Response.json(report));
    vi.stubGlobal('fetch', fetcher);
    const result = await proxyPublicRequest(new Request('https://site.invalid/?locale=zh&order=faults_first'), ['vehicles', vehicle.id, 'inspection']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(503);
    expect(result.headers.get('cache-control')).toBe('no-store');
    const body = await result.json();
    expect(() => ApiErrorSchema.parse(body)).not.toThrow();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('Structural inspection');
  },
);

it('rejects arbitrary subresources and malformed/repeated segment queries without upstream access', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const path of ['reports', 'activity', 'admin', 'gallery/private'])
    expect((await proxyPublicRequest(new Request('https://site.invalid/'), ['vehicles', vehicle.id, ...path.split('/')])).status).toBe(404);
  for (const query of ['locale=ru&view=localized', 'locale=ru&priceView=usd', 'limit=101', 'locale=ru&locale=en', 'cursor='])
    expect((await proxyPublicRequest(new Request(`https://site.invalid/?${query}`), ['vehicles', vehicle.id, 'gallery'])).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([404, 409, 429, 503])('preserves %s without caching errors or emitting upstream details', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('PRIVATE_UPSTREAM', { status, headers: { 'Retry-After': '3' } })));
  const result = await proxyPublicRequest(new Request('https://site.invalid/?locale=ru'), ['vehicles', vehicle.id, 'gallery']);
  expect(result.status).toBe(status);
  expect(result.headers.get('cache-control')).toBe('no-store');
  if (status === 429) expect(result.headers.get('retry-after')).toBe('3');
  const body = await result.json();
  expect(() => ApiErrorSchema.parse(body)).not.toThrow();
  if (status === 409) expect(body.error.code).toBe('VERSION_CONFLICT');
  expect(JSON.stringify(body)).not.toContain('PRIVATE_UPSTREAM');
});

it('rejects mismatched or privately extended upstream pages as unavailable', async () => {
  for (const extra of [{ vehicleId: 'another' }, { locale: 'en' }, { staffId: 'private' }]) {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...payload, data: { ...payload.data, ...extra } })));
    expect((await proxyPublicRequest(new Request('https://site.invalid/?locale=ru'), ['vehicles', vehicle.id, 'gallery'])).status).toBe(503);
  }
});
