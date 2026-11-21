'use client';

import { useState } from 'react';
import type { PublicMedia } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { publicMediaUrl, publicMediaVariantUrl } from '@/shared/lib/public-media';
import { reportExternalPhotoFailure } from '../application/report-external-photo-failure';
import { detailContent } from '../detail-content';
import { imageAltAttributes } from '../vehicle-image-text';
import styles from './vehicle-photo.module.css';

type Photo = Pick<PublicMedia, 'id' | 'url' | 'width' | 'height' | 'remote' | 'altText'>;
type Layout = 'catalog' | 'rail';

const mobileSizes = '(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) calc((100vw - 68px) / 2)';
const photoSizes: Record<Layout, string> = {
  catalog: `${mobileSizes}, (max-width: 1279px) calc((100vw - 72px) * .375 - 10px), 443px`,
  rail: `${mobileSizes}, (max-width: 1279px) calc((100vw - 88px) / 3), 398px`,
};

function cardSources(image: Photo, limitToCard: boolean) {
  const thumb = publicMediaVariantUrl(image.url, 'thumb');
  const card = publicMediaVariantUrl(image.url, 'card');
  const { width, height } = image;
  if (!thumb || !card || image.remote || !width || !height || width < 1 || height < 1) return null;
  const base = publicMediaUrl(image.url);
  const thumbWidth = Math.min(240, width);
  const cardWidth = Math.max(1, Math.round(width * Math.min(1, 800 / Math.max(width, height))));
  const useCard = cardWidth < width || height > 800;
  const cardSrc = useCard ? card : base;
  const candidates = [
    ...(thumbWidth < cardWidth ? [`${thumb} ${thumbWidth}w`] : []),
    ...(limitToCard
      ? [`${cardSrc} ${cardWidth}w`]
      : [...(cardWidth < width ? [`${card} ${cardWidth}w`] : []), `${base} ${width}w`]),
  ];
  return {
    cardSrc,
    compactSrc: cardWidth < thumbWidth ? card : thumbWidth < width ? thumb : base,
    srcSet: candidates.length > 1 ? candidates.join(', ') : undefined,
  };
}

export function VehiclePhotoFallback({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  return (
    <span className={styles.fallback} data-vehicle-photo-unavailable>
      <Icon name="car" size={compact ? 20 : 30} />
      {!compact && <span>{detailContent[locale].imageUnavailable}</span>}
    </span>
  );
}

export function VehiclePhoto({
  image,
  locale,
  alt,
  compact = false,
  layout = 'catalog',
  priority = false,
}: {
  image: Photo | null;
  locale: Locale;
  alt: string;
  compact?: boolean;
  layout?: Layout;
  priority?: boolean;
}) {
  if (!image) return <VehiclePhotoFallback locale={locale} compact={compact} />;
  return <PhotoResource key={`${image.id}:${image.url}:${image.remote?.revision ?? 0}`} image={image} locale={locale} alt={alt} compact={compact} layout={layout} priority={priority} />;
}

function PhotoResource({
  image,
  locale,
  alt,
  compact,
  layout,
  priority,
}: {
  image: Photo;
  locale: Locale;
  alt: string;
  compact: boolean;
  layout: Layout;
  priority: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [originalOnly, setOriginalOnly] = useState(false);
  const limitToCard = layout === 'catalog' && !compact;
  const sources = originalOnly ? null : cardSources(image, limitToCard);
  const src = compact ? sources?.compactSrc : limitToCard ? sources?.cardSrc : undefined;
  function fail(node: HTMLImageElement) {
    if (sources && /\?variant=(?:thumb|card)$/.test(node.currentSrc)) {
      // Older API or a failed derivative: keep the authorized original as the only fallback.
      setOriginalOnly(true);
      return;
    }
    setFailed(true);
    reportExternalPhotoFailure(image);
  }
  if (failed) return <VehiclePhotoFallback locale={locale} compact={compact} />;
  return (
    <img
      key={originalOnly ? 'original' : 'responsive'}
      ref={(node) => {
        // The browser may finish the request before the client hydrates this card.
        if (node?.complete && node.naturalWidth === 0) fail(node);
      }}
      srcSet={compact ? undefined : sources?.srcSet}
      sizes={!compact && sources?.srcSet ? (priority ? photoSizes[layout] : `auto, ${photoSizes[layout]}`) : undefined}
      src={src ?? image.url}
      {...imageAltAttributes(image, alt)}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      referrerPolicy={image.url.startsWith('https:') ? 'no-referrer' : undefined}
      onError={(event) => fail(event.currentTarget)}
    />
  );
}
