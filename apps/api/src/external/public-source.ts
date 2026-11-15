import type { Locale, PublicVehicle, VehicleDisplay } from '@hd/contracts/public';
import { displayText } from './normalize.js';

export function publicExternalSource(): Extract<PublicVehicle['source'], { kind: 'external' }> {
  return { kind: 'external', platform: { id: 'external', name: 'External listing' }, listingUrl: null };
}

export function publicExternalDisplay(display: VehicleDisplay, locale: Locale): VehicleDisplay {
  return { ...display, platform: displayText(locale, null) };
}
