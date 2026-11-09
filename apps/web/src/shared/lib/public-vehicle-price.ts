import type { PublicVehicle } from '@hd/contracts/public';

/** The website uses the API's USD quote. The original transaction price stays on the DTO. */
export function publicUsdQuote(vehicle: Pick<PublicVehicle, 'displayPrice'>) {
  const quote = vehicle.displayPrice;
  return quote?.status === 'ready' ? quote : null;
}
