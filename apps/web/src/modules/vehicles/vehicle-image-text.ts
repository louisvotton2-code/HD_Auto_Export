import type { DisplayText } from '@hd/contracts/public';

type ImageText = { altText?: DisplayText };
type LegacyAlt = readonly { mediaId: string; value: DisplayText }[];

/** Per-image metadata is authoritative, including an explicit missing value. */
export function withImageAltText<T extends ImageText & { id: string }>(image: T, legacy: LegacyAlt = []): T & ImageText {
  if (image.altText !== undefined) return image;
  const field = legacy.find(item => item.mediaId === image.id)?.value;
  return field ? { ...image, altText: field } : image;
}

/** Unknown metadata stays absent; decorative images retain their empty alternative. */
export function imageAltAttributes(image: ImageText, fallback: string) {
  const field = image.altText;
  return {
    alt: fallback === '' ? '' : field?.status === 'ready' ? field.text : fallback,
    lang: field?.contentLocale ?? undefined,
    'data-alt-status': field?.status,
    'data-provenance': field?.provenance ?? undefined,
    'data-reviewed': field?.reviewed,
  };
}
