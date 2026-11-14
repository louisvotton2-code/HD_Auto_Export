import {z} from 'zod';
import type {Database} from '../db/index.js';
import {SERVICE_ACTOR} from './ingestion/worker.js';
import {applyFullSource,bindAlias,ensureMember} from './full-sync/apply.js';
import {persistSourceResponse,type SourceDocument} from './sources/index.js';
import {jsonHash} from './normalize.js';
import {validVin} from './sources/public-evidence.js';
export const LocalPreviewManifest=z.strictObject({version:z.literal(1),batchKey:z.string().regex(/^local-real-[a-z0-9-]{1,60}$/),
 identities:z.array(z.strictObject({source:z.enum(['che168','dongchedi']),externalId:z.string().regex(/^\d{1,100}$/)})).min(1).max(200)});
export function assertLocalPreviewTarget(env:NodeJS.ProcessEnv){
 const u=new URL(env.DATABASE_URL??'');
 if(env.NODE_ENV!=='development'||env.HD_DEPLOYMENT_ENV!=='local'||!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||!/^\/hd_local_preview(?:_test_[a-f0-9]+)?$/.test(u.pathname)||u.hash||u.searchParams.getAll('host').length>1||[...u.searchParams.keys()].some(k=>k!=='host')||u.searchParams.has('host')&&!u.searchParams.get('host')!.startsWith('/')||env.TRANSLATION_PROVIDER&&env.TRANSLATION_PROVIDER!=='disabled')throw new Error('Local preview requires a dedicated loopback hd_local_preview database, development/local and disabled translation');
 return u.toString();
}
/** Local-only fixed cohort import. Never starts a worker, downloads a CSV, translates, or removes a database. */
export async function importLocalPreview(db:Database,manifestInput:unknown,documents:Iterable<SourceDocument>|AsyncIterable<SourceDocument>){
 const manifest=LocalPreviewManifest.parse(manifestInput),key=(s:string,id:string)=>`${s}:${id}`;
 const identities=new Set(manifest.identities.map(i=>key(i.source,i.externalId)));
 if(identities.size!==manifest.identities.length)throw new Error('Duplicate preview identities');
 const responses=new Map<string,string>();let bytes=0;
 const groups=new Map<string,SourceDocument[]>();
 for await(const original of documents){
  if(!Number.isFinite(Date.parse(original.observedAt)))throw new Error('Preview observation time invalid');
  const raw=original.rawResponse;
  if(raw?.body&&!responses.has(raw.hash)){responses.set(raw.hash,raw.body);bytes+=Buffer.byteLength(raw.body);}
  const d=raw?{...original,rawResponse:{hash:raw.hash}}:original;
  bytes+=Buffer.byteLength(JSON.stringify(d));if(bytes>96*1024*1024)throw new Error('Preview document budget exceeded');
  const id=key(d.identity.source,d.identity.externalId);
  if(d.identity.provider!=='chinacarapi'||!identities.has(id)||!['detail','report'].includes(d.kind))throw new Error('Document outside fixed preview cohort');
  const list=groups.get(id)??[];if(list.some(p=>p.kind===d.kind&&p.locale===d.locale)||list.length>=5)throw new Error('Duplicate preview document');list.push(d);groups.set(id,list);
 }
 const actual=(await db.pool.query('SELECT current_database() AS name')).rows[0].name;
 if(!/^hd_local_preview(?:_test_[a-f0-9]+)?$/.test(actual))throw new Error('Local preview database mismatch');
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(78291336)');
  if((await tx.query('SELECT enabled FROM external_full_sync WHERE id=1')).rows[0]?.enabled)throw new Error('Preview cannot share a running source worker');
  // Local metadata deliberately lives only in this guarded development database, not production migrations.
  await tx.query(`CREATE TABLE IF NOT EXISTS local_preview_batches(batch_key text PRIMARY KEY,identities_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS local_preview_records(batch_key text NOT NULL REFERENCES local_preview_batches,source text NOT NULL,external_id text NOT NULL,document_hash text NOT NULL,listing_id uuid REFERENCES external_listings,PRIMARY KEY(batch_key,source,external_id));`);
  const hash=jsonHash(manifest.identities);
  const batchHash=jsonHash(['local-preview',manifest.batchKey]),batchId=`${batchHash.slice(0,8)}-${batchHash.slice(8,12)}-4${batchHash.slice(13,16)}-a${batchHash.slice(17,20)}-${batchHash.slice(20,32)}`;
  await tx.query('INSERT INTO local_preview_batches VALUES($1,$2) ON CONFLICT DO NOTHING',[manifest.batchKey,hash]);
  if((await tx.query('SELECT identities_hash FROM local_preview_batches WHERE batch_key=$1',[manifest.batchKey])).rows[0].identities_hash!==hash)throw new Error('Fixed preview cohort cannot be replaced');
  await tx.query("INSERT INTO staff(id,name,email,role,banned) VALUES($1,'Local import service','chinacarapi-worker@example.invalid','editor',true) ON CONFLICT(id) DO NOTHING",[SERVICE_ACTOR]);
  if(!(await tx.query('SELECT 1 FROM staff WHERE id=$1 AND banned AND NOT EXISTS(SELECT 1 FROM staff_accounts WHERE user_id=$1)',[SERVICE_ACTOR])).rowCount)throw new Error('Preview service identity invalid');
  const vins=new Map<string,{source:'che168'|'dongchedi';id:string}>(),aliases:Array<{source:'che168'|'dongchedi';id:string;target:{source:'che168'|'dongchedi';id:string};at:string}>=[];
  for(const identity of manifest.identities){const docs=groups.get(key(identity.source,identity.externalId))??[],detail=docs.find(d=>d.kind==='detail'&&d.locale==='en');
   if(!detail)continue;const payload=detail.payload as Record<string,any>;
   const member=await ensureMember(tx,identity.source,identity.externalId);
   if(member.last_detail_at&&Date.parse(detail.observedAt)<new Date(member.last_detail_at).getTime())continue;
   const vin=validVin(payload.nameplate?.vin),own={source:identity.source,id:identity.externalId};
   if(vin){const prior=vins.get(vin);if(prior)aliases.push({...own,target:prior,at:detail.observedAt});else vins.set(vin,own);}
   for(const linked of Array.isArray(payload.alsoListedOn)?payload.alsoListedOn:[])if(identities.has(key(linked.source,String(linked.id))))aliases.push({...own,target:{source:linked.source,id:String(linked.id)},at:detail.observedAt});
  }
  for(const alias of aliases)await bindAlias(tx,alias.source,alias.id,alias.target,alias.at);
  const archived=new Set<string>();
  const result={applied:0,unchanged:0,missing:0,withdrawn:0,stale:0,selected:identities.size,publicIds:[] as string[]};
  for(const identity of manifest.identities){const docs=groups.get(key(identity.source,identity.externalId))??[],detail=docs.find(d=>d.kind==='detail'&&d.locale==='en');
   if(!detail){result.missing++;continue;}
   const payload=detail.payload as Record<string,unknown>;
   if(payload.id!==identity.externalId||payload.source!==identity.source)throw new Error('Preview detail identity mismatch');
   if(payload.status!=='active'&&payload.status!=='removed')throw new Error('Preview vehicle status is unknown');
   const withdrawn=payload.status==='removed';
   if(!withdrawn&&!['zh','en','ru'].every(locale=>docs.some(d=>d.kind==='detail'&&d.locale===locale))){result.missing++;continue;}
   const fingerprint=jsonHash(docs),prior=(await tx.query('SELECT * FROM local_preview_records WHERE batch_key=$1 AND source=$2 AND external_id=$3',[manifest.batchKey,identity.source,identity.externalId])).rows[0];
   const member=await ensureMember(tx,identity.source,identity.externalId);
   if(member.last_detail_at&&Date.parse(detail.observedAt)<new Date(member.last_detail_at).getTime()){result.stale++;continue;}
   if(withdrawn)result.withdrawn++;
   if(prior?.document_hash===fingerprint){result.unchanged++;if(prior.listing_id&&!withdrawn)result.publicIds.push(`ext-${prior.listing_id}`);continue;}
   for(const doc of docs){const hash=doc.rawResponse?.hash,body=hash?responses.get(hash):undefined;
    if(hash&&body&&!archived.has(hash)){await persistSourceResponse(tx,{hash,body});archived.add(hash);}}
   await tx.query("UPDATE external_full_members SET state=$4,locales=ARRAY['zh','en','ru'],applied_generation=desired_generation,last_detail_at=$3 WHERE source=$1 AND external_id=$2",[identity.source,identity.externalId,detail.observedAt,withdrawn?'withdrawn':'active']);
   await applyFullSource(tx,{source:identity.source,externalId:identity.externalId,canonicalId:member.canonical_id,operation:withdrawn?'withdraw':'upsert',documents:docs,at:detail.observedAt,batchId});
   const listing=(await tx.query("SELECT id FROM external_listings WHERE provider='chinacarapi' AND platform_id=$1 AND external_id=$2",[identity.source,identity.externalId])).rows[0];
   await tx.query('INSERT INTO local_preview_records VALUES($1,$2,$3,$4,$5) ON CONFLICT(batch_key,source,external_id) DO UPDATE SET document_hash=excluded.document_hash,listing_id=excluded.listing_id',[manifest.batchKey,identity.source,identity.externalId,fingerprint,listing?.id??null]);
   result.applied++;if(listing&&!withdrawn)result.publicIds.push(`ext-${listing.id}`);
  }
  return result;
 });
}
