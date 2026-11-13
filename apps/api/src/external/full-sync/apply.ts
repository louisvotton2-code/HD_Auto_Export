import type {PoolClient} from 'pg';
import {applyFormalCandidate,reprojectFormalListing} from '../store.js';
import {adaptSourceDocuments,loadSourceDocuments,persistSourceDocument,refreshSourceSegments} from '../sources/index.js';
import {SERVICE_ACTOR} from '../ingestion/worker.js';
import {FullSyncError,type FullApply,type Source} from './types.js';
export async function ensureMember(tx:PoolClient,source:Source,id:string){
 const legacy=(await tx.query("SELECT l.formal_canonical_id,l.upstream_state,l.fetched_at,i.business_order,i.business_at FROM external_listings l LEFT JOIN external_ingestion_identity_state i ON i.provider=l.provider AND i.source=l.platform_id AND i.external_id=l.external_id WHERE l.provider='chinacarapi' AND l.platform_id=$1 AND l.external_id=$2",[source,id])).rows[0];
 const canonical=legacy?.formal_canonical_id??`chinacarapi:${source}:${id}`;
 await tx.query('INSERT INTO external_full_members(source,external_id,canonical_id,state,event_order,business_at,locales,last_detail_at,applied_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
  [source,id,canonical,legacy?legacy.upstream_state:'pending',legacy?.business_order??'0',legacy?.business_at??legacy?.fetched_at??new Date(0),legacy?.upstream_state==='active'?['zh','en','ru']:[],legacy?.fetched_at??null,legacy?1:0]);
 return (await tx.query('SELECT * FROM external_full_members WHERE source=$1 AND external_id=$2 FOR UPDATE',[source,id])).rows[0]!;
}
export function parseAlias(value:unknown):{source:Source;id:string}|null{
 if(typeof value!=='string')return null;const match=/^(che168|dongchedi)[:/](\d{1,100})$/.exec(value);return match?{source:match[1] as Source,id:match[2]!}:null;
}
/** Verified provider associations merge publication groups, never stable listing IDs or per-source manual overrides. */
export async function bindAlias(tx:PoolClient,source:Source,id:string,target:{source:Source;id:string},at:string){
 await tx.query('SELECT pg_advisory_xact_lock(78291332)');
 const left=await ensureMember(tx,source,id),right=await ensureMember(tx,target.source,target.id);
 await tx.query(`INSERT INTO external_full_aliases VALUES($1,$2,$3,$4,$5) ON CONFLICT(source,external_id) DO UPDATE SET target_source=excluded.target_source,target_id=excluded.target_id,observed_at=excluded.observed_at WHERE external_full_aliases.observed_at<=excluded.observed_at`,[source,id,target.source,target.id,at]);
 if(left.canonical_id===right.canonical_id)return;
 const bindings=(await tx.query("SELECT canonical_id,created_at FROM external_canonical_bindings WHERE provider='chinacarapi' AND canonical_id=ANY($1::text[]) ORDER BY created_at,canonical_id",[[left.canonical_id,right.canonical_id]])).rows;
 const keep=bindings[0]?.canonical_id??[left.canonical_id,right.canonical_id].sort()[0],drop=keep===left.canonical_id?right.canonical_id:left.canonical_id;
 // Keep public UUIDs and overrides in place; new representative is selected atomically after a qualified apply.
 const old=(await tx.query("UPDATE external_listings SET formal_primary=false WHERE provider='chinacarapi' AND formal_canonical_id=$1 RETURNING id",[drop])).rows;
 for(const listing of old)await reprojectFormalListing(tx,listing.id);
 await tx.query("UPDATE external_listings SET formal_canonical_id=$1 WHERE provider='chinacarapi' AND formal_canonical_id=$2",[keep,drop]);
 await tx.query('UPDATE external_full_members SET canonical_id=$1 WHERE canonical_id=$2',[keep,drop]);
 await tx.query("DELETE FROM external_canonical_bindings WHERE provider='chinacarapi' AND canonical_id=$1",[drop]);
}
export async function chooseRepresentative(tx:PoolClient,canonicalId:string){
 await tx.query('SELECT pg_advisory_xact_lock(78291332)');
 const candidates=(await tx.query(`SELECT l.id,l.platform_id,l.external_id,l.formal_primary FROM external_listings l JOIN external_full_members m ON m.source=l.platform_id AND m.external_id=l.external_id
  WHERE l.provider='chinacarapi' AND m.canonical_id=$1 AND m.state='active' AND l.upstream_state='active' AND l.source_data IS NOT NULL AND cardinality(m.locales)=3
  ORDER BY l.formal_primary DESC,l.first_imported_at NULLS LAST,l.platform_id,l.external_id LIMIT 1`,[canonicalId])).rows;
 const next=candidates[0];
 const previous=(await tx.query("UPDATE external_listings SET formal_primary=false WHERE provider='chinacarapi' AND formal_canonical_id=$1 AND formal_primary AND ($2::uuid IS NULL OR id<>$2) RETURNING id",[canonicalId,next?.id??null])).rows;
 for(const item of previous)await reprojectFormalListing(tx,item.id);
 if(!next)return;
 await tx.query("INSERT INTO external_canonical_bindings(provider,canonical_id,source,external_id) VALUES('chinacarapi',$1,$2,$3) ON CONFLICT(provider,canonical_id) DO UPDATE SET source=excluded.source,external_id=excluded.external_id",[canonicalId,next.platform_id,next.external_id]);
 await tx.query('UPDATE external_listings SET formal_primary=true WHERE id=$1',[next.id]);await reprojectFormalListing(tx,next.id);
}
export const applyFullSource:FullApply=async(tx,input)=>{
 await tx.query('SELECT pg_advisory_xact_lock(78291332)');
 for(const doc of input.documents)await persistSourceDocument(tx,doc);
 const existing=(await tx.query("SELECT source_revision,formal_primary FROM external_listings WHERE provider='chinacarapi' AND platform_id=$1 AND external_id=$2",[input.source,input.externalId])).rows[0];
 const revision=Number(existing?.source_revision??0)+1;if(!Number.isSafeInteger(revision))throw new FullSyncError('SYNC_REVISION_LIMIT');
 const actor={id:SERVICE_ACTOR,requestId:`full:${input.batchId}`};
 if(input.operation==='withdraw'){
  if(existing)await applyFormalCandidate(tx,{platformId:input.source,externalId:input.externalId,operation:'withdraw',revision,fetchedAt:input.at,sourceUpdatedAt:input.at},actor,input.batchId,{id:input.canonicalId,primary:existing.formal_primary});
 }else{
  const projection=adaptSourceDocuments(await loadSourceDocuments(tx,{provider:'chinacarapi',source:input.source,externalId:input.externalId}),revision,input.at);
  if(!projection)throw new FullSyncError('SYNC_DETAILS_INCOMPLETE');
  const result=await applyFormalCandidate(tx,projection.candidate,actor,input.batchId,{id:input.canonicalId,primary:existing?.formal_primary??false});
  const segments=await refreshSourceSegments(tx,result.listingId,projection,input.at);if(segments.changed)await tx.query('UPDATE external_catalog_state SET revision=revision+1 WHERE id=1');
 }
 await chooseRepresentative(tx,input.canonicalId);
};
