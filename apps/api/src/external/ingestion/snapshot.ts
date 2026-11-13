import {createReadStream} from 'node:fs';
import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyCatalogCsv,persistSourceResponse,type CatalogCsvRow,type SourceDocument} from '../sources/index.js';
import type {Database} from '../../db/index.js';
import {ManifestSchema,identityKey,hash,IngestionError,type Manifest,type IngestionEvent} from './types.js';
import {createImportJob,receivePage,verifySnapshot} from './worker.js';
/** Bounded streaming JSONL: one complete source document per line; no full catalog materialization. */
export async function* readDocuments(file:string):AsyncGenerator<SourceDocument>{
 const decoder=new TextDecoder('utf-8',{fatal:true});let line='';
 const base=await realpath(path.dirname(file));let cached:{file:string;sha256:string;body:string;payload:unknown}|undefined;
 const resolve=async(value:any):Promise<SourceDocument>=>{
  if(!value.path)return value;
  if(typeof value.path!=='string'||path.isAbsolute(value.path)||! /^[a-f0-9]{64}$/.test(value.sha256))throw new IngestionError('INGESTION_DOCUMENT_PATH');
  const absolute=path.resolve(base,value.path);
  if(!absolute.startsWith(base+path.sep)||await realpath(absolute)!==absolute)throw new IngestionError('INGESTION_DOCUMENT_PATH');
  if(!cached||cached.file!==absolute||cached.sha256!==value.sha256){
   const size=(await stat(absolute)).size;if(size>16*1024*1024)throw new IngestionError('INGESTION_DOCUMENT_TOO_LARGE');
   const bytes=await readFile(absolute);if(bytes.length>16*1024*1024||createHash('sha256').update(bytes).digest('hex')!==value.sha256)throw new IngestionError('INGESTION_DOCUMENT_HASH');
   const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);cached={file:absolute,sha256:value.sha256,body,payload:JSON.parse(body)};
  }
  let payload=cached.payload;
  if(value.kind==='detail'&&payload&&typeof payload==='object'&&'results' in payload){
   const results=(payload as {results:unknown}).results;if(!Array.isArray(results))throw new IngestionError('INGESTION_DOCUMENT_SHAPE');
   const matches=results.filter(row=>row?.source===value.identity?.source&&String(row?.id)===value.identity?.externalId);
   if(matches.length!==1)throw new IngestionError('INGESTION_DOCUMENT_IDENTITY');payload=matches[0];
  }
  const {path:_,sha256:__,format:___,...document}=value;
  return {...document,payload,rawResponse:{hash:cached.sha256,body:cached.body}};
 };
 for await(const chunk of createReadStream(file)){
  line+=decoder.decode(chunk,{stream:true});
  while(true){const i=line.indexOf('\n');if(i<0)break;const value=line.slice(0,i);line=line.slice(i+1);if(Buffer.byteLength(value)>16*1024*1024)throw new IngestionError('INGESTION_DOCUMENT_TOO_LARGE');if(value.trim())yield await resolve(JSON.parse(value));}
  if(Buffer.byteLength(line)>16*1024*1024)throw new IngestionError('INGESTION_DOCUMENT_TOO_LARGE');
 }
 line+=decoder.decode();if(line.trim())yield await resolve(JSON.parse(line));
}
export async function prepareSnapshot(db:Database,input:{key:string;manifest:unknown;triggeredBy:string;csv:AsyncIterable<Uint8Array>;documents:AsyncIterable<SourceDocument>;allowMissingForRecovery?:boolean;poll?: (jobId:string)=>Promise<void>}){
 const manifest=ManifestSchema.parse(input.manifest),jobId=await createImportJob(db,input.key,manifest,input.triggeredBy);
 const selected=new Set(manifest.identities.map(m=>identityKey({...m,provider:manifest.provider}))),rows=new Map<string,CatalogCsvRow>();
 const proof=await verifyCatalogCsv(input.csv,{expectedSha256:manifest.csv.sha256,expectedBytes:manifest.csv.bytes,expectedRows:manifest.csv.rows,
  expectedSourceCounts:manifest.csv.sourceCounts,generatedAt:manifest.csv.generatedAt,downloadCompleted:true},async(row,index)=>{
   const key=identityKey({provider:'chinacarapi',source:row.source as 'che168'|'dongchedi',externalId:row.id});
   if(selected.has(key)){if(rows.has(key))throw new IngestionError('INGESTION_CSV_DUPLICATE');rows.set(key,row);}
   if(index%20_000===0)await input.poll?.(jobId); // Receive events while streaming; never hold DB locks across network calls.
  });
 if(rows.size!==selected.size&&!input.allowMissingForRecovery)throw new IngestionError('INGESTION_SNAPSHOT_MEMBERS_MISSING');
 const observedAt=manifest.generatedAt;
 // The CSV is complete; stage at most the fixed scope, not all source rows.
 let documentBytes=0;const archived=new Set<string>();
 const documents=new Map<string,SourceDocument[]>();
 for(const [key,row] of rows){const [provider,source,externalId]=key.split('/');documents.set(key,[{identity:{provider:provider as 'chinacarapi',source:source as 'che168'|'dongchedi',externalId:externalId!},kind:'csv',locale:'und',observedAt,sourceUpdatedAt:null,payload:row}]);}
 for await(const rawDocument of input.documents){
  let document=rawDocument;
  if(!document?.identity)throw new IngestionError('INGESTION_DOCUMENT_INVALID');
  if(document.rawResponse?.body){const response=document.rawResponse;if(!archived.has(response.hash)){await db.transaction(tx=>persistSourceResponse(tx,response as {hash:string;body:string}));archived.add(response.hash);}
   document={...document,rawResponse:{hash:response.hash}};}
  documentBytes+=Buffer.byteLength(JSON.stringify(document));if(documentBytes>96*1024*1024)throw new IngestionError('INGESTION_DOCUMENT_MEMORY_BUDGET');
  const key=identityKey(document.identity);if(!selected.has(key))throw new IngestionError('INGESTION_DOCUMENT_OUTSIDE_MANIFEST');
  const entries=documents.get(key)??[];documents.set(key,entries);if(entries.length>=32)throw new IngestionError('INGESTION_DOCUMENT_COUNT');entries.push(document);
 }
 let pending:IngestionEvent[]=[],page=0,cursor:string|null=null;
 const flush=async(terminal:boolean)=>{const next=terminal?null:`snapshot:${++page}`;
  await receivePage(db,jobId,{lane:'snapshot',inputCursor:cursor,nextCursor:next,terminal,events:pending});pending=[];cursor=next;};
 await db.transaction(async tx=>{for(const member of manifest.identities)await tx.query('UPDATE external_ingestion_members SET verification_pending=$5 WHERE job_id=$1 AND provider=$2 AND source=$3 AND external_id=$4',[jobId,manifest.provider,member.source,member.externalId,!rows.has(identityKey({...member,provider:manifest.provider}))]);});
 for(const member of manifest.identities){const identity={provider:manifest.provider,...member};
  if(!rows.has(identityKey(identity)))continue; // Even a complete CSV absence requires explicit source verification; never infer withdrawal.
  const doc=documents.get(identityKey(identity))!;
  if(!['zh','en','ru'].every(locale=>doc.some(x=>x.kind==='detail'&&x.locale===locale)))throw new IngestionError('INGESTION_REQUIRED_DETAIL_MISSING');
  pending.push({key:`snapshot:${manifest.csv.sha256}:${member.source}:${member.externalId}:${hash(doc)}`,identity:{provider:manifest.provider,source:member.source,externalId:member.externalId},operation:'upsert',snapshotHash:manifest.csv.sha256,businessOrder:'0',observedAt,document:doc});
  if(pending.length===200)await flush(false);
 }
 await flush(true);
 await verifySnapshot(db,jobId,proof as Manifest['csv']);
 return jobId;
}
