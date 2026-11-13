import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type PublicVehicleSegmentQuery, type PublicMedia, type PublicVehicleConfigurationResponse } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import type { InventoryService } from './service.js';
import { ApiError, conflict } from '../errors.js';
import { readSourceSegment } from '../external/sources/index.js';
import { displayText } from '../external/normalize.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const Cursor=z.strictObject({id:z.string(),locale:z.enum(['zh','en','ru']),kind:z.enum(['gallery','configuration']),revision:z.string().regex(/^[a-f0-9]{64}$/),offset:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)});
export class VehicleSegments {
  constructor(private db:Database,private inventory:InventoryService){}
  private async stamp(){const row=(await this.db.pool.query('SELECT epoch::text,revision::text FROM public_catalog_state WHERE id=1')).rows[0];if(!row)throw new Error('Catalog state missing.');return digest(row);}
  async read(id:string,kind:'gallery'|'configuration',query:PublicVehicleSegmentQuery){
    let cursor:z.infer<typeof Cursor>|undefined;
    if(query.cursor){try{if(!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new Error();cursor=Cursor.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));}catch{throw new ApiError(400,'INVALID_REQUEST','Invalid vehicle segment cursor.');}
      if(cursor.id!==id||cursor.locale!==query.locale||cursor.kind!==kind)throw new ApiError(400,'INVALID_REQUEST','Vehicle segment cursor belongs to another resource.');}
    const before=await this.stamp();
    // Reuses the exact public visibility/language gates; private previews never use this service.
    const vehicle=await this.inventory.getPublic(id,query.locale,'localized');
    const offset=cursor?.offset??0;
    let items:Array<PublicMedia|PublicVehicleConfigurationResponse['data']['items'][number]>;let total:number;let sourceRevision:string;
    const page=id.startsWith('ext-')?await this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return readSourceSegment(tx,id.slice(4),query.locale,kind==='gallery'?'photos':'configuration',offset,query.limit);
    }):null;
    if(page){items=page.items;total=page.total;sourceRevision=page.revision;}
    else {const all=kind==='gallery'?vehicle.images.map(photo=>({...photo,altText:photo.altText??vehicle.display?.mediaAlt.find(item=>item.mediaId===photo.id)?.value})):vehicle.configuration?.items??vehicle.external?.detail?.specifications.map((entry,index)=>({id:`spec-${index}-${digest(entry).slice(0,20)}`,name:displayText(query.locale,entry.name),value:displayText(query.locale,entry.value)}))??[];
      items=all.slice(offset,offset+query.limit);total=all.length;sourceRevision=digest(all);}
    const after=await this.stamp();if(after!==before)throw conflict();
    const revision=digest([before,id,query.locale,kind,sourceRevision]);
    if(cursor&&cursor.revision!==revision)throw conflict();
    const nextOffset=offset+items.length;
    return {vehicleId:id,locale:query.locale,revision,total,items,nextCursor:nextOffset<total?Buffer.from(JSON.stringify({id,locale:query.locale,kind,revision,offset:nextOffset})).toString('base64url'):null};
  }
}
