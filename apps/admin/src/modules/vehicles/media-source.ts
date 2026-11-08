import { MediaRightsSchema, type MediaRights, type VehicleDraftSource } from '@hd/contracts/admin';

/** Snapshot each file's provenance before the upload queue begins. */
export function uploadRightsForFiles(source: VehicleDraftSource, count: number, basis: MediaRights['basis'], note: string, imageUrls: string, collectedAt: string): MediaRights[] {
  if (source.kind !== 'external') {
    if (basis === 'unverified') throw new Error('人工车源和展示样例需要自有或已授权图片。');
    const rights = MediaRightsSchema.parse({ basis, note: note.trim() });
    return Array.from({ length: count }, () => structuredClone(rights));
  }
  const urls = imageUrls.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (urls.length !== count) throw new Error(`请为本次 ${count} 张图片逐行填写 ${count} 个原图地址，顺序与文件一致。`);
  const instant = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(collectedAt) ? new Date(`${collectedAt}Z`) : new Date(Number.NaN);
  if (!Number.isFinite(instant.getTime())) throw new Error('请填写有效的图片采集时间（UTC）。');
  return urls.map(imageUrl => {
    const parsed = MediaRightsSchema.safeParse({ basis, note: note.trim(), source: { listingUrl: source.listingUrl, imageUrl, collectedAt: instant.toISOString() } });
    if (!parsed.success) throw new Error('请检查图片原始地址与来源说明；地址需为不含账号密码的 HTTP(S) 链接。');
    return parsed.data;
  });
}
