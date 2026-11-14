import type {PoolClient} from 'pg';
import type {Database} from '../../db/index.js';
import {persistSourceBlob} from '../sources/archive.js';
const phases=['documents','responses','trims','blobs'] as const;
type Phase=typeof phases[number];
type Cursor={id?:string;hash?:string;provider?:string;trimId?:string;locale?:string};
type State={phase:Phase;cursor:Cursor;due:boolean};
const bounds={segments:4,candidates:200,compressions:20} as const;
/** Every candidate advances the persisted cursor, including heads/pinned rows. No filtered full-table retry loop. */
async function segment(tx:PoolClient){
 const state=(await tx.query<State>(`SELECT phase,cursor,due_at<=clock_timestamp() AS due FROM external_source_maintenance WHERE id=1 FOR UPDATE SKIP LOCKED`)).rows[0];
 if(!state||!state.due)return null;
 const c=state.cursor;let cursor:Cursor={},visited=0,deleted=0,compressed=0;
 if(state.phase==='documents'){
  const rows=(await tx.query<{id:string}>(`SELECT id FROM external_source_documents WHERE id>coalesce($1::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED`,[c.id??null])).rows;
  visited=rows.length;if(visited){cursor={id:rows.at(-1)!.id};deleted=(await tx.query(`DELETE FROM external_source_documents d WHERE d.id=ANY($1::uuid[])
   AND NOT EXISTS(SELECT 1 FROM external_source_heads h WHERE h.document_id=d.id)
   AND (d.last_observed_at<now()-interval '7 days' OR EXISTS(SELECT 1 FROM external_source_documents newer
     WHERE newer.provider=d.provider AND newer.source=d.source AND newer.external_id=d.external_id AND newer.kind=d.kind AND newer.locale=d.locale
     AND (newer.last_observed_at,newer.id)>(d.last_observed_at,d.id) AND NOT EXISTS(SELECT 1 FROM external_source_heads h WHERE h.document_id=newer.id)))
   AND NOT EXISTS(SELECT 1 FROM external_source_document_refs p WHERE p.document_id=d.id)
   AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=d.hash OR p.hash=d.response_hash)
   AND NOT EXISTS(SELECT 1 FROM external_source_responses r JOIN external_source_blob_refs p ON p.hash=r.response_hash WHERE r.document_id=d.id)`,[rows.map(r=>r.id)])).rowCount??0;}
 }else if(state.phase==='responses'){
  const rows=(await tx.query<{document_id:string;response_hash:string}>(`SELECT document_id,response_hash FROM external_source_responses
   WHERE (document_id,response_hash)>(coalesce($1::uuid,'00000000-0000-0000-0000-000000000000'::uuid),coalesce($2::text,'')) ORDER BY document_id,response_hash LIMIT 200 FOR UPDATE SKIP LOCKED`,[c.id??null,c.hash??null])).rows;
  visited=rows.length;if(visited){const last=rows.at(-1)!;cursor={id:last.document_id,hash:last.response_hash};deleted=(await tx.query(`DELETE FROM external_source_responses r USING external_source_documents d
   WHERE d.id=r.document_id AND (r.document_id,r.response_hash) IN(SELECT id::uuid,hash FROM jsonb_to_recordset($1::jsonb) AS p(id text,hash text))
   AND r.response_hash IS DISTINCT FROM d.response_hash
   AND (r.observed_at<now()-interval '7 days' OR EXISTS(SELECT 1 FROM external_source_responses newer WHERE newer.document_id=r.document_id AND newer.response_hash IS DISTINCT FROM d.response_hash AND (newer.observed_at,newer.response_hash)>(r.observed_at,r.response_hash)))
   AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=r.response_hash)`,[JSON.stringify(rows.map(r=>({id:r.document_id,hash:r.response_hash})))])).rowCount??0;}
 }else if(state.phase==='trims'){
  const rows=(await tx.query<{provider:string;trim_id:string;locale:string;hash:string}>(`SELECT provider,trim_id,locale,hash FROM external_trim_documents
   WHERE (provider,trim_id,locale,hash)>(coalesce($1::text,''),coalesce($2::text,''),coalesce($3::text,''),coalesce($4::text,''))
   ORDER BY provider,trim_id,locale,hash LIMIT 200 FOR UPDATE SKIP LOCKED`,[c.provider??null,c.trimId??null,c.locale??null,c.hash??null])).rows;
  visited=rows.length;if(visited){const last=rows.at(-1)!;cursor={provider:last.provider,trimId:last.trim_id,locale:last.locale,hash:last.hash};deleted=(await tx.query(`DELETE FROM external_trim_documents d
   WHERE (d.provider,d.trim_id,d.locale,d.hash) IN(SELECT provider,trim_id,locale,hash FROM jsonb_to_recordset($1::jsonb) AS p(provider text,trim_id text,locale text,hash text))
   AND EXISTS(SELECT 1 FROM external_trim_documents newer WHERE newer.provider=d.provider AND newer.trim_id=d.trim_id AND newer.locale=d.locale AND (newer.last_observed_at,newer.hash)>(d.last_observed_at,d.hash))
   AND (d.last_observed_at<now()-interval '7 days' OR EXISTS(SELECT 1 FROM external_trim_documents newer WHERE newer.provider=d.provider AND newer.trim_id=d.trim_id AND newer.locale=d.locale AND (newer.last_observed_at,newer.hash)>(d.last_observed_at,d.hash) ORDER BY newer.last_observed_at DESC,newer.hash DESC OFFSET 1 LIMIT 1))
   AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=d.hash)`,[JSON.stringify(rows)])).rowCount??0;}
 }else if(state.phase==='blobs'){
  const rows=(await tx.query<{hash:string;needs_compression:boolean}>(`SELECT hash,compressed IS NULL AS needs_compression FROM external_source_blobs WHERE hash>coalesce($1::text,'') ORDER BY hash LIMIT 200 FOR UPDATE SKIP LOCKED`,[c.hash??null])).rows;
  visited=rows.length;if(visited){cursor={hash:rows.at(-1)!.hash};deleted=(await tx.query(`DELETE FROM external_source_blobs b WHERE b.hash=ANY($1::text[]) AND b.created_at<now()-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=b.hash)
   AND NOT EXISTS(SELECT 1 FROM external_source_documents d WHERE d.hash=b.hash OR d.response_hash=b.hash)
   AND NOT EXISTS(SELECT 1 FROM external_source_responses r WHERE r.response_hash=b.hash)
   AND NOT EXISTS(SELECT 1 FROM external_trim_documents t WHERE t.hash=b.hash)`,[rows.map(r=>r.hash)])).rowCount??0;
   // Do not materialize 200 large original payloads. Each old blob is loaded/compressed individually.
   for(const r of rows.filter(r=>r.needs_compression).slice(0,bounds.compressions)){
    const old=(await tx.query<{payload:unknown;raw_text:string|null}>('SELECT payload,raw_text FROM external_source_blobs WHERE hash=$1 AND compressed IS NULL',[r.hash])).rows[0];
    if(old){await persistSourceBlob(tx,r.hash,old.payload,old.raw_text??undefined);compressed++;}
   }
  }
 }else throw new Error('Unknown source maintenance phase.');
 const done=visited<bounds.candidates,finished=done&&state.phase==='blobs',nextPhase=done?phases[(phases.indexOf(state.phase)+1)%phases.length]!:state.phase;
 await tx.query(`UPDATE external_source_maintenance SET phase=$1,cursor=$2,scanned=scanned+$3,deleted=deleted+$4,compressed=compressed+$5,
  rounds=rounds+CASE WHEN $6 THEN 1 ELSE 0 END,due_at=CASE WHEN $6 THEN clock_timestamp()+interval '1 hour' ELSE clock_timestamp() END,
  last_completed_at=CASE WHEN $6 THEN clock_timestamp() ELSE last_completed_at END,updated_at=clock_timestamp() WHERE id=1`,[nextPhase,JSON.stringify(done?{}:cursor),visited,deleted,compressed,finished]);
 return {phase:state.phase,visited,deleted,compressed,finished};
}
/** Called after withdrawal processing; at most four separately committed segments and one pool connection at a time. */
export async function runSourceMaintenance(db:Database){
 const result={segments:0,visited:0,deleted:0,compressed:0,finished:false};
 for(let i=0;i<bounds.segments;i++){
  const part=await db.transaction(segment);if(!part)break;
  result.segments++;result.visited+=part.visited;result.deleted+=part.deleted;result.compressed+=part.compressed;result.finished=part.finished;
  if(part.finished)break;
 }return result;
}
