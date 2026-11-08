import type { PublicMedia, PublicVehicle, PublicVehicleQuery } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from './public-messages';
import { publicMediaUrl } from '@/shared/lib/public-media';
import { catalogFilterKeys } from './public-query';
import { catalogFilterCopy } from './catalog-filter-copy';

/** Price is displayed in its original currency. No exchange rate or tax assumption is introduced. */
export function formatPublicAmount(amount: string, locale: Locale): string {
  const [whole, fraction = ''] = amount.split('.');
  const formatter = new Intl.NumberFormat(locale);
  const decimal =
    formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const significantFraction = fraction.replace(/0+$/, '');
  return `${formatter.format(BigInt(whole!))}${significantFraction ? `${decimal}${significantFraction}` : ''}`;
}
export function formatPublicVehiclePrice(vehicle: PublicVehicle, locale: Locale): string {
  const { price } = vehicle;
  if (price.kind === 'on_request') return publicVehicleMessages(locale).priceLabels.on_request;
  return `${formatPublicAmount(price.money.amount, locale)} ${price.money.currency}`;
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
    ...(f.trim ? [{ label: catalogFilterCopy[locale].trim, value: f.trim.name }] : []),
    ...(f.generation
      ? [{ label: catalogFilterCopy[locale].generation, value: f.generation.name }]
      : []),
    ...(f.drivetrain
      ? [
          {
            label: catalogFilterCopy[locale].drive,
            value: catalogFilterCopy[locale].drives[f.drivetrain],
          },
        ]
      : []),
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
  for (const key of catalogFilterKeys) {
    const value = query[key];
    if (value !== undefined) search.set(key, String(value));
  }
  if (query.pageSize !== 24) search.set('pageSize', String(query.pageSize));
  if (page > 1) search.set('page', String(page));
  return `/${locale}/cars/${search.size ? `?${search}` : ''}`;
}
