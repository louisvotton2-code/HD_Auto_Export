import { type PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { localizedVehicleSchema } from '../localized-projection';
import { publicQueryString, publicUsdView } from '../public-query';
import { retryAfterSeconds } from '@/shared/lib/retry-after';

export type FavoriteVehicleResult =
  | { kind: 'vehicle'; vehicle: PublicVehicle }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'limited'; seconds: number };

/** Resolve saved IDs against current public data; local storage is never stock evidence. */
export async function readFavoriteVehicle(
  id: string,
  locale: Locale,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<FavoriteVehicleResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) return { kind: 'missing' };
  try {
    const response = await fetcher(
      `/api/v1/vehicles/${encodeURIComponent(id)}/?${publicQueryString({ locale, ...publicUsdView })}`,
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return { kind: 'missing' };
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return { kind: 'limited', seconds: retryAfterSeconds(response.headers.get('retry-after')) };
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      return { kind: 'error' };
    }
    const parsed = localizedVehicleSchema(locale, 'usd').parse(await response.json());
    if (parsed.data.id !== id || parsed.data.detailPath !== `/${locale}/cars/${id}/`)
      return { kind: 'error' };
    return { kind: 'vehicle', vehicle: parsed.data };
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: 'error' };
  }
}
