import {
  PublicHomeSectionsSchema,
  PublicVehicleListSchema,
  PublicVehicleResponseSchema,
  type PublicVehicle,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

/** A localized request must not silently accept the legacy raw-language projection. */
function validateVehicle(vehicle: PublicVehicle, locale: Locale) {
  if (
    !vehicle.display ||
    vehicle.content.title.requestedLocale !== locale ||
    (vehicle.content.description && vehicle.content.description.requestedLocale !== locale) ||
    vehicle.detailPath !== `/${locale}/cars/${vehicle.id}/`
  )
    throw new Error('Localized vehicle projection unavailable');
  const { priceIncludes, mediaAlt, ...fields } = vehicle.display;
  for (const field of [
    ...Object.values(fields),
    ...priceIncludes.map((x) => x.value),
    ...mediaAlt.map((x) => x.value),
  ])
    if (field.requestedLocale !== locale) throw new Error('Localized vehicle projection mismatch');
  return vehicle;
}
export const localizedVehicleSchema = (locale: Locale) => ({
  parse(value: unknown) {
    const result = PublicVehicleResponseSchema.parse(value);
    validateVehicle(result.data, locale);
    return result;
  },
});
export const localizedListSchema = (locale: Locale) => ({
  parse(value: unknown) {
    const result = PublicVehicleListSchema.parse(value);
    for (const vehicle of result.data.items) validateVehicle(vehicle, locale);
    return result;
  },
});
export const localizedHomeSchema = (locale: Locale) => ({
  parse(value: unknown) {
    const result = PublicHomeSectionsSchema.parse(value);
    for (const section of result.data.sections)
      for (const vehicle of section.vehicles) validateVehicle(vehicle, locale);
    return result;
  },
});
