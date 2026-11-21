import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {Database} from '../db/index.js';
import type {InventoryService} from './service.js';
import {PublicInspectionConclusionSchema,type DisplayText,type Locale,type PublicInspectionEntry,type PublicVehicleSegmentQuery,type PublicVehicleInspectionQuery} from '@hd/contracts/public';
import {ApiError,conflict} from '../errors.js';
import {displayText,safeExternalDisplayText,safeExternalInspectionSummary} from '../external/normalize.js';
import {readVehicleEvidence} from '../external/sources/public-evidence.js';
import {emptyInspectionSummary} from '../external/sources/inspection-projection.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const Cursor=z.strictObject({id:z.string(),locale:z.enum(['zh','en','ru']),kind:z.enum(['inspection','price-history']),revision:z.string().regex(/^[a-f0-9]{64}$/),scope:z.string().regex(/^[a-f0-9]{64}$/).optional(),offset:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});

export function safeExternalDisplayPair(locale:Locale,item:{name:DisplayText;value:DisplayText}) {
 const name=safeExternalDisplayText(locale,item.name);
 const value=item.name.status==='ready'&&name.status==='missing'?displayText(locale,null):safeExternalDisplayText(locale,item.value);
 return {name,value};
}

export function safeExternalInspectionConclusion(locale:Locale,input:unknown){
 const item=PublicInspectionConclusionSchema.parse(input);
 return {...item,...safeExternalDisplayPair(locale,item)};
}

export function safeExternalInspectionEntry(locale:Locale,item:PublicInspectionEntry):PublicInspectionEntry {
 const entry=safeExternalDisplayPair(locale,item);
 const category=item.category&&safeExternalDisplayText(locale,item.category);
 const part=item.part&&safeExternalDisplayText(locale,item.part);
 const group=item.group&&safeExternalDisplayText(locale,item.group);
 const privateLabel=(item.category?.status==='ready'&&category?.status==='missing')
  ||(item.part?.status==='ready'&&part?.status==='missing')||(item.group?.status==='ready'&&group?.status==='missing');
 return {...item,...entry,category,part,...(group?{group}:{}),value:privateLabel?displayText(locale,null):entry.value};
}

export class VehicleEvidence {
 constructor(private db:Database,private inventory:InventoryService){}
 private async stamp(){const row=(await this.db.pool.query('SELECT epoch::text,revision::text FROM public_catalog_state WHERE id=1')).rows[0];if(!row)throw new Error('Catalog state missing');return digest(row);}
 async read(id:string,kind:'inspection'|'price-history',query:PublicVehicleSegmentQuery|PublicVehicleInspectionQuery){
  const filters=query as PublicVehicleInspectionQuery,scope=kind==='inspection'?digest([filters.category??null,filters.part??null,filters.outcome??null,filters.order??'source']):undefined;
  let cursor:z.infer<typeof Cursor>|undefined;
  if(query.cursor){try{if(!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new Error();cursor=Cursor.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString()));if(cursor.id!==id||cursor.kind!==kind||cursor.locale!==query.locale||cursor.scope!==scope)throw new Error();}catch{throw new ApiError(400,'INVALID_REQUEST','Invalid evidence cursor.');}}
  const before=await this.stamp();const vehicle=await this.inventory.getPublic(id,query.locale,'localized');const offset=cursor?.offset??0;
  const page=id.startsWith('ext-')?await this.db.transaction(async tx=>{
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   return readVehicleEvidence(tx,id.slice(4),query.locale,kind,offset,query.limit,filters);
  }):null;
  const after=await this.stamp();if(after!==before)throw conflict();
  const revision=digest([before,id,query.locale,kind,page?.sourceRevision??'none']);
  if(cursor&&cursor.revision!==revision)throw conflict();
  const items=page?.items??[],total=page?.total??0,next=offset+items.length;
  const reportPage=page?.summary!==undefined?page:null;
  const summary=reportPage?.summary??vehicle.inspectionSummary??emptyInspectionSummary(vehicle.report?.hasReport?'unavailable':'unknown');
  return {vehicleId:id,locale:query.locale,revision,total,items:reportPage?reportPage.items.map(item=>safeExternalInspectionEntry(query.locale,item)):items,
   nextCursor:next<total?Buffer.from(JSON.stringify({id,locale:query.locale,kind,revision,scope,offset:next})).toString('base64url'):null,
   ...(kind==='inspection'?{status:summary.status,summary:id.startsWith('ext-')?safeExternalInspectionSummary(query.locale,summary):summary,
    conclusions:reportPage?.conclusions.map(item=>safeExternalInspectionConclusion(query.locale,item))??[]}:{}),};
 }
}
