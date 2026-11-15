import type { PublicVehicle } from '@hd/contracts/public';

export function hasPrivateVehicleSource(text: string): boolean {
  return /dongchedi|che1688?|懂车帝|车168/i.test(text);
}

/** Only stable public identifiers can leave the site in an inquiry. */
export function publicVehicleReference(vehicle: Pick<PublicVehicle, 'stockCode' | 'identifiers'>) {
  const code = [vehicle.identifiers?.inquiryCode, vehicle.stockCode]
    .find(value => value && /^(?:HX[0-9]+|HD-[0-9]+)$/.test(value));
  return { code: code ?? '—' };
}
