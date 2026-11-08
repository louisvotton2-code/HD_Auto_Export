import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { MediaAssetSchema, type MediaUploadRequest, type MediaRights } from '@hd/contracts/admin';
import type { Database } from '../db/index.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { LocalMediaStore } from './storage.js';
import { audit, type Actor } from '../vehicles/service.js';

type MediaRow = {id:string;vehicle_id:string;version:number;state:'pending'|'uploaded'|'ready'|'failed'|'deleted';content_type:'image/jpeg'|'image/png'|'image/webp';
  width:number|null;height:number|null;byte_size:number|null;expected_size:number;expires_at:Date;created_at:Date;rights:MediaRights};
const dto=(r:MediaRow)=>MediaAssetSchema.parse({id:r.id,vehicleId:r.vehicle_id,version:r.version,status:r.state,contentType:r.content_type,
  sizeBytes:r.expected_size,width:r.width,height:r.height,rights:r.rights,previewPath:r.state==='ready'?`/api/v1/admin/media/${r.id}/preview`:null,createdAt:r.created_at.toISOString()});

export class MediaService {
  constructor(private db:Database,private store:LocalMediaStore) {}
  private async lock(tx:PoolClient,id:string,version?:number) {
    const preliminary=await tx.query<MediaRow>('SELECT * FROM media_assets WHERE id=$1',[id]);
    const media=preliminary.rows[0];if(!media) throw notFound();
    // All media mutations and publication use vehicle -> media lock order.
    await tx.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE',[media.vehicle_id]);
    const row=(await tx.query<MediaRow>('SELECT * FROM media_assets WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row || row.state==='deleted') throw notFound();
    if(version!==undefined&&row.version!==version) throw conflict();
    return row;
  }
  async create(input:MediaUploadRequest,actor:Actor) {
    return this.db.transaction(async tx=>{
      const vehicle=await tx.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE',[input.vehicleId]);
      if(!vehicle.rowCount) throw notFound();
      const count=await tx.query(`SELECT count(*)::int AS count FROM media_assets m WHERE m.vehicle_id=$1 AND m.state<>'deleted'
        AND (NOT EXISTS(SELECT 1 FROM publication_media pm WHERE pm.media_id=m.id)
          OR EXISTS(SELECT 1 FROM vehicle_drafts d WHERE d.vehicle_id=m.vehicle_id AND d.data->'media' @> jsonb_build_array(jsonb_build_object('id',m.id))))`,[input.vehicleId]);
      if(count.rows[0].count>=30) throw new ApiError(422,'PUBLISH_VALIDATION_FAILED','A vehicle can have at most 30 active images.');
      const id=randomUUID();
      const result=await tx.query<MediaRow>(`INSERT INTO media_assets(id,vehicle_id,content_type,expected_size,rights,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes') RETURNING *`,[id,input.vehicleId,input.contentType,input.sizeBytes,JSON.stringify(input.rights)]);
      const row=result.rows[0]!;
      await audit(tx,actor,'media.create',input.vehicleId,null,1);
      return {media:dto(row),method:'PUT' as const,uploadUrl:`/api/v1/admin/media/${id}/content`,expiresAt:row.expires_at.toISOString()};
    });
  }
  async upload(id:string,version:number,bytes:Buffer,contentType:string,actor:Actor) {
    return this.db.transaction(async tx=>{
      const row=await this.lock(tx,id,version);
      if(row.state!=='pending'||row.expires_at.getTime()<Date.now()) throw new ApiError(409,'MEDIA_NOT_READY','Upload permit has expired or is already used.');
      if(bytes.length!==row.expected_size||contentType!==row.content_type) throw new ApiError(400,'INVALID_REQUEST','Upload does not match its declared size and type.');
      const result=await this.store.put(id,bytes,contentType);
      const updated=await tx.query<MediaRow>("UPDATE media_assets SET state='uploaded',width=$2,height=$3,byte_size=$4,version=version+1 WHERE id=$1 RETURNING *",[id,result.width,result.height,result.byteSize]);
      await audit(tx,actor,'media.upload',row.vehicle_id,version,version+1);
      return dto(updated.rows[0]!);
    });
  }
  async complete(id:string,version:number,actor:Actor) {
    return this.db.transaction(async tx=>{
      const row=await this.lock(tx,id,version);
      if(row.state==='ready') return dto(row);
      if(row.state!=='uploaded') throw new ApiError(422,'MEDIA_NOT_READY','Upload and image validation must finish first.');
      await this.store.read(id);
      const updated=await tx.query<MediaRow>("UPDATE media_assets SET state='ready',expires_at=now()+interval '24 hours',version=version+1 WHERE id=$1 RETURNING *",[id]);
      await audit(tx,actor,'media.complete',row.vehicle_id,version,version+1);
      return dto(updated.rows[0]!);
    });
  }
  async get(id:string) {
    const row=(await this.db.pool.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 AND state<>'deleted'",[id])).rows[0];
    if(!row) throw notFound();return dto(row);
  }
  async preview(id:string) {
    const row=(await this.db.pool.query<MediaRow>("SELECT * FROM media_assets WHERE id=$1 AND state='ready'",[id])).rows[0];
    if(!row) throw notFound();return this.store.read(id);
  }
  async publicRead(id:string) {
    const allowed=await this.db.pool.query(`SELECT 1 FROM media_assets m JOIN publication_media pm ON pm.media_id=m.id
      JOIN vehicles v ON v.published_revision_id=pm.publication_id WHERE m.id=$1 AND m.state='ready' AND v.publication_state='published' LIMIT 1`,[id]);
    if(!allowed.rowCount) throw notFound();return this.store.read(id);
  }
  async remove(id:string,version:number,actor:Actor) {
    await this.db.transaction(async tx=>{
      const row=await this.lock(tx,id,version);
      const historical=await tx.query('SELECT 1 FROM publication_media WHERE media_id=$1 LIMIT 1',[id]);
      const draft=await tx.query('SELECT 1 FROM vehicle_drafts WHERE vehicle_id=$1 AND data->\'media\' @> $2::jsonb',[row.vehicle_id,JSON.stringify([{id}])]);
      if(historical.rowCount||draft.rowCount) throw new ApiError(409,'MEDIA_IN_USE','Remove draft references first; publication history references are protected.');
      await tx.query("UPDATE media_assets SET state='deleted',version=version+1 WHERE id=$1",[id]);
      await audit(tx,actor,'media.delete',row.vehicle_id,version,version+1);
    });
    // Visibility is revoked before unlink; cleanup may safely retry an interrupted removal.
    await this.store.remove(id);
  }
  async cleanupExpired() {
    const candidates=await this.db.pool.query<MediaRow>(`SELECT m.* FROM media_assets m
      WHERE (m.state='deleted' OR m.expires_at<now())
      AND NOT EXISTS(SELECT 1 FROM publication_media pm WHERE pm.media_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM vehicle_drafts d WHERE d.vehicle_id=m.vehicle_id AND d.data->'media' @> jsonb_build_array(jsonb_build_object('id',m.id)))
      ORDER BY m.created_at LIMIT 100`);
    let removed=0;
    for(const candidate of candidates.rows) {
      const safe=await this.db.transaction(async tx=>{
        await tx.query('SELECT id FROM vehicles WHERE id=$1 FOR UPDATE',[candidate.vehicle_id]);
        const row=(await tx.query<MediaRow>('SELECT * FROM media_assets WHERE id=$1 FOR UPDATE',[candidate.id])).rows[0];
        if(!row) return false;
        if(row.state!=='deleted' && row.expires_at.getTime()>=Date.now()) return false;
        const references=await tx.query(`SELECT 1 FROM publication_media WHERE media_id=$1 UNION ALL SELECT 1 FROM vehicle_drafts WHERE vehicle_id=$2 AND data->'media' @> $3::jsonb LIMIT 1`,[row.id,row.vehicle_id,JSON.stringify([{id:row.id}])]);
        if(references.rowCount) return false;
        await tx.query("UPDATE media_assets SET state='deleted',version=version+1 WHERE id=$1 AND state<>'deleted'",[row.id]);
        return true;
      });
      if(safe) {
        await this.store.remove(candidate.id);
        // Only unreferenced deleted rows reach here; removing them prevents a permanent first-page cleanup loop.
        await this.db.pool.query("DELETE FROM media_assets WHERE id=$1 AND state='deleted'",[candidate.id]);
        removed++;
      }
    }
    await this.db.pool.query('DELETE FROM idempotency_keys WHERE expires_at<now()');
    return {removed};
  }
}
