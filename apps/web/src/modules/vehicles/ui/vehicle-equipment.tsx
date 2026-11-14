import type { ExternalPublicDetail } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { groupVehicleEquipment } from '../vehicle-equipment';
import { VehicleConfigurationGrid } from './vehicle-configuration';

export function VehicleEquipment({
  specifications,
  locale,
}: {
  specifications: ExternalPublicDetail['specifications'];
  // Retain the previous call shape for older consumers; the unified section owns its title.
  title?: string;
  locale: Locale;
}) {
  // Normalize one entry at a time to retain API order without exposing legacy groups.
  const items = specifications.flatMap((entry, index) =>
    groupVehicleEquipment([entry], locale).flatMap(({ entries }) => entries.map(({ name, value }) => ({
      id: `legacy-${index}`, fieldId: entry.name.text, name, value,
    }))),
  );
  return <VehicleConfigurationGrid items={items} locale={locale} source="equipment" />;
}
