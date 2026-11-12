import type { PublicationPreviewVehicle } from '@hd/contracts/admin';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from './public-messages';
import { formatVehicleMoney } from './public-presentation';
import { publicationPreviewCopy } from './publication-preview-copy';
import type { VehicleGalleryImage } from './ui/vehicle-gallery-image';

/** Missing draft amounts retain their currency without becoming zero or on-request quotes. */
export function publicationPreviewPrice(price: PublicationPreviewVehicle['price'], locale: Locale) {
  const copy = publicationPreviewCopy[locale];
  if (price.status === 'on_request') {
    return { original: publicVehicleMessages(locale).priceLabels.on_request, approximation: null };
  }
  const money = price.money;
  if (price.status === 'missing' || !money || money.amount === null) {
    return {
      original: money ? `${copy.missingPrice} · ${money.currency}` : copy.missingPrice,
      approximation: null,
    };
  }
  const converted = price.displayPrice;
  return {
    original: formatVehicleMoney({ amount: money.amount, currency: money.currency }, locale),
    approximation: converted?.status === 'ready' && converted.conversion
      ? `≈ ${formatVehicleMoney(converted.money, locale)}`
      : null,
  };
}

/** Staff media keeps its authenticated URL and never inherits remote-report metadata. */
export function publicationPreviewImages(images: PublicationPreviewVehicle['images']): VehicleGalleryImage[] {
  return images.flatMap((image) => image.status === 'ready' && image.url !== null ? [{
    id: image.id,
    url: image.url,
    alt: image.alt,
    width: image.width,
    height: image.height,
    sortOrder: image.sortOrder,
    isCover: image.isCover,
  }] : []);
}
