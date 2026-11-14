import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import type { DisplayText, PublicVehicleInline } from '@hd/contracts/public';
import { getPublicVehicle } from './public-api';
import { proxyPublicRequest } from './public-proxy';

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
    expect(new URL(fetcher.mock.calls[0]![0] as string).searchParams.has('projection')).toBe(false);
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
