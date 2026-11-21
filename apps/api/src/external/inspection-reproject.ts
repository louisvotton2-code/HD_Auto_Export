import {z} from 'zod';
import type {Locale} from '@hd/contracts/public';
import type {Database} from '../db/index.js';
import {jsonHash} from './normalize.js';
import {loadSourceDocuments,type SourceIdentity} from './sources/documents.js';
import {selectInspection} from './sources/inspection-projection.js';
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

const InspectionWithholdOptions=z.strictObject({listingIds:z.array(z.uuid()).min(1).max(25)});
type WithholdRevision={locale:Locale;previousRevision:string;revision:string};
type WithholdReport={listingId:string;result:'withheld'|'rebuildable'|'skipped';revisions:WithholdRevision[]};

/** Change only the public status of explicitly selected old reports whose current source cannot rebuild them. */
export function withholdUnverifiableInspections(db:Database,input:z.input<typeof InspectionWithholdOptions>) {
 const listingIds=[...new Set(InspectionWithholdOptions.parse(input).listingIds.map(id=>id.toLowerCase()))].sort();
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await tx.query("SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='5s'; SET LOCAL transaction_timeout='20s'");
  await tx.query('SELECT pg_advisory_xact_lock(78291332)');
  const reports:WithholdReport[]=[];
  for(const listingId of listingIds){
   const listing=(await tx.query<{platform_id:SourceIdentity['source'];external_id:string}>(`SELECT l.platform_id,l.external_id
    FROM external_listings l WHERE l.id=$1 AND l.provider='chinacarapi' AND l.platform_id IN('che168','dongchedi')
    AND l.upstream_state='active' AND l.formal_primary
    AND EXISTS(SELECT 1 FROM external_catalog c WHERE c.listing_id=l.id) FOR NO KEY UPDATE`,[listingId])).rows[0];
   const report:WithholdReport={listingId,result:'skipped',revisions:[]};
   reports.push(report);
   if(!listing)continue;
   const identity:SourceIdentity={provider:'chinacarapi',source:listing.platform_id,externalId:listing.external_id};
   // Serialize with archive updates as well as the public supplier writer.
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[[identity.provider,identity.source,identity.externalId].join(':')]);
   const current=(await tx.query<{locale:Locale;source_revision:string}>(`SELECT locale,source_revision FROM external_vehicle_evidence_sets
    WHERE listing_id=$1 AND kind='inspection' AND status='available' ORDER BY locale FOR UPDATE`,[listingId])).rows;
   if(!current.length)continue;
   const sources=await loadSourceDocuments(tx,identity,'report');
   if(current.every(({locale})=>selectInspection(sources,identity,{},locale).status==='available')){
    report.result='rebuildable';
    continue;
   }
   const revisions=current.map(({locale,source_revision:previousRevision})=>({locale,previousRevision,
    revision:jsonHash(['inspection-withheld-unverifiable-v1',listingId,locale,previousRevision])}));
   const updated=await tx.query(`UPDATE external_vehicle_evidence_sets e SET status='unavailable',source_revision=r.revision
    FROM jsonb_to_recordset($2::jsonb) AS r(locale text,"previousRevision" text,revision text)
    WHERE e.listing_id=$1 AND e.kind='inspection' AND e.status='available' AND e.locale=r.locale
     AND e.source_revision=r."previousRevision"`,[listingId,JSON.stringify(revisions)]);
   if(updated.rowCount!==revisions.length)throw new Error('Inspection state changed during the maintenance batch.');
   report.result='withheld';
   report.revisions=revisions;
  }
  return {reports};
 });
}
