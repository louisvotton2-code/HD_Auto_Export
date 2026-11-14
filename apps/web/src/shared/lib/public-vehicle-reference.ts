import type { PublicVehicle } from '@hd/contracts/public';

/** Public inquiry identity is independent of the immutable internal ID and detail URL. */
export function publicVehicleReference(vehicle: Pick<PublicVehicle, 'stockCode' | 'identifiers'>) {
  return {
    code: vehicle.identifiers?.inquiryCode ?? vehicle.stockCode,
    source: vehicle.identifiers?.source ?? null,
  };
}
