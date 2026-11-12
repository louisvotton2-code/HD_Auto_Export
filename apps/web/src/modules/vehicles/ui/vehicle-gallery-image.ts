import type { PublicMedia } from '@hd/contracts/public';

/** Renderable fields shared by published photos and authenticated staff preview photos. */
export type VehicleGalleryImage = Pick<PublicMedia, 'id' | 'url' | 'alt' | 'sortOrder' | 'isCover'> & {
  width?: number | null;
  height?: number | null;
  remote?: PublicMedia['remote'];
};

export type VehicleGalleryImageStatus = {
  imageId: string | null;
  requestKey: string | null;
  status: 'loading' | 'ready' | 'error';
};
