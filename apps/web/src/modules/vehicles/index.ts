/** Public, browser-safe DTO presentation. Historical mock UI is deliberately not exported. */
// Browser-safe public DTO presentation. HTTP queries have a separate server.ts entry.
export { publicVehicleMessages } from './public-messages';
export {
  formatPublicVehiclePrice,
  publicAvailabilityLabel,
  publicVehicleCover,
  publicVehicleFacts,
  publicCatalogHref,
} from './public-presentation';
export { PublicVehicleCard } from './ui/public-vehicle-card';
export { PublicVehicleList } from './ui/public-vehicle-list';
export { PublicVehicleDetail } from './ui/public-vehicle-detail';
export { PublicDetailResource } from './ui/public-detail-resource';
export { PublicFreshnessBoundary, usePublicFreshness, usePublicResource } from './application/use-public-resource';
export { PublicResourceStatus } from './ui/public-resource-status';
export { liveVehicleCopy } from './live-copy';
export { useVehicleFavorites } from './application/use-vehicle-favorites';
export { normalizeVehicleFavoriteIds, VEHICLE_FAVORITES_STORAGE_KEY, MAX_VEHICLE_FAVORITES } from './application/favorite-vehicle-ids';
export { FavoriteVehicleButton } from './ui/favorite-vehicle-button';
export { VehicleFavorites } from './ui/vehicle-favorites';

export { localizedHomeSchema } from './localized-projection';
export { VehiclePhoto } from './ui/vehicle-photo';
