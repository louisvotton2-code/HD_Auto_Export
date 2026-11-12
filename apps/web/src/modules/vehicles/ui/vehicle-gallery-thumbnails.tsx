'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { publicMediaUrl } from '@/shared/lib/public-media';
import { Icon } from '@/shared/ui/icon';
import { detailContent } from '../detail-content';
import type { VehicleGalleryImage } from './vehicle-gallery-image';
import styles from './vehicle-gallery.module.css';

function ThumbnailImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (image.current?.complete && !image.current.naturalWidth) setFailed(true);
  }, [src]);

  if (failed) return <Icon name="car" size={19} />;
  return (
    <img
      ref={image}
      src={src}
      alt=""
      width={144}
      height={108}
      loading="lazy"
      fetchPriority="low"
      referrerPolicy={src.startsWith('https:') ? 'no-referrer' : undefined}
      onError={() => setFailed(true)}
    />
  );
}

export function VehicleGalleryThumbnails({
  images,
  index,
  locale,
  onSelect,
}: {
  images: VehicleGalleryImage[];
  index: number;
  locale: Locale;
  onSelect?: (index: number) => void;
}) {
  const rail = useRef<HTMLElement>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const t = detailContent[locale];

  useEffect(() => {
    const root = rail.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>('[data-remote-thumb]');
    if (!targets.length) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisibleIds(new Set(images.map((image) => image.id)));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const ready: string[] = [];
      for (const { isIntersecting, target } of entries) {
        const id = target.getAttribute('data-remote-thumb');
        if (!isIntersecting || !id) continue;
        ready.push(id);
        observer.unobserve(target);
      }
      if (ready.length) setVisibleIds((previous) => new Set([...previous, ...ready]));
    }, { root, rootMargin: '0px 72px' });
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [images]);

  useEffect(() => {
    const root = rail.current;
    const active = root?.querySelector('[aria-current="true"]');
    if (!root || !active) return;
    const strip = root.getBoundingClientRect();
    const selected = active.getBoundingClientRect();
    if (selected.left < strip.left) root.scrollLeft += selected.left - strip.left;
    else if (selected.right > strip.right) root.scrollLeft += selected.right - strip.right;
  }, [index]);

  return (
    <nav className={styles.thumbnails} ref={rail} aria-label={t.gallery} data-vehicle-thumbnails>
      {images.map((image, imageIndex) => {
        const local = image.url.startsWith('/api/v1/media/');
        const src = publicMediaUrl(image.url, { thumbnail: local });
        const load = local || imageIndex < 3 || imageIndex === index || visibleIds.has(image.id);
        return (
          <a
            key={image.id}
            className={styles.thumbnail}
            href={publicMediaUrl(image.url)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.showImage(imageIndex + 1)}
            aria-current={imageIndex === index ? 'true' : undefined}
            data-remote-thumb={local ? undefined : image.id}
            onClick={onSelect && ((event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onSelect(imageIndex);
            })}
          >
            {load
              ? <ThumbnailImage key={`${src}:${image.remote?.revision ?? 0}`} src={src} />
              : <Icon name="car" size={19} />}
          </a>
        );
      })}
    </nav>
  );
}
