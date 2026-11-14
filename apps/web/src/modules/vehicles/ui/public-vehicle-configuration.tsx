import type { PublicVehicle, PublicVehicleInline } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { VehicleConfiguration } from './vehicle-configuration';
import { VehicleEquipment } from './vehicle-equipment';

/** Render the bounded detail projection only; complete source data remains in staff tools. */
export function PublicVehicleConfiguration({ vehicle, locale }: { vehicle: PublicVehicle | PublicVehicleInline; locale: Locale }) {
  if ('configurationInline' in vehicle) {
    const items = vehicle.configurationInline.filter(({ name, value }) =>
      name.status === 'ready' && name.text.trim() !== '' &&
      value.status === 'ready' && value.text.trim() !== '',
    );
    // An explicitly empty bounded projection must never reveal an old/full source fallback.
    return <VehicleConfiguration configuration={{ version: 1, items }} locale={locale} />;
  }
  if (vehicle.configuration) {
    const items = vehicle.configuration.items.filter(({ name, value }) =>
      name.status === 'ready' && name.text.trim() !== '' &&
      value.status === 'ready' && value.text.trim() !== '',
    );
    return <VehicleConfiguration configuration={{ ...vehicle.configuration, items }} locale={locale} />;
  }
  return <VehicleEquipment
    specifications={vehicle.external?.detail?.specifications ?? []}
    locale={locale}
  />;
}
