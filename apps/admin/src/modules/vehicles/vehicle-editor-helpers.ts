import type { VehicleDraftSource } from '@hd/contracts/admin';
import type { DraftForm } from './draft-form';

/** A display sample must not acquire specific-vehicle inventory facts or an offer. */
export function formForDemo(current: DraftForm): DraftForm {
  return {
    ...current,
    priceKind: 'on_request', amount: '', includes: '',
    manufacturedAt: '', firstRegistration: '', mileageKm: '',
    registrationStatus: 'unknown', country: '', city: '', locationName: '', vin: '',
  };
}

export function hasDemoRestrictedValues(current: DraftForm): boolean {
  return current.priceKind !== 'on_request' || current.registrationStatus !== 'unknown' ||
    ['amount', 'includes', 'manufacturedAt', 'firstRegistration', 'mileageKm', 'country', 'city', 'locationName', 'vin'].some(key => Boolean(current[key as keyof DraftForm]));
}

export const externalSourceFormKeys = ['sourcePlatformId', 'sourcePlatformName', 'sourceListingUrl', 'sourceExternalId', 'sourceCollectedAt', 'sourceUpdatedAt'] as const;

/** External listings keep observed facts, but an asking price is not our own offer. */
export function formForExternal(current: DraftForm): DraftForm {
  return current.priceKind === 'asking' ? { ...current, priceKind: 'reference' } : current;
}

/** Match the discriminated contract: manual/demo never carry external metadata. */
export function sourceForKind(kind: VehicleDraftSource['kind'], form: DraftForm, previous?: VehicleDraftSource): VehicleDraftSource {
  if (kind !== 'external') return { kind };
  const prior = previous?.kind === 'external' ? previous : undefined;
  const text = (key: typeof externalSourceFormKeys[number], old?: string | null) =>
    old !== undefined && form[key] === (old ?? '') ? old ?? '' : form[key].trim();
  return {
    kind: 'external', platform: { id: text('sourcePlatformId', prior?.platform.id), name: text('sourcePlatformName', prior?.platform.name) },
    listingUrl: text('sourceListingUrl', prior?.listingUrl), externalId: text('sourceExternalId', prior?.externalId),
    collectedAt: text('sourceCollectedAt', prior?.collectedAt), sourceUpdatedAt: text('sourceUpdatedAt', prior?.sourceUpdatedAt) || null,
  };
}
