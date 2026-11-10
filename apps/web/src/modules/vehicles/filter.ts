import type { Vehicle, VehicleFilters } from './types';

/** Pure client-side filtering of whichever records the data service returned. */
export function filterVehicles(
  vehicles: readonly Vehicle[],
  filters: VehicleFilters = {},
): Vehicle[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? '';
  return vehicles.filter(
    (vehicle) =>
      (!query || `${vehicle.make} ${vehicle.model}`.toLocaleLowerCase().includes(query)) &&
      (!filters.fuel || filters.fuel === 'all' || vehicle.fuel === filters.fuel) &&
      (!filters.body || filters.body === 'all' || vehicle.body === filters.body),
  );
}
