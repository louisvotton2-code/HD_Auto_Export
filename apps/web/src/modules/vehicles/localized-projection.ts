import {
  PublicHomeSectionsSchema,
  PublicVehicleListSchema,
  PublicVehicleResponseSchema,
  type PublicVehicle,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

/** A localized request must not silently accept the legacy raw-language projection. */
function validateVehicle(vehicle: PublicVehicle, locale: Locale, priceView?: 'usd', detail = false) {
  if (
    !vehicle.display ||
    vehicle.content.title.requestedLocale !== locale ||
    (vehicle.content.description && vehicle.content.description.requestedLocale !== locale) ||
    vehicle.detailPath !== `/${locale}/cars/${vehicle.id}/`
  )
    throw new Error('Localized vehicle projection unavailable');
  if (Boolean(vehicle.displayPrice) !== (priceView === 'usd'))
    throw new Error('Unexpected public price projection');
  if (vehicle.configuration != null && !detail)
    throw new Error('Unexpected configuration data in catalog projection');
  if (vehicle.report !== undefined && !detail)
    throw new Error('Unexpected report data in catalog projection');
  if (vehicle.external?.detail) {
    if (!detail) throw new Error('Unexpected detail data in catalog projection');
    for (const original of Object.values(vehicle.external.detail.original)) {
      if (original && original.requestedLocale !== locale)
        throw new Error('Localized vehicle original mismatch');
    }
  }
  const { priceIncludes, mediaAlt, ...fields } = vehicle.display;
  for (const field of [
    ...Object.values(fields),
    ...priceIncludes.map((x) => x.value),
    ...mediaAlt.map((x) => x.value),
    ...(vehicle.configuration?.items.flatMap((item) => [item.name, item.value]) ?? []),
  ])
    if (field.requestedLocale !== locale) throw new Error('Localized vehicle projection mismatch');
  return vehicle;
}
export const localizedVehicleSchema = (locale: Locale, priceView?: 'usd') => ({
  parse(value: unknown) {
    const result = PublicVehicleResponseSchema.parse(value);
    validateVehicle(result.data, locale, priceView, true);
    return result;
  },
});
export const localizedListSchema = (locale: Locale, priceView?: 'usd') => ({
  parse(value: unknown) {
    const result = PublicVehicleListSchema.parse(value);
    for (const vehicle of result.data.items) validateVehicle(vehicle, locale, priceView);
    return result;
  },
});
export const localizedHomeSchema = (locale: Locale, priceView?: 'usd') => ({
  parse(value: unknown) {
    const result = PublicHomeSectionsSchema.parse(value);
    for (const section of result.data.sections)
      for (const vehicle of section.vehicles) validateVehicle(vehicle, locale, priceView);
    return result;
  },
});

// The editorial view is also used by sitemap traversal, so imports must stay out of its pages.
export const legacyListSchema = PublicVehicleListSchema.refine((result) =>
  result.data.items.every((vehicle) => !vehicle.external && !vehicle.displayPrice),
);
export const legacyHomeSchema = PublicHomeSectionsSchema.refine((result) =>
  result.data.sections.every((section) =>
    section.vehicles.every((vehicle) => !vehicle.external && !vehicle.displayPrice),
  ),
);
export const legacyVehicleSchema = PublicVehicleResponseSchema.refine(
  (result) => !result.data.external && !result.data.displayPrice,
);
