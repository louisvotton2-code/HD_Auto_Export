import type { DraftMedia, MediaAsset, MediaContentType } from '@hd/contracts/admin';

export const MAX_MEDIA_COUNT = 30;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const acceptedTypes: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export function validateMediaFile(file: { name: string; type: string; size: number }): string | null {
  if (!acceptedTypes.includes(file.type)) return '仅支持 JPEG、PNG 或 WebP 图片。';
  if (file.size < 1) return '不能上传空文件。';
  if (file.size > MAX_MEDIA_BYTES) return '单张图片不能超过 10 MiB。';
  if (!file.name || file.name.length > 255 || /[/\\\u0000-\u001f]/.test(file.name)) return '图片文件名过长或含有不支持的字符，请重命名后上传。';
  return null;
}

/** Sorting/cover edits do not discard IDs, alt text, or the employee's explicit cover. */
export function normalizeMedia(media: readonly DraftMedia[]): DraftMedia[] {
  return media.map((item, sortOrder) => ({ ...item, sortOrder }));
}

export function appendReadyMedia(current: readonly DraftMedia[], asset: MediaAsset, alt = ''): DraftMedia[] {
  if (asset.status !== 'ready') throw new Error('图片尚未处理完成，不能加入草稿。');
  if (current.some(item => item.id === asset.id)) return [...current];
  if (current.length >= MAX_MEDIA_COUNT) throw new Error('草稿最多可加入 30 张图片，请先移除不需要的图片。');
  return normalizeMedia([...current, { id: asset.id, alt, sortOrder: current.length, isCover: current.length === 0 }]);
}

export type MediaTransport = {
  get: (id: string) => Promise<MediaAsset>;
  upload: (asset: MediaAsset, file: Blob, contentType: MediaContentType) => Promise<MediaAsset>;
  complete: (asset: MediaAsset) => Promise<MediaAsset>;
};

export type MediaRecycleTransport = {
  get: (id: string) => Promise<MediaAsset | null>;
  remove: (asset: MediaAsset) => Promise<void>;
};

/** Check current references, then recover the server's latest version before recycling. */
export async function recycleMediaAsset(
  id: string,
  vehicleId: string,
  currentIds: readonly string[],
  savedIds: readonly string[],
  transport: MediaRecycleTransport,
): Promise<void> {
  if (currentIds.includes(id)) throw new Error('请先从当前草稿移除这张图片。');
  if (savedIds.includes(id)) throw new Error('请先保存草稿，使图片移除生效后再回收。');
  const asset = await transport.get(id);
  if (!asset) return; // A prior successful delete may have lost its response.
  if (asset.id !== id || asset.vehicleId !== vehicleId) throw new Error('图片记录与当前车辆不一致，无法回收。');
  await transport.remove(asset);
}

/** A lost response is recovered from the actual server version before any further write. */
export async function finishMediaUpload(
  initial: MediaAsset,
  file: Blob,
  recover: boolean,
  transport: MediaTransport,
  onAsset: (asset: MediaAsset) => void = () => undefined,
): Promise<MediaAsset> {
  let asset = recover ? await transport.get(initial.id) : initial;
  const check = (next: MediaAsset) => {
    if (next.id !== initial.id || next.vehicleId !== initial.vehicleId) throw new Error('图片记录与当前上传任务不一致，请重新核对。');
    asset = next; onAsset(next);
  };
  check(asset);
  if (asset.status === 'pending') check(await transport.upload(asset, file, asset.contentType));
  if (asset.status === 'uploaded') check(await transport.complete(asset));
  if (asset.status !== 'ready') throw new Error('这张图片当前无法继续上传，请核对图片状态后重新选择文件。');
  return asset;
}
