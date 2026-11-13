import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { externalDetailCopy } from '../external-detail-copy';
import { VehicleConfiguration } from './vehicle-configuration';
import { VehicleEquipment } from './vehicle-equipment';

/** Render the bounded detail projection only; complete source data remains in staff tools. */
export function PublicVehicleConfiguration({ vehicle, locale }: { vehicle: PublicVehicle; locale: Locale }) {
  if (vehicle.configuration) {
    const items = vehicle.configuration.items.filter(({ name, value }) =>
      name.status === 'ready' && name.text.trim() !== '' &&
      value.status === 'ready' && value.text.trim() !== '',
    );
    return <VehicleConfiguration configuration={{ ...vehicle.configuration, items }} locale={locale} />;
  }
  return <VehicleEquipment
    specifications={vehicle.external?.detail?.specifications ?? []}
    title={externalDetailCopy[locale].specifications}
    locale={locale}
  />;
}
