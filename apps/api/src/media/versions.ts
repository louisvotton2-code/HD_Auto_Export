import { createHash } from 'node:crypto';
import type { PublicMedia } from '@hd/contracts/public';
import type { PoolClient } from 'pg';

export type MediaContentDigests = { original: string; thumb: string; card: string };
type QueryClient = Pick<PoolClient, 'query'>;
type VersionRow = { id: string } & MediaContentDigests;

export const mediaUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MEDIA_RECIPE = { displayDimension: 2400, displayQuality: 85, thumbWidth: 240, thumbQuality: 75,
  cardDimension: 800, cardQuality: 80 } as const;
const { displayDimension, displayQuality, thumbWidth, thumbQuality, cardDimension, cardQuality } = MEDIA_RECIPE;
// Bump v1 if resize or encoding semantics change beyond these parameters.
export const mediaRecipeRevision = createHash('sha256').update(['hd-auto:public-media:recipe:v1', displayDimension,
  displayQuality, thumbWidth, thumbQuality, cardDimension, cardQuality].join('\0')).digest('base64url');

export function mediaVersionToken({ original, thumb, card }: MediaContentDigests): string {
  return createHash('sha256').update(['hd-auto:public-media:actual-webp-bundle:v1', mediaRecipeRevision,
    original, thumb, card].join('\0')).digest('base64url');
}

// Use the current published source, and join on the asset's owner. A ready
// upload or a historical publication alone never qualifies for this address.
const currentPublicManualMedia = `FROM media_assets asset
  JOIN vehicles vehicle ON vehicle.id=asset.vehicle_id
  JOIN publication_media reference ON reference.media_id=asset.id AND reference.publication_id=vehicle.published_revision_id
  JOIN vehicle_publications publication ON publication.id=reference.publication_id`;
const publicManualConditions = `asset.state='ready' AND vehicle.publication_state='published'
  AND vehicle.deleted_at IS NULL AND publication.data #>> '{source,kind}'='manual'`;
const selectDigests = 'version.original_sha256 AS original,version.thumb_sha256 AS thumb,version.card_sha256 AS card';

export async function attachVersionedMediaUrls(tx: QueryClient, images: readonly PublicMedia[]): Promise<void> {
  const legacyId = (image: PublicMedia): string | undefined => {
    if (image.remote || !mediaUuidPattern.test(image.id)) return;
    const legacyUrl = `/api/v1/media/${image.id}`;
    if (image.url === legacyUrl || image.url === `${legacyUrl}/`) return image.id.toLowerCase();
  };
  const ids = [...new Set(images.map(legacyId).filter(id => id !== undefined))];
  if (!ids.length) return;
  const { rows } = await tx.query<VersionRow>(`SELECT asset.id,${selectDigests} ${currentPublicManualMedia}
    JOIN media_content_versions version ON version.media_id=asset.id
    WHERE asset.id=ANY($1::uuid[]) AND ${publicManualConditions}`, [ids]);
  const tokens = new Map(rows.map(row => [row.id, mediaVersionToken(row)]));
  for (const image of images) {
    const id = legacyId(image);
    const token = id && tokens.get(id);
    if (token) image.url = `/api/v1/media/${id}_${token}`;
  }
}

export async function findPublicMediaContentDigests(tx: QueryClient, id: string): Promise<MediaContentDigests | null> {
  const { rows } = await tx.query<MediaContentDigests>(`SELECT ${selectDigests} ${currentPublicManualMedia}
    JOIN media_content_versions version ON version.media_id=asset.id
    WHERE asset.id=$1 AND ${publicManualConditions}`, [id]);
  return rows[0] ?? null;
}

export async function saveMediaContentDigests(tx: QueryClient, id: string, digests: MediaContentDigests): Promise<boolean> {
  const { rowCount } = await tx.query(`INSERT INTO media_content_versions AS current_version
    (media_id,original_sha256,thumb_sha256,card_sha256) VALUES ($1,$2,$3,$4)
    ON CONFLICT (media_id) DO UPDATE SET original_sha256=excluded.original_sha256,
      thumb_sha256=excluded.thumb_sha256,card_sha256=excluded.card_sha256
    WHERE ROW(current_version.original_sha256,current_version.thumb_sha256,current_version.card_sha256)
      IS DISTINCT FROM ROW(excluded.original_sha256,excluded.thumb_sha256,excluded.card_sha256)`,
  [id, digests.original, digests.thumb, digests.card]);
  return rowCount === 1;
}

export async function selectPublicMediaBackfillIds(tx: QueryClient, after: string | null, limit: number, reconcile: boolean): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(`SELECT asset.id ${currentPublicManualMedia}
    WHERE ${publicManualConditions} AND ($1::uuid IS NULL OR asset.id>$1)
    ${reconcile ? '' : 'AND NOT EXISTS(SELECT 1 FROM media_content_versions version WHERE version.media_id=asset.id)'}
    ORDER BY asset.id LIMIT $2`, [after, limit]);
  return rows.map(row => row.id);
}

export async function lockPublicManualMedia(tx: PoolClient, id: string): Promise<boolean> {
  // Match the vehicle -> asset lock order used by upload, publication and GC.
  const vehicle = await tx.query(`SELECT vehicle.id ${currentPublicManualMedia}
    WHERE asset.id=$1 AND ${publicManualConditions} FOR UPDATE OF vehicle`, [id]);
  if (!vehicle.rowCount) return false;
  const asset = await tx.query(`SELECT asset.id ${currentPublicManualMedia}
    WHERE asset.id=$1 AND ${publicManualConditions} FOR UPDATE OF asset`, [id]);
  return Boolean(asset.rowCount);
}
