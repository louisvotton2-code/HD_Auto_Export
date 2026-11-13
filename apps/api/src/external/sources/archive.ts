import {gzipSync,gunzipSync} from 'node:zlib';
import type {PoolClient} from 'pg';
import {canonicalJson,isDatabaseJson,sha256} from '../normalize.js';
import {persistSourceDocument,type SourceDocument} from './documents.js';
type BlobRow={hash:string;payload:unknown;raw_text:string|null;compressed:Buffer|null;raw_exact:boolean};
const maximum=16*1024*1024;
export function decodeSourceBlob(row:BlobRow){
 if(!row.compressed)return {payload:row.payload,rawText:row.raw_text};
 const raw=gunzipSync(row.compressed,{maxOutputLength:maximum}).toString('utf8');if(sha256(raw)!==row.hash)throw new Error('Source archive checksum mismatch.');
 return {payload:JSON.parse(raw) as unknown,rawText:row.raw_exact?raw:null};
}
export async function persistSourceBlob(tx:PoolClient,hash:string,payload:unknown,rawText?:string){
 const raw=rawText??canonicalJson(payload);if(Buffer.byteLength(raw)>maximum||sha256(raw)!==hash||!isDatabaseJson(payload))throw new Error('Invalid source archive.');
 // Conflict avoids duplicate compression/storage; canonical bytes and exact raw bytes share one content hash.
 const old=(await tx.query<{compressed:boolean}>('SELECT compressed IS NOT NULL AS compressed FROM external_source_blobs WHERE hash=$1',[hash])).rows[0];
 if(old?.compressed){if(rawText!==undefined)await tx.query('UPDATE external_source_blobs SET raw_exact=true WHERE hash=$1',[hash]);return;}
 await tx.query(`INSERT INTO external_source_blobs(hash,compressed,raw_exact) VALUES($1,$2,$3)
 ON CONFLICT(hash) DO UPDATE SET compressed=coalesce(external_source_blobs.compressed,excluded.compressed),raw_exact=external_source_blobs.raw_exact OR excluded.raw_exact OR external_source_blobs.raw_text IS NOT NULL,payload=NULL,raw_text=NULL`,[hash,gzipSync(raw),rawText!==undefined]);
}
export async function protectSourceBlob(tx:PoolClient,hash:string,owner:{kind:'pending'|'backup'|'audit';reference:string}){
 if(!owner.reference||owner.reference.length>500)throw new Error('Invalid archive reference.');
 await tx.query('INSERT INTO external_source_blob_refs(hash,kind,reference) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[hash,owner.kind,owner.reference]);
}
export async function releaseSourceReferences(tx:PoolClient,kind:'pending'|'backup'|'audit',reference:string){await tx.query('DELETE FROM external_source_document_refs WHERE kind=$1 AND reference=$2',[kind,reference]);await tx.query('DELETE FROM external_source_blob_refs WHERE kind=$1 AND reference=$2',[kind,reference]);}
/** Queues hold UUID references; the compressed source bytes occur only once. Archive before applying a lifecycle decision. */
export type SourceDocumentReference={id:string;observedAt:string;sourceUpdatedAt:string|null;eventSequence?:string;responseHash?:string};
export async function archiveSourceDocuments(tx:PoolClient,documents:SourceDocument[],pendingReference:string){
 const ids:SourceDocumentReference[]=[];for(const doc of documents){const saved=await persistSourceDocument(tx,doc,false);await tx.query("INSERT INTO external_source_document_refs(document_id,kind,reference) VALUES($1,'pending',$2) ON CONFLICT DO NOTHING",[saved.id,pendingReference]);ids.push({id:saved.id,observedAt:doc.observedAt,sourceUpdatedAt:doc.sourceUpdatedAt,...(doc.eventSequence?{eventSequence:doc.eventSequence}:{}),...(doc.rawResponse?{responseHash:doc.rawResponse.hash}:{})});await protectSourceBlob(tx,saved.hash,{kind:'pending',reference:pendingReference});if(doc.rawResponse)await protectSourceBlob(tx,doc.rawResponse.hash,{kind:'pending',reference:pendingReference});}return ids;
}
export async function loadSourceDocumentRefs(tx:PoolClient,refs:SourceDocumentReference[]):Promise<SourceDocument[]>{
 const ids=refs.map(ref=>ref.id);
 if(ids.length>1000||new Set(ids).size!==ids.length)throw new Error('Invalid source reference batch.');
 const rows=(await tx.query<BlobRow&{id:string;provider:'chinacarapi';source:'che168'|'dongchedi';external_id:string;kind:SourceDocument['kind'];locale:SourceDocument['locale'];last_observed_at:Date;source_updated_at:Date|null;event_sequence:string|null;response_hash:string|null}>(`SELECT d.*,b.payload,b.raw_text,b.compressed,b.raw_exact FROM external_source_documents d JOIN external_source_blobs b ON b.hash=d.hash WHERE d.id=ANY($1::uuid[])`,[ids])).rows;
 if(rows.length!==ids.length)throw new Error('Source reference is missing.');const indexed=new Map(rows.map(row=>[row.id,row]));
 return refs.map(ref=>{const r=indexed.get(ref.id)!,decoded=decodeSourceBlob(r);return {identity:{provider:r.provider,source:r.source,externalId:r.external_id},kind:r.kind,locale:r.locale,payload:decoded.payload,observedAt:ref.observedAt,sourceUpdatedAt:ref.sourceUpdatedAt,...(decoded.rawText!==null?{rawText:decoded.rawText}:{}),...(ref.eventSequence?{eventSequence:ref.eventSequence}:{}),...(ref.responseHash?{rawResponse:{hash:ref.responseHash}}:{})};});
}
/** Small maintenance batch. Never changes the source hash and never performs a database-wide rewrite. */
export async function compactSourceBlobs(tx:PoolClient,limit=20){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid compaction bound.');
 const rows=(await tx.query<BlobRow>('SELECT * FROM external_source_blobs WHERE compressed IS NULL ORDER BY created_at,hash LIMIT $1 FOR UPDATE SKIP LOCKED',[limit])).rows;
 for(const row of rows)await persistSourceBlob(tx,row.hash,row.payload,row.raw_text??undefined);return rows.length;
}
export async function protectSourceBackup(tx:PoolClient,reference:string){
 if(!reference||reference.length>500)throw new Error('Invalid backup reference.');
 await tx.query("INSERT INTO external_source_document_refs(document_id,kind,reference) SELECT id,'backup',$1 FROM external_source_documents ON CONFLICT DO NOTHING",[reference]);
 return (await tx.query("INSERT INTO external_source_blob_refs(hash,kind,reference) SELECT hash,'backup',$1 FROM external_source_blobs ON CONFLICT DO NOTHING",[reference])).rowCount??0;
}
/** A bounded sweep also covers obsolete events that never advanced a head. */
export async function pruneSourceHistory(tx:PoolClient,limit=200){
 if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('Invalid retention bound.');
 const deleted=(await tx.query(`DELETE FROM external_source_documents WHERE id IN(
 SELECT d.id FROM external_source_documents d WHERE NOT EXISTS(SELECT 1 FROM external_source_heads h WHERE h.document_id=d.id)
 AND (d.last_observed_at<now()-interval '7 days' OR EXISTS(SELECT 1 FROM external_source_documents newer WHERE newer.provider=d.provider AND newer.source=d.source AND newer.external_id=d.external_id AND newer.kind=d.kind AND newer.locale=d.locale AND (newer.last_observed_at,newer.id)>(d.last_observed_at,d.id) AND NOT EXISTS(SELECT 1 FROM external_source_heads h WHERE h.document_id=newer.id)))
 AND NOT EXISTS(SELECT 1 FROM external_source_document_refs p WHERE p.document_id=d.id)
 AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=d.hash OR p.hash=d.response_hash)
 AND NOT EXISTS(SELECT 1 FROM external_source_responses r JOIN external_source_blob_refs p ON p.hash=r.response_hash WHERE r.document_id=d.id)
 ORDER BY d.last_observed_at,d.id LIMIT $1) RETURNING id`,[limit])).rowCount??0;
 await tx.query(`DELETE FROM external_source_responses WHERE (document_id,response_hash) IN(SELECT r.document_id,r.response_hash FROM external_source_responses r JOIN external_source_documents d ON d.id=r.document_id WHERE r.response_hash IS DISTINCT FROM d.response_hash AND r.observed_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=r.response_hash) ORDER BY r.observed_at LIMIT $1)`,[limit]);
 await tx.query(`DELETE FROM external_trim_documents WHERE (provider,trim_id,locale,hash) IN(SELECT d.provider,d.trim_id,d.locale,d.hash FROM external_trim_documents d WHERE d.last_observed_at<now()-interval '7 days' AND EXISTS(SELECT 1 FROM external_trim_documents newer WHERE newer.provider=d.provider AND newer.trim_id=d.trim_id AND newer.locale=d.locale AND (newer.last_observed_at,newer.hash)>(d.last_observed_at,d.hash)) AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=d.hash) ORDER BY d.last_observed_at LIMIT $1)`,[limit]);
 return deleted;
}
