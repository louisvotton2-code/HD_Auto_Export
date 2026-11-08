import { IdSchema } from '@hd/contracts/public';

export const VEHICLE_FAVORITES_STORAGE_KEY = 'hd-auto:vehicle-favorites:v1';
export const MAX_VEHICLE_FAVORITES = 100;
export const EMPTY_VEHICLE_FAVORITES: readonly string[] = Object.freeze([]);

/** Favorites contain identities only, never stored DTOs or inventory assertions. */
export function normalizeVehicleFavoriteIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return EMPTY_VEHICLE_FAVORITES;
  const ids: string[] = [];
  for (const id of value) {
    if (IdSchema.safeParse(id).success && !ids.includes(id)) ids.push(id);
    if (ids.length === MAX_VEHICLE_FAVORITES) break;
  }
  return ids.length ? Object.freeze(ids) : EMPTY_VEHICLE_FAVORITES;
}

/** null means corrupt/unsupported data; an empty list is a valid saved value. */
export function parseVehicleFavoriteIds(raw: string | null): readonly string[] | null {
  if (raw === null) return EMPTY_VEHICLE_FAVORITES;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('ids' in value) ||
      !Array.isArray(value.ids)
    )
      return null;
    return normalizeVehicleFavoriteIds(value.ids);
  } catch {
    return null;
  }
}
