import type { PublicVehicle } from '@hd/contracts/public';

/** The website uses the API's USD quote. The original transaction price stays on the DTO. */
export function publicUsdQuote(vehicle: Pick<PublicVehicle, 'displayPrice'>) {
  const quote = vehicle.displayPrice;
  return quote?.status === 'ready' ? quote : null;
}

export function moneyCents(amount: string) {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function roundedUsd(amount: string) {
  return (moneyCents(amount) + 50n) / 100n;
}
