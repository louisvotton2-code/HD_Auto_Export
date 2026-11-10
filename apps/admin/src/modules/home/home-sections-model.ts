import type { AdminVehicle } from '@hd/contracts/admin';

/** External listings and demos remain unknown inventory; deleted records never enter a section. */
export const isHomeEligible = (vehicle: AdminVehicle) => !vehicle.deletedAt && vehicle.publicationState === 'published' && (vehicle.draft.source.kind === 'manual' ? vehicle.availability === 'available' : vehicle.availability === 'unknown' && vehicle.availabilityCheckedAt === null);

export function addHomeVehicleId(ids: readonly string[], vehicle: AdminVehicle): string[] {
  if (!isHomeEligible(vehicle) || ids.includes(vehicle.id) || ids.length >= 30) return [...ids];
  return [...ids, vehicle.id];
}

export function moveHomeVehicleId(ids: readonly string[], position: number, direction: -1 | 1): string[] {
  const next = [...ids];
  const target = position + direction;
  if (position < 0 || position >= next.length || target < 0 || target >= next.length) return next;
  [next[position], next[target]] = [next[target]!, next[position]!];
  return next;
}
