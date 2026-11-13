import {z} from 'zod';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {IngestionError,type Manifest,type IngestionEvent,identityKey} from './types.js';
const ordinal=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ChangeSchema=z.looseObject({id:ordinal,source:z.enum(['che168','dongchedi']),vehicleId:z.string().min(1).max(300),
 type:z.enum(['new','price','removed','relisted']),at:z.iso.datetime({offset:true})});
const ChangesSchema=z.looseObject({cursor:ordinal,nextCursor:ordinal,hasMore:z.boolean(),changes:z.array(ChangeSchema).max(200)});
const BulkSchema=z.looseObject({results:z.array(z.looseObject({id:z.string(),source:z.enum(['che168','dongchedi'])})).max(200),notFound:z.array(z.string()).max(200)});
export class ProviderHttpError extends IngestionError{constructor(readonly status:number){super(status===410?'INGESTION_CURSOR_EXPIRED':status===429?'INGESTION_RATE_LIMITED':'INGESTION_PROVIDER_UNAVAILABLE');}}
export class ChinaCarClient {
 private inFlight=false; private requests=0;
 constructor(private readonly key:string,private readonly options:{fetch?:typeof fetch;wait?:(ms:number)=>Promise<void>;beforeRequest?:()=>Promise<void>;maxRequests?:number;timeoutMs?:number}={}){
  if(!/^[\x21-\x7e]{1,1024}$/.test(key))throw new IngestionError('INGESTION_KEY_INVALID');
 }
 get requestCount(){return this.requests;}
 private async request(path:string,body?:unknown):Promise<{payload:unknown;rawResponse:{hash:string;body:string}}>{
  if(this.inFlight)throw new IngestionError('INGESTION_NETWORK_CONCURRENCY');
  this.inFlight=true;
  try{
   for(let attempt=0;attempt<3;attempt++){
    if(this.requests>=(this.options.maxRequests??2000))throw new IngestionError('INGESTION_REQUEST_BUDGET');
    await this.options.beforeRequest?.();this.requests++;
    const signal=AbortSignal.timeout(this.options.timeoutMs??20_000);
    let response:Response;
    try{response=await (this.options.fetch??fetch)(`https://api.chinacarapi.com${path}`,{method:body===undefined?'GET':'POST',redirect:'error',signal,
     headers:{accept:'application/json','x-api-key':this.key,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch{throw new IngestionError('INGESTION_PROVIDER_UNAVAILABLE');}
    if(response.status===429||response.status>=500){
     const value=response.headers.get('retry-after');await response.body?.cancel();
     const seconds=value&&/^\d+$/.test(value)?Number(value):2**attempt;
     if(attempt===2||seconds>30)throw new ProviderHttpError(response.status);
     await (this.options.wait??(ms=>delay(ms)))(seconds*1000);continue;
    }
    if(!response.ok){await response.body?.cancel();throw new ProviderHttpError(response.status);}
    if(!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw new IngestionError('INGESTION_RESPONSE_INVALID');}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
    try{while(true){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;length+=part.value.length;
      if(length>16*1024*1024)throw new IngestionError('INGESTION_RESPONSE_TOO_LARGE');chunks.push(part.value);}
     const bytes=Buffer.concat(chunks),body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {payload:JSON.parse(body),rawResponse:{hash:createHash('sha256').update(bytes).digest('hex'),body}};
    }catch{await reader.cancel().catch(()=>{});throw new IngestionError('INGESTION_RESPONSE_INVALID');}
    finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
   }
   throw new IngestionError('INGESTION_PROVIDER_UNAVAILABLE');
  }finally{this.inFlight=false;}
 }
 async changes(generatedAt:string,cursor:string|null){
  const query=new URLSearchParams({limit:'200'});
  if(cursor===null){z.iso.datetime({offset:true}).parse(generatedAt);query.set('since',generatedAt);}
  else{if(!/^\d{1,16}$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))throw new IngestionError('INGESTION_CURSOR_INVALID');query.set('cursor',cursor);}
  const response=await this.request(`/api/catalog/changes?${query}`),page=ChangesSchema.parse(response.payload);
  if((cursor!==null&&page.cursor!==Number(cursor))||page.changes.some(e=>e.id<=page.cursor)||page.nextCursor<page.cursor||(page.hasMore&&page.nextCursor<=page.cursor)||
   page.changes.some((event,i)=>event.id>page.nextCursor||(i>0&&event.id<=page.changes[i-1]!.id)))throw new IngestionError('INGESTION_RESPONSE_INVALID');
  return {...page,rawResponse:response.rawResponse};
 }
 async bulk(source:'che168'|'dongchedi',ids:string[],locale:'zh'|'en'|'ru'){
  if(ids.length<1||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>!/^\d{1,30}$/.test(id)))throw new IngestionError('INGESTION_BULK_INVALID');
  const query=new URLSearchParams({source});if(locale!=='en')query.set('lang',locale);
  const response=await this.request(`/api/vehicle/bulk?${query}`,{ids}),result=BulkSchema.parse(response.payload);
  if(result.results.some(item=>item.source!==source||!ids.includes(item.id))||result.notFound.some(id=>!ids.includes(id))||
   new Set([...result.results.map(x=>x.id),...result.notFound]).size!==ids.length||result.results.length+result.notFound.length!==ids.length)throw new IngestionError('INGESTION_RESPONSE_INVALID');
  return {...result,rawResponse:response.rawResponse};
 }
}
/** Hydrate only fixed members. No source URL, redirect or arbitrary endpoint can carry the API key. */
export async function deltaPage(client:ChinaCarClient,manifest:Manifest,cursor:string|null,observedAt=new Date().toISOString()){
 const page=await client.changes(manifest.generatedAt,cursor);
 const allowed=new Set(manifest.identities.map(m=>identityKey({...m,provider:manifest.provider})));
 const selected=page.changes.filter(x=>allowed.has(identityKey({provider:'chinacarapi',source:x.source,externalId:x.vehicleId})));
 const events:IngestionEvent[]=selected.map(change=>{
  const identity={provider:'chinacarapi' as const,source:change.source,externalId:change.vehicleId};
  return {key:`change:${change.id}`,identity,operation:change.type==='removed'?'withdraw':change.type==='relisted'?'relist':'upsert',
   businessOrder:String(change.id),observedAt,document:[{identity,kind:'event',locale:'und',observedAt,sourceUpdatedAt:change.at,eventSequence:String(change.id),payload:change,rawResponse:{hash:page.rawResponse.hash}}]};
 });
 return {lane:'delta' as const,inputCursor:cursor,nextCursor:String(page.nextCursor),terminal:!page.hasMore,events,rawResponse:page.rawResponse};
}
