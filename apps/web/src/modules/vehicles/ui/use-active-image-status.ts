'use client';

import { useLayoutEffect, type RefObject } from 'react';
import type { VehicleGalleryImageStatus } from './vehicle-gallery-image';

/** Staff readiness follows the current main image's real decode, independently of gallery caches. */
export function useActiveImageStatus({ imageRef, imageId, imageKey, onStatus }: {
  imageRef: RefObject<HTMLImageElement | null>;
  imageId: string | null;
  imageKey: string | null;
  onStatus?: (status: VehicleGalleryImageStatus) => void;
}) {
  useLayoutEffect(() => {
    if (!onStatus) return;
    onStatus({ imageId, requestKey: imageKey, status: 'loading' });
    const currentImage = imageRef.current;
    if (!imageId || !imageKey || !currentImage) {
      onStatus({ imageId, requestKey: imageKey, status: 'error' });
      return;
    }

    const image = currentImage;
    const notify = onStatus;
    let cancelled = false;
    let settled = false;
    let decoding = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ownsImage = () => !cancelled && !settled && imageRef.current === image
      && image.isConnected && image.dataset.galleryActiveImage === imageId;
    function detach() {
      clearTimeout(timer);
      image.removeEventListener('load', decodeImage);
      image.removeEventListener('error', failed);
    }
    function finish(status: 'ready' | 'error') {
      if (!ownsImage()) return;
      settled = true;
      detach();
      notify({ imageId, requestKey: imageKey, status });
    }
    function failed() {
      finish('error');
    }
    async function decodeImage() {
      if (!ownsImage() || decoding || !image.complete) return;
      if (image.naturalWidth <= 0) {
        failed();
        return;
      }
      decoding = true;
      try {
        await image.decode();
        finish(image.complete && image.naturalWidth > 0 ? 'ready' : 'error');
      } catch {
        failed();
      }
    }

    image.addEventListener('load', decodeImage);
    image.addEventListener('error', failed);
    timer = setTimeout(failed, 15_000);
    // Hydration and a quick return can both encounter an already complete DOM image.
    if (image.complete) void decodeImage();
    return () => {
      cancelled = true;
      detach();
    };
  }, [imageRef, imageId, imageKey, onStatus]);
}
