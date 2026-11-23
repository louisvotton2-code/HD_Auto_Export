import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ExternalUpsertCandidate } from '@hd/contracts/admin';

type Images = ExternalUpsertCandidate['images'];

/** Caller holds the supplier writer lock. One complete gallery owns visibility and ordering. */
export async function syncExternalMedia(tx: PoolClient, listingId: string, images: Images, observedAt: string) {
  const removed = await tx.query(`UPDATE external_media SET active=false
    WHERE listing_id=$1 AND active AND NOT(source_media_id=ANY($2::text[]))`,
  [listingId, images.map(image=>image.sourceMediaId)]);
  if (!images.length) return !!removed.rowCount;
  const incoming = images.map((image,position)=>({
    id:randomUUID(),source_media_id:image.sourceMediaId,url:image.url,width:image.width,height:image.height,
    alt:image.alt,position,expires_at:image.expiresAt,
  }));
  const written = await tx.query(`INSERT INTO external_media AS media
    (id,listing_id,source_media_id,url,width,height,alt,position,active,refreshed_at,expires_at)
    SELECT image.id,$1,image.source_media_id,image.url,image.width,image.height,coalesce(image.alt,'null'::jsonb),image.position,true,$2,image.expires_at
    FROM jsonb_to_recordset($3::jsonb) AS image(id uuid,source_media_id text,url text,width integer,height integer,
      alt jsonb,position integer,expires_at timestamptz)
    ON CONFLICT(listing_id,source_media_id) DO UPDATE SET
      url=excluded.url,width=excluded.width,height=excluded.height,alt=excluded.alt,position=excluded.position,
      active=true,refreshed_at=excluded.refreshed_at,expires_at=excluded.expires_at,
      revision=media.revision+CASE WHEN NOT media.active OR
        ROW(media.url,media.expires_at) IS DISTINCT FROM ROW(excluded.url,excluded.expires_at) THEN 1 ELSE 0 END
    WHERE ROW(media.active,media.url,media.width,media.height,coalesce(media.alt,'null'::jsonb),media.position,media.expires_at)
      IS DISTINCT FROM ROW(excluded.active,excluded.url,excluded.width,excluded.height,excluded.alt,excluded.position,excluded.expires_at)`,
  [listingId, observedAt, JSON.stringify(incoming)]);
  return !!removed.rowCount || !!written.rowCount;
}

export async function queueExpiredExternalMedia(tx: PoolClient, listingId: string) {
  await tx.query(`INSERT INTO external_media_refresh_requests(media_id,media_revision)
    SELECT m.id,m.revision FROM external_media m JOIN external_catalog c ON c.listing_id=m.listing_id
    WHERE m.listing_id=$1 AND m.active AND m.expires_at<=now() ON CONFLICT DO NOTHING`, [listingId]);
}
