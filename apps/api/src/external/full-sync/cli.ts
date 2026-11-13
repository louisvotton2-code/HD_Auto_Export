import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createDatabase} from '../../db/index.js';
import {readDatabaseEnvironment,readLocalSecret} from '../../local-secrets.js';
import {protectSourceBackup,releaseSourceReferences} from '../sources/index.js';
import {FullSyncError} from './types.js';
import {FullSyncClient} from './client.js';
import {FullSyncWorker,configureFullSync} from './engine.js';
import {fullSyncStatus,setFullSyncPaused} from './status.js';
async function main(){
 const [command,...args]=process.argv.slice(2),flags=new Map<string,string>();
 if(!['configure','run','serve','status','control','archive-pin','archive-release'].includes(command??'')||args.length%2)throw new FullSyncError('SYNC_USAGE');
 for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1]!;if(!['--mode','--actor','--max-ticks','--action','--version','--key','--reference'].includes(key)||flags.has(key))throw new FullSyncError('SYNC_USAGE');flags.set(key,value);}
 const need=(key:string)=>{const value=flags.get(key);if(!value)throw new FullSyncError('SYNC_USAGE');return value;};
 const env=readDatabaseEnvironment();if(!env.DATABASE_URL)throw new FullSyncError('SYNC_DATABASE_REQUIRED');
 const db=createDatabase(env.DATABASE_URL,2);let worker:FullSyncWorker|undefined;
 try{
  if(command==='archive-pin'||command==='archive-release'){const reference=need('--reference');if(!/^[a-zA-Z0-9._:-]{1,160}$/.test(reference))throw new FullSyncError('SYNC_REFERENCE_INVALID');
   const result=await db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(78291334)');
    if(command==='archive-pin'){const blobs=await protectSourceBackup(tx,reference);const snapshots=(await tx.query('INSERT INTO external_full_archive_pins SELECT id,$1 FROM external_full_snapshots WHERE archive_pruned_at IS NULL ON CONFLICT DO NOTHING',[reference])).rowCount;return {reference,blobs,snapshots};}
    await releaseSourceReferences(tx,'backup',reference);const snapshots=(await tx.query('DELETE FROM external_full_archive_pins WHERE reference=$1',[reference])).rowCount;return {reference,snapshots,released:true};
   });console.log(JSON.stringify(result));return;
  }else if(command==='configure'){const mode=need('--mode');if(!['full','continuous'].includes(mode))throw new FullSyncError('SYNC_USAGE');await configureFullSync(db,{id:need('--actor'),requestId:'full-sync:configure'},mode as 'full'|'continuous');}
  else if(command==='control'){const action=need('--action');if(!['pause','resume'].includes(action))throw new FullSyncError('SYNC_USAGE');
   console.log(JSON.stringify(await setFullSyncPaused(db,{version:Number(need('--version')),action:action as 'pause'|'resume'},{id:need('--actor'),requestId:'full-sync:control'},need('--key'))));return;
  }else if(command!=='status'){
   const directory=env.FULL_SYNC_ARCHIVE_ROOT;if(!directory||!path.isAbsolute(directory))throw new FullSyncError('SYNC_ARCHIVE_ROOT_REQUIRED');await mkdir(directory,{recursive:true,mode:0o700});
   if(!env.CHINACARAPI_KEY_FILE)throw new FullSyncError('SYNC_KEY_FILE_REQUIRED');
   const client=new FullSyncClient(readLocalSecret(env.CHINACARAPI_KEY_FILE,1024),{
    beforeRequest:async()=>{
     const row=(await db.pool.query('SELECT greatest(0,extract(epoch FROM(request_after-clock_timestamp()))*1000) AS wait FROM external_full_sync WHERE id=1')).rows[0]!;
     const wait=Number(row.wait);if(wait>60_000)throw new FullSyncError('SYNC_RATE_LIMITED',wait);if(wait)await delay(wait);
     await db.pool.query("UPDATE external_full_sync SET request_after=clock_timestamp()+interval '500 milliseconds' WHERE id=1");
    },defer:async ms=>{await db.pool.query("UPDATE external_full_sync SET request_after=greatest(request_after,clock_timestamp()+$1*interval '1 millisecond') WHERE id=1",[ms]);},
    beforeBulk:async count=>{await db.transaction(async tx=>{
     const s=(await tx.query('SELECT *,current_date AS today FROM external_full_sync WHERE id=1 FOR UPDATE')).rows[0]!;
     if(!s.account)throw new FullSyncError('SYNC_ACCOUNT_REQUIRED');const plan=String(s.account.plan).toLowerCase();
     const previous=String(s.bulk_day)===String(s.today)?s.bulk_ids:0;
     if(plan==='trial'&&previous+count>1000)throw new FullSyncError('SYNC_ACCOUNT_DAILY_LIMIT');
     await tx.query('UPDATE external_full_sync SET bulk_day=current_date,bulk_ids=$1 WHERE id=1',[previous+count]);
    });}
   });
   worker=new FullSyncWorker(db,client,directory);if(!await worker.acquire()){process.exitCode=75;return;}
   let stopped=false;process.once('SIGTERM',()=>{stopped=true;});process.once('SIGINT',()=>{stopped=true;});
   const max=Number(flags.get('--max-ticks')??1);if(!Number.isInteger(max)||max<1||max>10000)throw new FullSyncError('SYNC_USAGE');
   for(let i=0;!stopped&&(command==='serve'||i<max);i++){
    try{await worker.tick();}catch(error){if(command!=='serve')throw error;console.error(JSON.stringify({code:error instanceof FullSyncError?error.code:'SYNC_FAILED'}));await delay(Math.min(60_000,Math.max(5000,error instanceof FullSyncError?error.retryAfterMs:5000)));}
    if(command==='serve')await delay(5000);
   }
  }
  const status=await fullSyncStatus(db);console.log(JSON.stringify(status));if(command==='run'&&!['complete','idle'].includes(status.state))process.exitCode=2;
 }finally{await worker?.close();await db.close();}
}
try{await main();}catch(error){console.error(JSON.stringify({code:error instanceof FullSyncError?error.code:'SYNC_FAILED'}));process.exitCode=1;}
