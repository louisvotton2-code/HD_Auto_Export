'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { usePublicVehicleSegment } from '../application/use-public-vehicle-segment';
import { VehicleGallery } from './vehicle-gallery';
import { withImageAltText } from '../vehicle-image-text';
import styles from './public-vehicle-gallery.module.css';

type GalleryCopy = {
  shown: (count: string) => string;
  progress: (loaded: string, total: string) => string;
  position: (position: string, loaded: string) => string;
  more: string;
  loading: string;
  retry: string;
  restart: string;
  unavailable: string;
  changed: string;
  missing: string;
  wait: (seconds: string) => string;
  noScript: string;
};

const copy = {
  zh: {
    shown: (count: string) => `已显示 ${count} 张照片`,
    progress: (loaded: string, total: string) => `已加载 ${loaded} / ${total} 张照片`,
    position: (position: string, loaded: string) => `第 ${position} 张 · 已显示 ${loaded} 张`,
    more: '加载更多照片', loading: '正在加载照片…', retry: '重试加载', restart: '重新加载相册',
    unavailable: '照片暂时无法加载，请重试。', changed: '照片已更新，请重新加载相册。', missing: '此车辆的照片暂时无法查看。',
    wait: (seconds: string) => `请在 ${seconds} 秒后重试。`, noScript: '启用 JavaScript 后可分段浏览更多照片。',
  },
  en: {
    shown: (count: string) => `${count} photos shown`,
    progress: (loaded: string, total: string) => `${loaded} of ${total} photos loaded`,
    position: (position: string, loaded: string) => `Photo ${position} · ${loaded} shown`,
    more: 'Load more photos', loading: 'Loading photos…', retry: 'Retry loading', restart: 'Reload photos',
    unavailable: 'Photos could not be loaded. Please try again.', changed: 'The photos have changed. Reload the gallery.', missing: 'Photos for this vehicle are currently unavailable.',
    wait: (seconds: string) => `Try again in ${seconds} seconds.`, noScript: 'Enable JavaScript to browse more photos in sections.',
  },
  ru: {
    shown: (count: string) => `Показано фото: ${count}`,
    progress: (loaded: string, total: string) => `Загружено фото: ${loaded} из ${total}`,
    position: (position: string, loaded: string) => `Фото ${position} · показано ${loaded}`,
    more: 'Загрузить ещё фото', loading: 'Загрузка фотографий…', retry: 'Повторить загрузку', restart: 'Обновить фотографии',
    unavailable: 'Не удалось загрузить фотографии. Попробуйте ещё раз.', changed: 'Фотографии изменились. Обновите галерею.', missing: 'Фотографии этого автомобиля сейчас недоступны.',
    wait: (seconds: string) => `Повторите через ${seconds} сек.`, noScript: 'Включите JavaScript, чтобы просматривать остальные фотографии по частям.',
  },
} satisfies Record<Locale, GalleryCopy>;

/** Only published details load public segments; staff preview keeps the shared gallery's decode boundary. */
export function PublicVehicleGallery({ vehicle, title, locale }: { vehicle: PublicVehicle; title: string; locale: Locale }) {
  const resource = usePublicVehicleSegment('gallery', vehicle, locale);
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => setEnhanced(true), []);
  const t = copy[locale];
  const number = (value: number) => value.toLocaleString(locale);
  // The first segment is a fresh complete page, not an extension of the SSR preview.
  const rawImages = resource.started ? resource.items : vehicle.images;
  const images = useMemo(() => rawImages.map(image => withImageAltText(image, vehicle.display?.mediaAlt)), [rawImages, vehicle.display?.mediaAlt]);
  const total = resource.started ? resource.total : (vehicle.mediaTotal ?? null);
  const loading = resource.phase === 'loading';
  const changed = resource.phase === 'changed';
  const missing = resource.phase === 'missing';
  const error = resource.phase === 'error';
  const waiting = resource.retryAfter > 0;
  // Before the first page, an unknown count does not establish that additional photos exist.
  const hasMore = resource.started ? resource.hasMore : total !== null && total > images.length;
  const canLoad = !missing && !changed && (hasMore || error);
  const summary = total === null ? t.shown(number(images.length)) : t.progress(number(images.length), number(total));

  function open() {
    // Reopening an already loaded viewer must not fetch the next page implicitly.
    if (!resource.started && !loading && !waiting) resource.loadMore();
  }

  function controls(placement: 'inline' | 'viewer') {
    return (
      <div className={`${styles.controls} ${placement === 'viewer' ? styles.viewerControls : ''}`}
        data-public-gallery-pagination={placement} aria-busy={loading}>
        {!changed && !missing && <p className={styles.summary} data-gallery-progress>{summary}</p>}
        {(loading || changed || missing || error || waiting) && (
          <p className={styles.message} role="status">
            {loading ? t.loading : changed ? t.changed : missing ? t.missing : waiting ? t.wait(number(resource.retryAfter)) : t.unavailable}
          </p>
        )}
        {enhanced && changed ? (
          <button type="button" className={styles.button} onClick={resource.restart} disabled={loading || waiting} data-gallery-restart>{t.restart}</button>
        ) : enhanced && canLoad ? (
          <button type="button" className={styles.button} onClick={resource.loadMore} disabled={loading || waiting} data-gallery-load-more>
            {loading ? t.loading : error ? t.retry : t.more}
          </button>
        ) : null}
        {placement === 'inline' && hasMore && <noscript><p className={styles.message}>{t.noScript}</p></noscript>}
      </div>
    );
  }

  return (
    <section data-public-vehicle-gallery={vehicle.id}>
      <VehicleGallery images={images} title={title} locale={locale} onOpen={open}
        imagePosition={(position, loaded) => total === null ? t.position(number(position), number(loaded)) : `${number(position)} / ${number(total)}`}
        viewerFooter={controls('viewer')} />
      {controls('inline')}
    </section>
  );
}
