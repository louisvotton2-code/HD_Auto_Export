import {createHmac,randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {CapacityFailureCode} from '../../db/index.js';

export type FormalWriteStage='listing_lookup'|'listing_upsert'|'listing_same_material'|'public_projection'|'listing_binding';
export type DetailWriteStage=FormalWriteStage|'source_heads'|'load_source_documents'|'media_and_segments'|'representative';
type Stage=DetailWriteStage|'lock_job'|'load_pending_refs'|'prepare_member'|'finish_job'|'commit';
type Result='applied'|'skipped'|'failed';
type Breakdown=Partial<Record<Stage,number>>;
export type DetailMaterializationObservation={
 event:'external.full_sync.materialization_slice';workerFence:string|null;elapsedMs:number;
 prepared:number;attempted:number;applied:number;failed:number;stop:'complete'|'budget'|'statement_timeout'|'error';
 stageMs:Breakdown;readyPricePrefix?:true;
}|{
 event:'external.full_sync.materialization_attempt';workerFence:string|null;generation:string;listingToken:string;
 backendPid:number|null;startedAt:string;elapsedMs:number;stage:Stage;stageMs:Breakdown;
 path:'listing_upsert'|'listing_same_material'|null;result:Result;databaseCode:CapacityFailureCode|null;
};
export type DetailMaterializationObserver=(observation:DetailMaterializationObservation)=>void;
type Attempt={backendPid:number|null;enter:(stage:Stage)=>void;finish:(result:Result,code?:CapacityFailureCode)=>void};
const elapsed=(value:number)=>Math.round(value*10)/10;
const tokenKey=randomBytes(32);

export function observeMaterialization(sink:DetailMaterializationObserver,workerFence:string|null,prepared:number,readyPricePrefix:boolean) {
 const started=performance.now();
 const counts={attempted:0,applied:0,failed:0};
 const totals:Breakdown={};
 let sampleLogged=false;
 const emit=(value:DetailMaterializationObservation)=>{try{sink(value);}catch{/* Diagnostics must not interfere with syncing. */}};
 return {
  begin(source:string,id:string,generation:string):Attempt {
   counts.attempted++;
   const startedAt=Date.now(),start=performance.now(),stages:Breakdown={};
   let stage:Stage='lock_job',last=start,path:'listing_upsert'|'listing_same_material'|null=null;
   const measure=(end:number)=>{
    const ms=end-last;
    stages[stage]=(stages[stage]??0)+ms;
    totals[stage]=(totals[stage]??0)+ms;
    last=end;
   };
   return {
    backendPid:null,
    enter(next){
     if(stage===next)return;
     measure(performance.now());stage=next;
     if(next==='listing_upsert'||next==='listing_same_material')path=next;
    },
    finish(result,code){
     const now=performance.now();measure(now);
     if(result==='applied')counts.applied++;
     if(result==='failed')counts.failed++;
     if(code!=='SQL_STATEMENT_CANCELLED'&&(sampleLogged||(result!=='failed'&&now-start<1000)))return;
     sampleLogged=true;
     const listingToken=createHmac('sha256',tokenKey).update(source).update('\0').update(id).digest('hex').slice(0,24);
     emit({event:'external.full_sync.materialization_attempt',workerFence,generation,listingToken,backendPid:this.backendPid,
      startedAt:new Date(startedAt).toISOString(),elapsedMs:elapsed(now-start),stage,stageMs:rounded(stages),path,result,databaseCode:code??null});
    },
   };
  },
  finish(stop:Extract<DetailMaterializationObservation,{prepared:number}>['stop']) {
   if(counts.attempted)emit({event:'external.full_sync.materialization_slice',workerFence,elapsedMs:elapsed(performance.now()-started),
    prepared,...counts,stop,stageMs:rounded(totals),...(readyPricePrefix?{readyPricePrefix:true}:{})});
  },
 };
}

function rounded(stages:Breakdown):Breakdown {
 return Object.fromEntries(Object.entries(stages).map(([stage,ms])=>[stage,elapsed(ms)]));
}
