import { describe, expect, it, vi } from 'vitest';
import { makeLocalizedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { readFavoriteVehicle } from './read-favorite-vehicle';

const envelope = () => {
  const vehicle = makeLocalizedPublicVehicleFixture();
  vehicle.detailPath = `/en/cars/${vehicle.id}/`;
  return { data: vehicle, meta: { requestId: 'favorite-check' } };
};

describe('saved vehicle public resolution', () => {
  it('reads only the selected stable ID through the same-origin public boundary', async () => {
    const value = envelope();
    const fetcher = vi.fn().mockResolvedValue(Response.json(value));
    expect(
      await readFavoriteVehicle(value.data.id, 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'vehicle', vehicle: value.data });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/vehicles/${value.data.id}/?locale=en&view=localized`,
      expect.objectContaining({ cache: 'no-store', credentials: 'omit', redirect: 'error' }),
    );
  });
  it('does not fetch malformed stored IDs', async () => {
    const fetcher = vi.fn();
    expect(
      await readFavoriteVehicle('../admin', 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'missing' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a different car and a wrong-language detail path', async () => {
    const value = envelope();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(value))
      .mockResolvedValueOnce(
        Response.json({
          ...value,
          data: { ...value.data, detailPath: `/ru/cars/${value.data.id}/` },
        }),
      );
    expect(
      await readFavoriteVehicle('different_car', 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'error' });
    expect(
      await readFavoriteVehicle(value.data.id, 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'error' });
  });
  it('keeps a removed car distinct from a temporary outage', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect(
      await readFavoriteVehicle('known_car', 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'missing' });
    expect(
      await readFavoriteVehicle('known_car', 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'error' });
    expect(
      await readFavoriteVehicle('known_car', 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'error' });
  });
  it('preserves bounded waiting time for an explicit retry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '7' } }))
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': 'broken' } }),
      );
    expect(
      await readFavoriteVehicle('known_car', 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'limited', seconds: 7 });
    expect(
      await readFavoriteVehicle('known_car', 'en', new AbortController().signal, fetcher),
    ).toEqual({ kind: 'limited', seconds: 60 });
  });
  it('lets closing the drawer cancel its current read', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn().mockRejectedValue(new DOMException('Closed', 'AbortError'));
    await expect(
      readFavoriteVehicle('known_car', 'en', controller.signal, fetcher),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
