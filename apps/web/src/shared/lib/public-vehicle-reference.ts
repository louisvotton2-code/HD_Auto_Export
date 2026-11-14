import type { PublicVehicle } from '@hd/contracts/public';

/** Public inquiry identity is independent of the immutable detail URL. */
export function publicVehicleReference(vehicle: Pick<PublicVehicle, 'id' | 'source' | 'stockCode'>): string | null {
  if (vehicle.source.kind !== 'external') return vehicle.stockCode;
  const uuid = /^(?:ext-)?([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.exec(vehicle.id)?.[1];
  if (!vehicle.id.startsWith('ext-') && /^HD-\d{6,}$/.test(vehicle.stockCode)) return vehicle.stockCode;
  if (!uuid) return null;
  if (/^HDX-[0-9A-F]{16}$/.test(vehicle.stockCode)) return vehicle.stockCode;
  const hex = uuid.replaceAll('-', '').toUpperCase();
  return `HDX-${hex.slice(0, 12)}${hex.slice(-4)}`;
}
