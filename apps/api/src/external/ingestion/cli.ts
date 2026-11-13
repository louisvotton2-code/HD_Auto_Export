import {readFile,statfs} from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {availableParallelism,loadavg} from 'node:os';
import {createDatabase} from '../../db/index.js';
import {readDatabaseEnvironment,readLocalSecret} from '../../local-secrets.js';
import {ManifestSchema,IngestionError} from './types.js';
import {FixedScopeWorker,receivePage,recoverExpiredCursor,beginCatchUp} from './worker.js';
import {ChinaCarClient,deltaPage} from './provider.js';
import {prepareSnapshot,readDocuments} from './snapshot.js';
import {verifyCatalogCsv} from '../sources/index.js';
import {applyIngestionEvent} from './apply.js';
import {ingestionStatus} from './status.js';
import {hydratePending} from './hydrate.js';

async function main(){
 const [command,...args]=process.argv.slice(2),flags=new Map<string,string>();
 if(!['prepare','catch-up','once','status','recover'].includes(command??'')||args.length%2)throw new IngestionError('INGESTION_USAGE');
 for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1]!;if(!/^--[a-z-]+$/.test(key)||flags.has(key))throw new IngestionError('INGESTION_USAGE');flags.set(key,value);}
 const need=(key:string)=>{const value=flags.get(key);if(!value)throw new IngestionError('INGESTION_USAGE');return value;};
 const allowed=new Set(['--job','--manifest','--csv','--documents','--job-key','--triggered-by','--key-file','--max-pages','--max-batches','--package']);
 if([...flags.keys()].some(key=>!allowed.has(key)))throw new IngestionError('INGESTION_USAGE');
 const bounded=(name:string,fallback:number)=>{const value=flags.get(name)??String(fallback);if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>2000)throw new IngestionError('INGESTION_USAGE');return Number(value);};
 const env=readDatabaseEnvironment();if(!env.DATABASE_URL)throw new IngestionError('INGESTION_DATABASE_REQUIRED');
 if(env.EXTERNAL_SYNC_MODE&&env.EXTERNAL_SYNC_MODE!=='off')throw new IngestionError('INGESTION_CONTINUOUS_FORBIDDEN');
 const db=createDatabase(env.DATABASE_URL,2);
 let jobId=flags.get('--job');
 const pressure=async()=>{const disk=await statfs(env.INGESTION_DISK_PATH??'/');if(disk.blocks<=0||1-disk.bavail/disk.blocks>=.75||loadavg()[0]!>availableParallelism())throw new IngestionError('INGESTION_RESOURCE_PRESSURE');};
 const getJob=async()=>{if(!jobId||!/^[-a-f0-9]{36}$/.test(jobId))throw new IngestionError('INGESTION_JOB_INVALID');
  const row=(await db.pool.query('SELECT * FROM external_ingestion_jobs WHERE id=$1',[jobId])).rows[0];if(!row)throw new IngestionError('INGESTION_NOT_FOUND');return row;};
 let client:ChinaCarClient|undefined;
 const getClient=()=>client??=new ChinaCarClient(readLocalSecret(need('--key-file'),1024),{beforeRequest:async()=>{
  await pressure();const row=await db.pool.query('UPDATE external_ingestion_jobs SET network_requests=network_requests+1 WHERE id=$1 AND network_requests<10000 RETURNING id',[jobId]);
  if(!row.rowCount)throw new IngestionError('INGESTION_REQUEST_BUDGET');
 }});
 const poll=async(terminalAllowed:boolean)=>{
  const job=await getJob();if(job.completed_lanes.delta)return false;
  const page=await deltaPage(getClient(),ManifestSchema.parse(job.manifest),job.receive_cursors.delta??null);
  if(!terminalAllowed&&page.events.length===0&&page.nextCursor===(job.receive_cursors.delta??null))return false;
  if(!terminalAllowed)page.terminal=false;
  await receivePage(db,jobId!,page);return !page.terminal;
 };
 try{
  if(command==='prepare'||command==='recover'){
   const packageDir=flags.get('--package');
   let manifest;
   if(packageDir){const catalog=JSON.parse(await readFile(path.join(packageDir,'catalog-manifest.json'),'utf8'));
    const identities=JSON.parse(await readFile(path.join(packageDir,'identities.json'),'utf8'));
    manifest=ManifestSchema.parse({version:1,provider:'chinacarapi',generatedAt:catalog.generatedAt,identities,csv:{sha256:catalog.sha256,bytes:catalog.bytes,rows:catalog.rows,sourceCounts:catalog.sourceCounts,generatedAt:catalog.generatedAt,complete:catalog.complete}});
    flags.set('--csv',path.join(packageDir,'catalog.csv'));flags.set('--documents',path.join(packageDir,'documents.jsonl'));
   }else manifest=ManifestSchema.parse(JSON.parse(await readFile(need('--manifest'),'utf8')));
   let key=flags.get('--job-key');
   if(command==='recover'){
    const previous=await getJob();key=previous.job_key;
    if(JSON.stringify(previous.manifest.identities)!==JSON.stringify(manifest.identities))throw new IngestionError('INGESTION_MANIFEST_CONFLICT');
    const p=await verifyCatalogCsv(createReadStream(need('--csv')),{expectedSha256:manifest.csv.sha256,expectedBytes:manifest.csv.bytes,expectedRows:manifest.csv.rows,expectedSourceCounts:manifest.csv.sourceCounts,generatedAt:manifest.csv.generatedAt,downloadCompleted:true},()=>{});
    await recoverExpiredCursor(db,jobId!,p);
   }
   if(!key)throw new IngestionError('INGESTION_USAGE');
   jobId=await prepareSnapshot(db,{key,manifest,allowMissingForRecovery:command==='recover',triggeredBy:need('--triggered-by'),csv:createReadStream(need('--csv')),documents:readDocuments(need('--documents')),
    poll:async id=>{jobId=id;await poll(false);}});
   // A final catch-up starts after complete snapshot validation; importing a CSV prefix never completes a job.
  }
  if(command==='catch-up')await beginCatchUp(db,jobId??need('--job'));
  if(command==='prepare'||command==='recover'||command==='catch-up'){
   let more=true;const limit=bounded('--max-pages',100);
   for(let i=0;i<limit&&more;i++)more=await poll(true);
   if(more)throw new IngestionError('INGESTION_PAGE_BUDGET');
  }
  if(command!=='status'){
   const worker=new FixedScopeWorker(db,applyIngestionEvent);const limit=bounded('--max-batches',100);
   for(let i=0;i<limit;i++){await pressure();const result=await worker.tick(jobId??need('--job'));if(result.state==='complete'||result.state==='unavailable')break;
    if(!result.processed){if(!await hydratePending(db,getClient(),jobId!))break;}}
  }
  const job=await getJob();
  const counts=(await db.pool.query(`SELECT count(*)::integer AS raw_identities,count(DISTINCT canonical_id)::integer AS canonical,count(*) FILTER(WHERE verification_pending)::integer AS verification_pending FROM external_ingestion_members WHERE job_id=$1`,[job.id])).rows[0];
  const summary=await ingestionStatus(db,job.id);
  console.log(JSON.stringify({public:summary.latestJob?.publicVehicleCount??0,jobId:job.id,state:job.state,received:job.received_seq,applied:job.applied_seq,networkRequests:job.network_requests,...counts,continuous:false}));
  if(command!=='status'&&job.state!=='complete')process.exitCode=2;
 }finally{await db.close();}
}
try{await main();}catch(error){console.error(JSON.stringify({status:'stopped',code:error instanceof IngestionError?error.code:'INGESTION_FAILED',continuous:false}));process.exitCode=1;}
