import type { PublicMedia, PublicVehicle, PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from './public-messages';
import { publicMediaUrl } from '@/shared/lib/public-media';

/** Price is displayed in its original currency. No exchange rate or tax assumption is introduced. */
export function formatPublicVehiclePrice(vehicle: PublicVehicle, locale: Locale): string {
  const { price } = vehicle;
  if (price.kind === 'on_request') return publicVehicleMessages(locale).priceLabels.on_request;
  const [whole, fraction = ''] = price.money.amount.split('.');
  const formatter = new Intl.NumberFormat(locale);
  const decimal =
    formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const significantFraction = fraction.replace(/0+$/, '');
  const amount = `${formatter.format(BigInt(whole!))}${significantFraction ? `${decimal}${significantFraction}` : ''}`;
  return `${amount} ${price.money.currency}`;
}

export function publicAvailabilityLabel(vehicle: PublicVehicle, locale: Locale): string {
  // An unknown state has no public badge; it is never converted into an available claim.
  return publicVehicleMessages(locale).availability[vehicle.availability];
}

export function publicVehicleCover(vehicle: PublicVehicle): PublicMedia {
  const cover =
    vehicle.images.find((image) => image.isCover) ??
    [...vehicle.images].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
  return { ...cover, url: publicMediaUrl(cover.url) };
}

/** Unknown facts remain explicit; model year never substitutes for manufacturing date. */
export function publicVehicleFacts(
  vehicle: PublicVehicle,
  locale: Locale,
): { label: string; value: string }[] {
  const t = publicVehicleMessages(locale);
  const f = vehicle.facts;
  const number = new Intl.NumberFormat(locale);
  const location =
    f.location &&
    (f.location.displayName || [f.location.city, f.location.country].filter(Boolean).join(', '));
  return [
    { label: t.yearLabel, value: f.modelYear === null ? t.unknown : String(f.modelYear) },
    { label: t.manufactureLabel, value: f.manufacturedAt?.value ?? t.unknown },
    { label: t.registrationLabel, value: f.firstRegistration?.value ?? t.unknown },
    {
      label: t.mileageLabel,
      value: f.mileageKm === null ? t.unknown : `${number.format(f.mileageKm)} ${t.km}`,
    },
    { label: t.powertrain, value: t.powertrains[f.powertrain] },
    {
      label: t.engineLabel,
      value: f.engineCc === null ? t.unknown : `${number.format(f.engineCc)} cm³`,
    },
    {
      label: t.powerLabel,
      value: f.powerKw === null ? t.unknown : `${number.format(f.powerKw)} kW`,
    },
    { label: t.bodyLabel, value: f.body ? t.bodies[f.body] : t.unknown },
    {
      label: t.transmissionLabel,
      value: f.transmission ? t.transmissions[f.transmission] : t.unknown,
    },
    { label: t.locationLabel, value: location || t.unknown },
  ];
}

/** Only supported, validated query fields are emitted in public navigation links. */
export function publicCatalogHref(
  locale: Locale,
  query: PublicVehicleQuery,
  page = query.page,
): string {
  const search = new URLSearchParams();
  if (query.q) search.set('q', query.q);
  if (query.make) search.set('make', query.make);
  if (query.model) search.set('model', query.model);
  if (query.powertrain) search.set('powertrain', query.powertrain);
  if (query.pageSize !== 24) search.set('pageSize', String(query.pageSize));
  if (page > 1) search.set('page', String(page));
  return `/${locale}/cars/${search.size ? `?${search}` : ''}`;
}
