'use client';

import { useState } from 'react';
import type { PublicMedia } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { reportExternalPhotoFailure } from '../application/report-external-photo-failure';
import { detailContent } from '../detail-content';
import { imageAltAttributes } from '../vehicle-image-text';
import styles from './vehicle-photo.module.css';

type Photo = Pick<PublicMedia, 'id' | 'url' | 'width' | 'height' | 'remote' | 'altText'>;
type Layout = 'catalog' | 'rail';

const mobileSizes = '(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) calc((100vw - 68px) / 2)';
const photoSizes: Record<Layout, string> = {
  catalog: `auto, ${mobileSizes}, (max-width: 1279px) calc((100vw - 72px) * .375 - 10px), 443px`,
  rail: `auto, ${mobileSizes}, (max-width: 1279px) calc((100vw - 88px) / 3), 398px`,
};

function cardSources(image: Photo) {
  // Only site-owned originals are eligible. Never rewrite a remote or signed URL.
  const original = /^(\/api\/v1\/media\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})\/?$/.exec(image.url);
  const { width, height } = image;
  if (!original || image.remote || !width || !height || width < 1 || height < 1) return null;
  const base = `${original[1]}/`;
  const thumb = `${base}?variant=thumb`;
  const card = `${base}?variant=card`;
  const thumbWidth = Math.min(240, width);
  const cardWidth = Math.max(1, Math.round(width * Math.min(1, 800 / Math.max(width, height))));
  const candidates = [
    ...(thumbWidth < cardWidth ? [`${thumb} ${thumbWidth}w`] : []),
    ...(cardWidth < width ? [`${card} ${cardWidth}w`] : []),
    `${base} ${width}w`,
  ];
  return {
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
}: {
  image: Photo | null;
  locale: Locale;
  alt: string;
  compact?: boolean;
  layout?: Layout;
}) {
  if (!image) return <VehiclePhotoFallback locale={locale} compact={compact} />;
  return <PhotoResource key={`${image.id}:${image.url}:${image.remote?.revision ?? 0}`} image={image} locale={locale} alt={alt} compact={compact} layout={layout} />;
}

function PhotoResource({
  image,
  locale,
  alt,
  compact,
  layout,
}: {
  image: Photo;
  locale: Locale;
  alt: string;
  compact: boolean;
  layout: Layout;
}) {
  const [failed, setFailed] = useState(false);
  const [originalOnly, setOriginalOnly] = useState(false);
  const sources = originalOnly ? null : cardSources(image);
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
      sizes={!compact && sources?.srcSet ? photoSizes[layout] : undefined}
      src={compact && sources ? sources.compactSrc : image.url}
      {...imageAltAttributes(image, alt)}
      loading="lazy"
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      referrerPolicy={image.url.startsWith('https:') ? 'no-referrer' : undefined}
      onError={(event) => fail(event.currentTarget)}
    />
  );
}
