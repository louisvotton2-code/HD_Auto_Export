'use client';

import { useState } from 'react';
import type { PublicMedia } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { reportExternalPhotoFailure } from '../application/report-external-photo-failure';
import { detailContent } from '../detail-content';
import styles from './vehicle-photo.module.css';

type Photo = Pick<PublicMedia, 'id' | 'url' | 'width' | 'height' | 'remote'>;

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
}: {
  image: Photo | null;
  locale: Locale;
  alt: string;
  compact?: boolean;
}) {
  if (!image) return <VehiclePhotoFallback locale={locale} compact={compact} />;
  return <PhotoResource key={`${image.id}:${image.url}:${image.remote?.revision ?? 0}`} image={image} locale={locale} alt={alt} compact={compact} />;
}

function PhotoResource({
  image,
  locale,
  alt,
  compact,
}: {
  image: Photo;
  locale: Locale;
  alt: string;
  compact: boolean;
}) {
  const [failed, setFailed] = useState(false);
  function fail() {
    setFailed(true);
    reportExternalPhotoFailure(image);
  }
  if (failed) return <VehiclePhotoFallback locale={locale} compact={compact} />;
  return (
    <img
      ref={(node) => {
        // The browser may finish the request before the client hydrates this card.
        if (node?.complete && node.naturalWidth === 0) fail();
      }}
      src={image.url}
      alt={alt}
      loading="lazy"
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      referrerPolicy={image.url.startsWith('https:') ? 'no-referrer' : undefined}
      onError={fail}
    />
  );
}
