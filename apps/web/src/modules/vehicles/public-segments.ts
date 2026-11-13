import {
  PublicVehicleGalleryResponseSchema, PublicVehicleConfigurationResponseSchema,
  type PublicVehicleGalleryResponse, type PublicVehicleConfigurationResponse,
} from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';

export type VehicleSegmentKind = 'gallery' | 'configuration';
export type VehicleSegmentPages = {
  gallery: PublicVehicleGalleryResponse['data'];
  configuration: PublicVehicleConfigurationResponse['data'];
};
export class VehicleSegmentError extends Error {
  constructor(readonly status: number, readonly retryAfter = 0) { super('Vehicle section unavailable'); }
}

/** Validate public identity and language before either the BFF or browser accepts a page. */
export function parseVehicleSegment<K extends VehicleSegmentKind>(kind: K, value: unknown, vehicleId: string, locale: Locale) {
  const parsed = kind === 'gallery' ? PublicVehicleGalleryResponseSchema.parse(value) : PublicVehicleConfigurationResponseSchema.parse(value);
  if (parsed.data.vehicleId !== vehicleId || parsed.data.locale !== locale) throw new VehicleSegmentError(503);
  if (parsed.data.nextCursor === '') throw new VehicleSegmentError(503);
  if (kind === 'configuration') {
    for (const item of (parsed as PublicVehicleConfigurationResponse).data.items)
      if (item.name.requestedLocale !== locale || item.value.requestedLocale !== locale) throw new VehicleSegmentError(503);
  }
  if (kind === 'gallery') for (const item of (parsed as PublicVehicleGalleryResponse).data.items)
    if (item.altText !== undefined && item.altText.requestedLocale !== locale) throw new VehicleSegmentError(503);
  if (new Set(parsed.data.items.map(item => item.id)).size !== parsed.data.items.length) throw new VehicleSegmentError(503);
  return parsed as K extends 'gallery' ? PublicVehicleGalleryResponse : PublicVehicleConfigurationResponse;
}

/** First page replaces previews; only stable, complete pages from one revision may be appended. */
export function mergeVehicleSegment<K extends VehicleSegmentKind>(previous: VehicleSegmentPages[K] | null, page: VehicleSegmentPages[K]): VehicleSegmentPages[K] {
  if (previous && (previous.vehicleId !== page.vehicleId || previous.locale !== page.locale
    || previous.revision !== page.revision || previous.total !== page.total)) throw new VehicleSegmentError(409);
  const byId = new Map<string, VehicleSegmentPages[K]['items'][number]>();
  for (const item of previous?.items ?? []) byId.set(item.id, item);
  for (const item of page.items) {
    const old = byId.get(item.id);
    if (old && JSON.stringify(old) !== JSON.stringify(item)) throw new VehicleSegmentError(409);
    byId.set(item.id, item);
  }
  const items = [...byId.values()];
  if (items.length > page.total || (page.nextCursor === null && items.length !== page.total)
    || (page.nextCursor !== null && (items.length >= page.total || !page.items.length))) throw new VehicleSegmentError(503);
  return { ...page, items } as VehicleSegmentPages[K];
}
