import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import type { DisplayText, PublicVehicleInline } from '@hd/contracts/public';
import { getPublicVehicle } from './public-api';
import { proxyPublicRequest } from './public-proxy';
import { publicInlineVehicleView } from '../public-query';

function inlineFixture(): PublicVehicleInline {
  const text = (value: string): DisplayText => ({
    status: 'ready', text: value, requestedLocale: 'ru', contentLocale: 'en', provenance: 'supplier', reviewed: false,
  });
  return {
    ...makeLocalizedPublicVehicleFixture('ru'), projection: 'detail-inline-v1',
    inspectionSummary: { status: 'available', contentLocale: 'en', checked: 25, faults: 1, categories: [] },
    inspectionInline: {
      conclusions: [], defects: [{
        id: 'door-1', category: null, part: text('Left front door'), group: text('Doors'),
        name: text('Outer panel'), value: text('Dent'), outcome: 'defect',
      }], normalItemCount: 24, hasMoreConclusions: false, hasMoreDefects: false,
    },
    configurationInline: [{ id: 'motor-1', semanticKey: 'motorKw', name: text('Motor power (kW)'), value: text('0') }],
  };
}

const envelope = (data: unknown) => ({ data, meta: { requestId: 'upstream-inline' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('explicit inline detail HTTP projection', () => {
  it('forwards the projection on direct reads and validates a single inline response without a report probe', async () => {
    const data = inlineFixture();
    const fetcher = vi.fn().mockImplementation(async () => Response.json(envelope(data)));
    vi.stubGlobal('fetch', fetcher);
    expect(await getPublicVehicle(data.id, 'ru', undefined, 'localized', undefined, 'detail-inline-v1')).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const target = new URL(fetcher.mock.calls[0]![0] as string);
    expect(target.pathname).toBe(`/api/v1/vehicles/${data.id}`);
    expect(Object.fromEntries(target.searchParams)).toEqual({ locale: 'ru', view: 'localized', projection: 'detail-inline-v1' });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
  });

  it('uses the official new schema through the BFF, retaining English body and real zero values', async () => {
    const data = inlineFixture();
    const fetcher = vi.fn().mockImplementation(async () => Response.json(envelope(data)));
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPublicRequest(
      new Request(`https://website.test/api/v1/vehicles/${data.id}?locale=ru&view=localized&projection=detail-inline-v1`),
      ['vehicles', data.id],
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(data);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const query = new URL(fetcher.mock.calls[0]![0] as string).searchParams;
    expect(query.get('projection')).toBe('detail-inline-v1');
    expect(query.get('view')).toBe('localized');
  });

  it('opts supplier details into verified technical facts and forwards the scope through the proxy', async () => {
    const staff = inlineFixture();
    const id = 'ext-91d8ad9a-4ede-4ef0-a68e-17c40fdc7006';
    const data = { ...staff, id, detailPath: `/ru/cars/${id}/`, technicalDetails: {
      power: { motorKw: 0 }, configurationMatches: [{ id: 'specs.motorKw', semanticKey: 'motorKw', source: 'configuration' }],
    } };
    const fetcher = vi.fn().mockImplementation(async () => Response.json(envelope(data)));
    vi.stubGlobal('fetch', fetcher);

    expect(publicInlineVehicleView(staff.id, 'en')).not.toHaveProperty('technicalView');
    expect(publicInlineVehicleView(id, 'ru')).toEqual({
      view: 'localized', priceView: 'usd', projection: 'detail-inline-v1', technicalView: 'verified', titleView: 'english',
    });
    const response = await proxyPublicRequest(new Request(
      `https://website.test/api/v1/vehicles/${id}?locale=ru&view=localized&projection=detail-inline-v1&technicalView=verified&titleView=english`,
    ), ['vehicles', id]);
    expect(response.status).toBe(200);
    expect((await response.json()).data.technicalDetails).toEqual(data.technicalDetails);
    expect(new URL(fetcher.mock.calls[0]![0] as string).searchParams.get('technicalView')).toBe('verified');
    expect(new URL(fetcher.mock.calls[0]![0] as string).searchParams.get('titleView')).toBe('english');
  });

  it('keeps a request without projection on the strict old localized response', async () => {
    const data = makeLocalizedPublicVehicleFixture('ru');
    const fetcher = vi.fn().mockImplementation(async () => Response.json(envelope(data)));
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPublicRequest(
      new Request(`https://website.test/api/v1/vehicles/${data.id}?locale=ru&view=localized`),
      ['vehicles', data.id],
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(data);
    const query = new URL(fetcher.mock.calls[0]![0] as string).searchParams;
    expect(Object.fromEntries(query)).toEqual({ locale: 'ru', view: 'localized' });
  });

  it('negotiates Pixel eligibility only on the existing inline detail request', async () => {
    const data = { ...inlineFixture(), pixelEnabled: true };
    const fetcher = vi.fn().mockImplementation(async () => Response.json(envelope(data)));
    vi.stubGlobal('fetch', fetcher);

    expect(publicInlineVehicleView(data.id, 'ru')).not.toHaveProperty('pixelView');
    const view = publicInlineVehicleView(data.id, 'ru', { includePixel: true });
    expect(view.pixelView).toBe('eligible');
    expect(view).not.toHaveProperty('seoView');
    const response = await proxyPublicRequest(new Request(
      `https://website.test/api/v1/vehicles/${data.id}?locale=ru&view=localized&projection=detail-inline-v1&pixelView=eligible`,
    ), ['vehicles', data.id]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0]![0] as string).searchParams.get('pixelView')).toBe('eligible');
    expect(response.status).toBe(200);
    expect((await response.json()).data.pixelEnabled).toBe(true);
  });

  it('negotiates SEO independently and preserves eligibility in the inline response', async () => {
    const seo = { indexable: true, locales: ['ru'], lastModified: '2026-11-21T00:00:00Z' };
    const data = { ...inlineFixture(), seo };
    const fetcher = vi.fn().mockImplementation(async () => Response.json(envelope(data)));
    vi.stubGlobal('fetch', fetcher);

    expect(publicInlineVehicleView(data.id, 'ru')).not.toHaveProperty('seoView');
    const view = publicInlineVehicleView(data.id, 'ru', { includeSeo: true });
    expect(view.seoView).toBe('eligible');
    expect(view).not.toHaveProperty('pixelView');
    const response = await proxyPublicRequest(new Request(
      `https://website.test/api/v1/vehicles/${data.id}?locale=ru&view=localized&projection=detail-inline-v1&seoView=eligible`,
    ), ['vehicles', data.id]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0]![0] as string).searchParams.get('seoView')).toBe('eligible');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(data);
  });

  it.each([200, 400])('retries a rejected eligibility query once with only the original detail options (upstream %s)', async status => {
    const data = inlineFixture();
    const oldQuery = {
      locale: 'ru', view: 'localized', projection: 'detail-inline-v1', technicalView: 'verified', titleView: 'english',
    };
    const fullQuery = { ...oldQuery, pixelView: 'eligible', seoView: 'eligible' };
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => new Response(null, { status: 400 }))
      .mockImplementationOnce(async () => status === 200 ? Response.json(envelope(data)) : new Response(null, { status }));
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPublicRequest(new Request(
      `https://website.test/api/v1/vehicles/${data.id}?${new URLSearchParams(fullQuery)}`,
    ), ['vehicles', data.id]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [index, query] of [fullQuery, oldQuery].entries()) {
      const target = new URL(fetcher.mock.calls[index]![0] as string);
      expect(target.pathname).toBe(`/api/v1/vehicles/${data.id}`);
      expect(Object.fromEntries(target.searchParams)).toEqual(query);
    }
    expect(response.status).toBe(status === 200 ? 200 : 404);
    if (status === 200) expect((await response.json()).data).toEqual(data);
  });

  it.each(['old-for-inline', 'inline-for-old', 'wrong-body-locale', 'private-extra'] as const)(
    'fails closed for an incompatible upstream payload: %s', async mismatch => {
      const data = inlineFixture();
      const projection = mismatch === 'inline-for-old' ? '' : '&projection=detail-inline-v1';
      let payload: unknown = data;
      if (mismatch === 'old-for-inline') payload = makeLocalizedPublicVehicleFixture('ru');
      if (mismatch === 'wrong-body-locale') data.inspectionInline.defects[0]!.part!.requestedLocale = 'zh';
      if (mismatch === 'private-extra') payload = { ...data, internalCost: 'PRIVATE_COST_SENTINEL' };
      const fetcher = vi.fn().mockImplementation(async () => Response.json(envelope(payload)));
      vi.stubGlobal('fetch', fetcher);
      const response = await proxyPublicRequest(
        new Request(`https://website.test/api/v1/vehicles/${data.id}?locale=ru&view=localized${projection}`),
        ['vehicles', data.id],
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/PRIVATE_COST_SENTINEL|internalCost|upstream-inline/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'projection=detail-inline-v1',
    'projection=detail-inline-v1&view=legacy',
    'projection=detail-inline-v1&view=invalid',
    'projection=detail-inline-v2&view=localized',
    'projection=card&view=localized',
    'technicalView=verified&view=localized',
    'pixelView=eligible&view=localized',
    'pixelView=invalid&view=localized&projection=detail-inline-v1',
    'seoView=eligible&view=localized',
    'seoView=invalid&view=localized&projection=detail-inline-v1',
    'seoView=eligible&seoView=eligible&view=localized&projection=detail-inline-v1',
    'projection=detail-inline-v1&projection=detail-inline-v1&view=localized',
  ])('rejects an invalid projection/view query before upstream IO: %s', async query => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyPublicRequest(
      new Request(`https://website.test/api/v1/vehicles/fixture_vehicle_1?locale=ru&${query}`),
      ['vehicles', 'fixture_vehicle_1'],
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
