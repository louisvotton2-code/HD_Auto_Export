import { randomUUID } from 'node:crypto';
import {persistSourceBlob} from './archive.js';
import type { PoolClient } from 'pg';
import { canonicalJson, isDatabaseJson, jsonHash, sha256 } from '../normalize.js';

export type SourceIdentity={provider:'chinacarapi';source:'che168'|'dongchedi';externalId:string};
export type SourceDocument={identity:SourceIdentity;kind:'csv'|'detail'|'specs'|'report'|'event';locale:'zh'|'en'|'ru'|'und';observedAt:string;sourceUpdatedAt:string|null;eventSequence?:string;payload:unknown;rawText?:string;rawResponse?:{hash:string;body?:string}};
const timestamp=(text:string)=>/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(text)&&Number.isFinite(Date.parse(text));
export function sourceDocumentHash(document:SourceDocument){
  if(document.identity.provider!=='chinacarapi'||!['che168','dongchedi'].includes(document.identity.source)||!/^\d{1,100}$/.test(document.identity.externalId)||
    !['csv','detail','specs','report','event'].includes(document.kind)||!['zh','en','ru','und'].includes(document.locale)||!timestamp(document.observedAt)||
    document.sourceUpdatedAt!==null&&!timestamp(document.sourceUpdatedAt)||document.eventSequence!==undefined&&!/^\d{1,30}$/.test(document.eventSequence))throw new Error('Invalid source document metadata.');
  if(!isDatabaseJson(document.payload))throw new Error('Source document cannot be stored as JSON.');
  const canonical=canonicalJson(document.payload);
  if(Buffer.byteLength(canonical)>16*1024*1024)throw new Error('Source document exceeds capacity; retain the original file for investigation.');
  if(document.rawText!==undefined){if(Buffer.byteLength(document.rawText)>16*1024*1024||document.rawText.includes('\0')||canonicalJson(JSON.parse(document.rawText))!==canonical)throw new Error('Source raw text and parsed document disagree.');return sha256(document.rawText);}
  return jsonHash(document.payload);
}
/** Paths express field presence, including explicit null. Missing paths are never cleared by a later sparse document. */
export function sourcePresence(payload:unknown):string[]{
  const paths:string[]=[];const visit=(value:unknown,path:string)=>{if(value&&typeof value==='object'&&!Array.isArray(value))for(const [key,item] of Object.entries(value)){const next=`${path}/${key.replace(/~/g,'~0').replace(/\//g,'~1')}`;paths.push(next);visit(item,next);}};
  visit(payload,'');return paths.sort();
}
/** Caller owns the transaction and lifecycle ordering; archiving evidence never publishes or revives a listing. */
export async function persistSourceDocument(tx:PoolClient,document:SourceDocument,advanceHead=true){
  const hash=sourceDocumentHash(document), identity=[document.identity.provider,document.identity.source,document.identity.externalId];
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[identity.join(':')]);
  await persistSourceBlob(tx,hash,document.payload,document.rawText);
  if(document.rawResponse){if(!/^[a-f0-9]{64}$/.test(document.rawResponse.hash))throw new Error('Invalid raw response hash.');if(document.rawResponse.body!==undefined)await persistSourceResponse(tx,{hash:document.rawResponse.hash,body:document.rawResponse.body});}
  const result=await tx.query<{id:string}>(`INSERT INTO external_source_documents(id,provider,source,external_id,kind,locale,hash,presence,first_observed_at,last_observed_at,source_updated_at,event_sequence,response_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12) ON CONFLICT(provider,source,external_id,kind,locale,hash)
    DO UPDATE SET response_hash=coalesce(excluded.response_hash,external_source_documents.response_hash),last_observed_at=greatest(external_source_documents.last_observed_at,excluded.last_observed_at) RETURNING id`,
    [randomUUID(),...identity,document.kind,document.locale,hash,sourcePresence(document.payload),document.observedAt,document.sourceUpdatedAt,document.eventSequence??null,document.rawResponse?.hash??null]);
  const id=result.rows[0]!.id;
  if(document.rawResponse){
    await tx.query('INSERT INTO external_source_responses(document_id,response_hash,observed_at) VALUES($1,$2,$3) ON CONFLICT(document_id,response_hash) DO UPDATE SET observed_at=greatest(external_source_responses.observed_at,excluded.observed_at)',[id,document.rawResponse.hash,document.observedAt]);
    await tx.query(`DELETE FROM external_source_responses r WHERE r.document_id=$1
      AND r.response_hash<>(SELECT response_hash FROM external_source_documents WHERE id=$1)
      AND (r.observed_at<now()-interval '7 days' OR r.response_hash NOT IN(SELECT response_hash FROM external_source_responses WHERE document_id=$1 AND response_hash<>(SELECT response_hash FROM external_source_documents WHERE id=$1) ORDER BY observed_at DESC,response_hash DESC LIMIT 1))
      AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=r.response_hash)`,[id]);
  }
  const body=document.payload as Record<string,unknown>|null;
  if(document.kind==='specs'&&body&&typeof body==='object'&&body.trimId!==undefined)await persistTrimDocument(tx,String(body.trimId),document.locale,document.payload,document.observedAt);
  if(!advanceHead)return {id,hash,headChanged:false};
  const previous=(await tx.query<{merged_payload:unknown}>(`SELECT merged_payload FROM external_source_heads WHERE provider=$1 AND source=$2 AND external_id=$3 AND kind=$4 AND locale=$5 FOR UPDATE`,[...identity,document.kind,document.locale])).rows[0];
  const merged=mergePresent(previous?.merged_payload,document.payload);
  const head=await tx.query(`INSERT INTO external_source_heads(provider,source,external_id,kind,locale,document_id,observed_at,merged_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(provider,source,external_id,kind,locale) DO UPDATE SET document_id=excluded.document_id,observed_at=excluded.observed_at,merged_payload=excluded.merged_payload
    WHERE external_source_heads.observed_at<excluded.observed_at RETURNING document_id`,[...identity,document.kind,document.locale,id,document.observedAt,JSON.stringify(merged)]);
  // Current plus one recent historical version; pending work, backup and staff-audit pins are exempt.
  await tx.query(`DELETE FROM external_source_documents d WHERE d.provider=$1 AND d.source=$2 AND d.external_id=$3 AND d.kind=$4 AND d.locale=$5
    AND NOT EXISTS(SELECT 1 FROM external_source_heads h WHERE h.document_id=d.id)
    AND (d.last_observed_at<now()-interval '7 days' OR d.id NOT IN(SELECT x.id FROM external_source_documents x WHERE x.provider=$1 AND x.source=$2 AND x.external_id=$3 AND x.kind=$4 AND x.locale=$5 AND NOT EXISTS(SELECT 1 FROM external_source_heads h WHERE h.document_id=x.id) ORDER BY x.last_observed_at DESC,x.id DESC LIMIT 1))
    AND NOT EXISTS(SELECT 1 FROM external_source_document_refs p WHERE p.document_id=d.id)
    AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=d.hash OR p.hash=d.response_hash)
    AND NOT EXISTS(SELECT 1 FROM external_source_responses r JOIN external_source_blob_refs p ON p.hash=r.response_hash WHERE r.document_id=d.id)`,[...identity,document.kind,document.locale]);
  return {id,hash,headChanged:head.rowCount===1};
}
export async function loadSourceDocuments(tx:PoolClient,identity:SourceIdentity):Promise<SourceDocument[]>{
  const rows=await tx.query<{kind:SourceDocument['kind'];locale:SourceDocument['locale'];payload:unknown;source_updated_at:Date|null;observed_at:Date;event_sequence:string|null}>(`SELECT d.*,h.observed_at,h.merged_payload AS payload FROM external_source_heads h JOIN external_source_documents d ON d.id=h.document_id WHERE h.provider=$1 AND h.source=$2 AND h.external_id=$3`,[identity.provider,identity.source,identity.externalId]);
  return rows.rows.map(row=>({identity,kind:row.kind,locale:row.locale,payload:row.payload,observedAt:row.observed_at.toISOString(),sourceUpdatedAt:row.source_updated_at?.toISOString()??null,...(row.event_sequence===null?{}:{eventSequence:row.event_sequence})}));
}
export async function persistTrimDocument(tx:PoolClient,trimId:string,locale:SourceDocument['locale'],payload:unknown,observedAt:string){
  if(!/^[\w.-]{1,200}$/.test(trimId)||!timestamp(observedAt)||!isDatabaseJson(payload)||Buffer.byteLength(canonicalJson(payload))>16*1024*1024)throw new Error('Invalid shared trim document.');
  const hash=jsonHash(payload);
  await persistSourceBlob(tx,hash,payload);
  await tx.query(`INSERT INTO external_trim_documents(provider,trim_id,locale,hash,last_observed_at) VALUES('chinacarapi',$1,$2,$3,$4) ON CONFLICT(provider,trim_id,locale,hash) DO UPDATE SET last_observed_at=greatest(external_trim_documents.last_observed_at,excluded.last_observed_at)`,[trimId,locale,hash,observedAt]);
  await tx.query(`DELETE FROM external_trim_documents d WHERE provider='chinacarapi' AND trim_id=$1 AND locale=$2
    AND hash<>(SELECT hash FROM external_trim_documents WHERE provider='chinacarapi' AND trim_id=$1 AND locale=$2 ORDER BY last_observed_at DESC,hash DESC LIMIT 1)
    AND (last_observed_at<now()-interval '7 days' OR hash NOT IN(SELECT hash FROM external_trim_documents WHERE provider='chinacarapi' AND trim_id=$1 AND locale=$2 ORDER BY last_observed_at DESC,hash DESC LIMIT 2))
    AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=d.hash)`,[trimId,locale]);
  return hash;
}

export function mergePresent(before:unknown,after:unknown):unknown {
  if(!after||typeof after!=='object'||Array.isArray(after))return structuredClone(after);
  const prior=before&&typeof before==='object'&&!Array.isArray(before)?before as Record<string,unknown>:{};
  const merged:Record<string,unknown>=Object.create(null);
  for(const [key,value] of Object.entries(prior))merged[key]=structuredClone(value);
  for(const [key,value] of Object.entries(after))merged[key]=mergePresent(prior[key],value);
  return merged;
}

/** Maintenance entry point: bounded orphan cleanup after rolling evidence retention. No active reference can be removed. */
export async function pruneSourceBlobs(tx:PoolClient){
  return (await tx.query(`DELETE FROM external_source_blobs WHERE hash IN(SELECT b.hash FROM external_source_blobs b WHERE b.created_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM external_source_blob_refs p WHERE p.hash=b.hash) AND NOT EXISTS(SELECT 1 FROM external_source_documents d WHERE d.hash=b.hash OR d.response_hash=b.hash) AND NOT EXISTS(SELECT 1 FROM external_trim_documents t WHERE t.hash=b.hash) AND NOT EXISTS(SELECT 1 FROM external_source_responses r WHERE r.response_hash=b.hash) ORDER BY b.created_at LIMIT 200) RETURNING hash`)).rowCount??0;
}

export async function persistSourceResponse(tx:PoolClient,response:{hash:string;body:string}){
 if(!/^[a-f0-9]{64}$/.test(response.hash)||sha256(response.body)!==response.hash||Buffer.byteLength(response.body)>16*1024*1024||response.body.includes('\0'))throw new Error('Invalid complete source response.');
 const payload:unknown=JSON.parse(response.body);if(!isDatabaseJson(payload))throw new Error('Invalid source response JSON.');
 await persistSourceBlob(tx,response.hash,payload,response.body);
 return response.hash;
}
