import {z} from 'zod';
import type {Database} from '../db/index.js';
import {loadSourceDocuments} from './sources/documents.js';
import {projectVehicleEvidence,refreshInspectionEvidence} from './sources/public-evidence.js';

export const InspectionReprojectOptions=z.strictObject({after:z.uuid().optional(),limit:z.number().int().min(1).max(100).default(25)});
/** Bounded offline projection repair: source heads are read under the normal writer lock; no import, media or inventory writes. */
export async function reprojectStoredInspections(db:Database,input:z.input<typeof InspectionReprojectOptions>){
 const {after,limit}=InspectionReprojectOptions.parse(input);
 const picked=await db.pool.query<{id:string}>(`SELECT l.id FROM external_listings l WHERE provider='chinacarapi' AND platform_id IN('che168','dongchedi')
  AND ($1::uuid IS NULL OR l.id>$1) AND EXISTS(SELECT 1 FROM external_source_heads h WHERE h.provider=l.provider AND h.source=l.platform_id AND h.external_id=l.external_id AND h.kind='detail')
  ORDER BY l.id LIMIT $2`,[after??null,limit]);
 let changed=0;
 for(const {id} of picked.rows)await db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(78291332)');
  const row=(await tx.query<{platform_id:'che168'|'dongchedi';external_id:string}>("SELECT platform_id,external_id FROM external_listings WHERE id=$1 AND provider='chinacarapi' FOR UPDATE",[id])).rows[0];if(!row)return;
  const documents=await loadSourceDocuments(tx,{provider:'chinacarapi',source:row.platform_id,externalId:row.external_id});
  if(!documents.some(d=>d.kind==='detail'))return;
  const projection=projectVehicleEvidence(documents);let updated=false;
  for(const locale of ['zh','en','ru'] as const){const result=await refreshInspectionEvidence(tx,id,locale,projection[locale].inspection);updated=updated||result;}
  if(updated)changed++;
 });
 return {scanned:picked.rows.length,changed,nextCursor:picked.rows.length===limit?picked.rows.at(-1)!.id:null};
}
