import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {Database} from '../db/index.js';
import type {InventoryService} from './service.js';
import type {PublicVehicleSegmentQuery} from '@hd/contracts/public';
import {ApiError,conflict} from '../errors.js';
import {readVehicleEvidence} from '../external/sources/index.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const Cursor=z.strictObject({id:z.string(),locale:z.enum(['zh','en','ru']),kind:z.enum(['inspection','price-history']),revision:z.string().regex(/^[a-f0-9]{64}$/),offset:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export class VehicleEvidence {
 constructor(private db:Database,private inventory:InventoryService){}
 private async stamp(){const row=(await this.db.pool.query('SELECT epoch::text,revision::text FROM public_catalog_state WHERE id=1')).rows[0];if(!row)throw new Error('Catalog state missing');return digest(row);}
 async read(id:string,kind:'inspection'|'price-history',query:PublicVehicleSegmentQuery){
  let cursor:z.infer<typeof Cursor>|undefined;
  if(query.cursor){try{if(!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new Error();cursor=Cursor.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString()));if(cursor.id!==id||cursor.kind!==kind||cursor.locale!==query.locale)throw new Error();}catch{throw new ApiError(400,'INVALID_REQUEST','Invalid evidence cursor.');}}
  const before=await this.stamp();const vehicle=await this.inventory.getPublic(id,query.locale,'localized');const offset=cursor?.offset??0;
  const page=id.startsWith('ext-')?await this.db.transaction(async tx=>{
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   return readVehicleEvidence(tx,id.slice(4),query.locale,kind,offset,query.limit);
  }):null;
  const after=await this.stamp();if(after!==before)throw conflict();
  const revision=digest([before,id,query.locale,kind,page?.sourceRevision??'none']);
  if(cursor&&cursor.revision!==revision)throw conflict();
  const items=page?.items??[],total=page?.total??0,next=offset+items.length;
  return {vehicleId:id,locale:query.locale,revision,total,items,nextCursor:next<total?Buffer.from(JSON.stringify({id,locale:query.locale,kind,revision,offset:next})).toString('base64url'):null,
   ...(kind==='inspection'?{status:page?.status??(vehicle.report?.hasReport?'unavailable':'no_report')}:{}),};
 }
}
