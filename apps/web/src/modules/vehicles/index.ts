/** Public vehicle data interface. UI consumers must not import the mock file directly. */
import { demoVehicles } from './mock/vehicles';
import { popularModels } from './mock/homepage';
import type { Vehicle, VehicleFilters } from './types';
import { filterVehicles } from './filter';
export { filterVehicles } from './filter';
export type { Vehicle, VehicleFilters, VehicleFuel, VehicleBody } from './types';

export function getVehicles(filters: VehicleFilters = {}): Vehicle[] {
  return filterVehicles(demoVehicles, filters);
}
export function getFeaturedVehicles(limit = 3): Vehicle[] {
  return getVehicles().slice(0, Math.max(0, limit));
}
export function getVehicleBySlug(slug: string): Vehicle | undefined {
  return demoVehicles.find((vehicle) => vehicle.slug === slug);
}

/** Model-family demonstration cards, separate from individual inventory. */
export function getPopularModels() {
  return popularModels;
}

export { vehicleMessages } from './messages';
export { VehicleList } from './ui/vehicle-list';
export { VehicleDetail } from './ui/vehicle-detail';
