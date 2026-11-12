import type { AdminVehicle } from '@hd/contracts/admin';

/** External listings and demos remain unknown inventory; deleted records never enter a section. */
export const isHomeEligible = (vehicle: AdminVehicle) => !vehicle.deletedAt && vehicle.publicationState === 'published' && (vehicle.draft.source.kind === 'manual' ? vehicle.availability === 'available' : vehicle.availability === 'unknown' && vehicle.availabilityCheckedAt === null);

export function addHomeVehicleId(ids: readonly string[], vehicle: AdminVehicle, placement: 'start' | 'end' = 'end'): string[] {
  if (!isHomeEligible(vehicle) || ids.includes(vehicle.id) || ids.length >= 30) return [...ids];
  return placement === 'start' ? [vehicle.id, ...ids] : [...ids, vehicle.id];
}

/** Destination is the zero-based final position; callers identify the vehicle, not a stale row index. */
export function reorderHomeVehicleId(ids: readonly string[], id: string, target: number): string[] {
  const position = ids.indexOf(id);
  if (position < 0 || !Number.isInteger(target) || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(position, 1);
  next.splice(target, 0, id);
  return next;
}

export function moveHomeVehicleId(ids: readonly string[], position: number, direction: -1 | 1): string[] {
  const target = position + direction;
  if (!Number.isInteger(position) || position < 0 || position >= ids.length) return [...ids];
  return reorderHomeVehicleId(ids, ids[position]!, target);
}
