import { queueExpiredExternalMedia, syncExternalMedia } from '../media-rows.js';
import {refreshVehicleEvidence} from './public-evidence.js';
import type { PoolClient } from 'pg';
import { PublicMediaSchema, DisplayTextSchema, type PublicMedia, type Locale } from '@hd/contracts/public';
import { jsonHash, displayText } from '../normalize.js';
import type { FullSourceProjection, SourceConfigurationItem } from './mapping.js';
export type SegmentKind='photos'|'configuration';
export type SourceSegmentPage={items:(PublicMedia|SourceConfigurationItem)[];total:number;revision:string};
/** Must run after catalog projection, in the same transaction, before the worker checkpoint commits. */
export async function refreshSourceSegments(tx:PoolClient,listingId:string,projection:FullSourceProjection,observedAt:string){
  const photos:PublicMedia[]=[];
  const mediaChanged=await syncExternalMedia(tx,listingId,projection.fullPhotos,observedAt);
  const stored=projection.fullPhotos.length
    ? (await tx.query<{source_media_id:string;id:string;revision:number;refreshed_at:Date}>(`SELECT source_media_id,id,revision,refreshed_at
      FROM external_media WHERE listing_id=$1 AND active`,[listingId])).rows : [];
  const bySource=new Map(stored.map(row=>[row.source_media_id,row]));
  for(const [position,photo] of projection.fullPhotos.entries()){
    // Expired photos remain in private evidence/media records, never promoted to the public gallery.
    if(photo.expiresAt&&Date.parse(photo.expiresAt)<=Date.parse(observedAt))continue;
    const row=bySource.get(photo.sourceMediaId)!;
    photos.push(PublicMediaSchema.parse({id:`ximg-${row.id}`,url:photo.url,alt:photo.alt?.text??'',width:photo.width,height:photo.height,sortOrder:position,isCover:photos.length===0,
      remote:{revision:row.revision,refreshedAt:row.refreshed_at.toISOString(),expiresAt:photo.expiresAt}}));
  }
  await queueExpiredExternalMedia(tx,listingId);
  let changed=await refreshVehicleEvidence(tx,listingId,projection.evidence)||mediaChanged;
  let configurationChanged=false;
  for(const locale of ['zh','en','ru'] as const)for(const kind of ['photos','configuration'] as const){
    const items=kind==='photos'?photos.map(photo=>({...photo,altText:displayText(locale,projection.fullPhotos[photo.sortOrder]?.alt??null)})):projection.fullConfiguration[locale];
    if(kind==='configuration')for(const item of projection.fullConfiguration[locale]){DisplayTextSchema.parse(item.name);DisplayTextSchema.parse(item.value);}
    const revision=jsonHash([listingId,locale,kind,items]);
    const result=await tx.query(`INSERT INTO external_source_segment_sets(listing_id,locale,kind,revision,total) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(listing_id,locale,kind) DO UPDATE SET revision=excluded.revision,total=excluded.total
      WHERE external_source_segment_sets.revision<>excluded.revision RETURNING listing_id`,[listingId,locale,kind,revision,items.length]);
    if(!result.rowCount)continue;
    changed=true;
    if(kind==='configuration')configurationChanged=true;
    await tx.query('DELETE FROM external_source_segments WHERE listing_id=$1 AND locale=$2 AND kind=$3',[listingId,locale,kind]);
    for(let offset=0;offset<items.length;offset+=200){const chunk=items.slice(offset,offset+200);await tx.query(`INSERT INTO external_source_segments(listing_id,locale,kind,position,data)
      SELECT $1,$2,$3,$4+ordinality-1,value FROM jsonb_array_elements($5::jsonb) WITH ORDINALITY AS entry(value,ordinality)`,[listingId,locale,kind,offset,JSON.stringify(chunk)]);}
  }
  if(configurationChanged)await tx.query(`SELECT queue_public_catalog_metadata_change()
    WHERE EXISTS(SELECT FROM external_catalog_filter WHERE listing_id=$1 AND active AND locale_mask<>0)`,[listingId]);
  return {changed,mediaTotal:photos.length,configurationTotal:Object.fromEntries(Object.entries(projection.fullConfiguration).map(([locale,items])=>[locale,items.length]))};
}
/** Caller must enforce current listing visibility and expected revision. One SQL snapshot prevents mixed pagination metadata. */
export async function readSourceSegment(tx:Pick<PoolClient,'query'>,listingId:string,locale:Locale,kind:SegmentKind,offset:number,limit:number):Promise<SourceSegmentPage|null>{
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid source page bounds.');
  if(kind==='photos'){
    const result=await tx.query<{revision:string;total:number;items:PublicMedia[];visible:string[]}>(`WITH visible AS MATERIALIZED (
      SELECT jsonb_set(p.data,'{isCover}',to_jsonb(row_number() OVER(ORDER BY p.position)=1)) AS data,p.position,m.id::text AS id,m.revision FROM external_source_segments p
      JOIN external_media m ON m.id=(''||substring(p.data->>'id' from 6))::uuid AND m.listing_id=p.listing_id
      WHERE p.listing_id=$1 AND p.locale=$2 AND p.kind='photos' AND m.active AND (m.expires_at IS NULL OR m.expires_at>now()))
      SELECT s.revision,(SELECT count(*)::int FROM visible) AS total,
      COALESCE((SELECT jsonb_agg(data ORDER BY position) FROM (SELECT data,position FROM visible ORDER BY position OFFSET $3 LIMIT $4) page),'[]'::jsonb) AS items,
      COALESCE((SELECT jsonb_agg(id||':'||revision ORDER BY position) FROM visible),'[]'::jsonb) AS visible
      FROM external_source_segment_sets s WHERE s.listing_id=$1 AND s.locale=$2 AND s.kind='photos'`,[listingId,locale,offset,limit]);
    const row=result.rows[0];return row?{total:row.total,items:row.items,revision:jsonHash([listingId,locale,kind,row.revision,row.visible])}:null;
  }
  const result=await tx.query<{total:number;revision:string;items:SourceConfigurationItem[]}>(`SELECT s.total,s.revision,
    COALESCE((SELECT jsonb_agg(p.data ORDER BY p.position) FROM (SELECT data,position FROM external_source_segments WHERE listing_id=s.listing_id AND locale=s.locale AND kind=s.kind AND position >= $4 ORDER BY position LIMIT $5) p),'[]'::jsonb) AS items
    FROM external_source_segment_sets s WHERE listing_id=$1 AND locale=$2 AND kind=$3`,[listingId,locale,kind,offset,limit]);
  return result.rows[0]??null;
}
