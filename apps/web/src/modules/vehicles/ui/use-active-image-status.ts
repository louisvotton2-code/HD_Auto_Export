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
    let cancelled = false;
    // A child layout effect can run before its preview owner's layout setup, including
    // Strict Mode replay. Deliver in order after the commit and drop abandoned setups.
    const notify = (status: VehicleGalleryImageStatus['status']) => queueMicrotask(() => {
      if (!cancelled) onStatus({ imageId, requestKey: imageKey, status });
    });
    notify('loading');
    const currentImage = imageRef.current;
    if (!imageId || !imageKey || !currentImage) {
      notify('error');
      return () => { cancelled = true; };
    }

    const image = currentImage;
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
      notify(status);
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
        if (typeof image.decode === 'function') {
          await image.decode();
        } else if (typeof window.createImageBitmap === 'function') {
          // Older browsers still have to decode the authorized image before it can count.
          const decoded = await window.createImageBitmap(image);
          decoded.close?.();
        } else {
          failed();
          return;
        }
        finish(image.complete && image.naturalWidth > 0 ? 'ready' : 'error');
      } catch {
        failed();
      }
    }

    image.addEventListener('load', decodeImage);
    image.addEventListener('error', failed);
    // Leave room for the preview JSON's 15-second request within the admin's 40-second deadline.
    timer = setTimeout(failed, 24_000);
    // Hydration and a quick return can both encounter an already complete DOM image.
    if (image.complete) void decodeImage();
    return () => {
      cancelled = true;
      detach();
    };
  }, [imageRef, imageId, imageKey, onStatus]);
}
