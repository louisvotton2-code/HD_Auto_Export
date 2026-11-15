import { vehicleConfigurationItemId, type VehicleConfiguration } from '@hd/contracts/admin';
import { ConfigurationDisplaySchema, type DisplayText, type Locale } from '@hd/contracts/public';

/** Numeric/unit/identifier values remain source facts, never simulated machine translations. */
export const configurationValueNeedsTranslation = (value: string) => /\p{Script=Han}/u.test(value);
export function projectConfiguration(configuration: VehicleConfiguration | null | undefined, locale: Locale, resolve: (ref: string) => DisplayText) {
  if (!configuration) return null;
  return ConfigurationDisplaySchema.parse({ version: configuration.version, items: configuration.items.map(item => {
    const id = vehicleConfigurationItemId(item.name);
    const localizedValue=resolve(`configuration.${id}.value`);
    return { id, name: resolve(`configuration.${id}.name`), value: localizedValue.status==='ready'||configurationValueNeedsTranslation(item.value)
      ? localizedValue
      : { status: 'ready', text: item.value, requestedLocale: locale, contentLocale: 'und', provenance: 'original', reviewed: false } };
  }) });
}
