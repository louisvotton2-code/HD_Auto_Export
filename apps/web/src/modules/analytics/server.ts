import { getPublicPixelId } from './pixel-config';

export function getConfiguredPixelId() {
  return getPublicPixelId(process.env.HD_META_PIXEL_ENABLED, process.env.HD_META_PIXEL_ID);
}
