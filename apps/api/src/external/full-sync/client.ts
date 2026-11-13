import {createHash} from 'node:crypto';
import {open,rename,unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {FullSyncError,LIMITS,type Source,type Locale,type Bulk,type Changes,type Raw} from './types.js';
const ordinal=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const source=z.enum(['che168','dongchedi']);
const change=z.looseObject({id:ordinal,source,vehicleId:z.string().regex(/^\d{1,100}$/),type:z.enum(['new','price','removed','relisted']),at:z.iso.datetime({offset:true})});
const changes=z.looseObject({cursor:ordinal,nextCursor:ordinal,hasMore:z.boolean(),changes:z.array(change).max(LIMITS.events)});
const bulk=z.looseObject({results:z.array(z.looseObject({id:z.string(),source})).max(500),notFound:z.array(z.string()).max(500)});
export function retryAfter(value:string|null,now=Date.now()){
 if(!value)return 1000;const ms=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now;
 return Number.isFinite(ms)?Math.max(500,ms):1000;
}
export class FullSyncClient{
 private busy=false;private lastRequest=0;
 constructor(private key:string,private options:{fetch?:typeof fetch;wait?:(ms:number)=>Promise<void>;beforeRequest?:()=>Promise<void>;beforeBulk?:(ids:number,source:Source)=>Promise<void>;defer?:(ms:number)=>Promise<void>;timeoutMs?:number}={}){
  if(!/^[\x21-\x7e]{1,1024}$/.test(key))throw new FullSyncError('SYNC_KEY_INVALID');
 }
 private async response(endpoint:string,body?:unknown,timeoutMs=this.options.timeoutMs??30_000){
  await (this.options.wait??delay)(Math.max(0,500-(Date.now()-this.lastRequest)));await this.options.beforeRequest?.();this.lastRequest=Date.now();
  let response:Response;try{response=await (this.options.fetch??fetch)(`https://api.chinacarapi.com${endpoint}`,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'x-api-key':this.key,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw new FullSyncError('SYNC_TIMEOUT');}
  if(!response.ok){await response.body?.cancel();const wait=response.status===429?retryAfter(response.headers.get('retry-after')):1000;
   if(response.status===429)await this.options.defer?.(wait);
   throw new FullSyncError(response.status===410?'SYNC_CURSOR_EXPIRED':response.status===429?'SYNC_RATE_LIMITED':response.status===413?'SYNC_TOO_LARGE':`SYNC_HTTP_${response.status}`,wait);}
  return response;
 }
 private async exclusive<T>(work:()=>Promise<T>){if(this.busy)throw new FullSyncError('SYNC_NETWORK_BUSY');this.busy=true;try{return await work();}finally{this.busy=false;}}
 private async json(endpoint:string,body?:unknown):Promise<{payload:unknown;rawResponse:Raw}>{return this.exclusive(async()=>{
  const response=await this.response(endpoint,body);if(!response.body)throw new FullSyncError('SYNC_RESPONSE_INVALID');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>LIMITS.bodyBytes)throw new FullSyncError('SYNC_TOO_LARGE');chunks.push(value.value);}
   const bytes=Buffer.concat(chunks),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {payload:JSON.parse(text),rawResponse:{hash:createHash('sha256').update(bytes).digest('hex'),body:text}};
  }catch(e){if(e instanceof FullSyncError)throw e;if(e instanceof Error&&['AbortError','TimeoutError'].includes(e.name))throw new FullSyncError('SYNC_TIMEOUT');throw new FullSyncError('SYNC_RESPONSE_INVALID');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 });}
 async probeExport(){return this.exclusive(async()=>{const response=await this.response('/api/catalog/export');await response.body?.cancel();const at=response.headers.get('x-generated-at');if(!at||!Number.isFinite(Date.parse(at)))throw new FullSyncError('SYNC_EXPORT_HEADER');return new Date(at).toISOString();});}
 async downloadExport(file:string,checkSpace:()=>Promise<void>){return this.exclusive(async()=>{
  const response=await this.response('/api/catalog/export',undefined,30*60_000),at=response.headers.get('x-generated-at');
  if(!response.body||!at||!Number.isFinite(Date.parse(at))){await response.body?.cancel();throw new FullSyncError('SYNC_EXPORT_HEADER');}
  const temporary=file+'.partial',output=await open(temporary,'w',0o600),reader=response.body.getReader(),digest=createHash('sha256');let bytes=0,lastCheck=0;
  try{for(;;){if(Date.now()-lastCheck>10_000){await checkSpace();lastCheck=Date.now();}const part=await reader.read();if(part.done)break;bytes+=part.value.length;digest.update(part.value);
    let offset=0;while(offset<part.value.length){const written=await output.write(part.value,offset,part.value.length-offset);if(!written.bytesWritten)throw new FullSyncError('SYNC_DISK_WRITE');offset+=written.bytesWritten;}}
   if(!bytes)throw new FullSyncError('SYNC_EXPORT_EMPTY');await output.sync();await output.close();await rename(temporary,file);
   return {sha256:digest.digest('hex'),bytes,generatedAt:new Date(at).toISOString()};
  }catch(e){await output.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw e;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 });}
 async changes(since:string,cursor:string|null):Promise<Changes>{
  const q=new URLSearchParams({limit:String(LIMITS.events)});if(cursor===null)q.set('since',since);else {if(!/^\d{1,16}$/.test(cursor))throw new FullSyncError('SYNC_CURSOR_INVALID');q.set('cursor',cursor);}
  const raw=await this.json(`/api/catalog/changes?${q}`),page=changes.parse(raw.payload);
  if(cursor!==null&&page.cursor!==Number(cursor)||page.nextCursor<page.cursor||page.hasMore&&page.nextCursor<=page.cursor||page.changes.some((e,i)=>e.id<=page.cursor||e.id>page.nextCursor||i>0&&e.id<=page.changes[i-1]!.id))throw new FullSyncError('SYNC_CURSOR_INVALID');
  return {...page,rawResponse:raw.rawResponse};
 }
 /** Each successful half is yielded and persisted before requesting the next half. No result array grows with catalog size. */
 async *bulk(source:Source,ids:string[],locale:Locale):AsyncGenerator<Bulk>{
  if(!ids.length||ids.length>500||new Set(ids).size!==ids.length||ids.some(id=>!/^\d{1,100}$/.test(id)))throw new FullSyncError('SYNC_BULK_INVALID');
  const q=new URLSearchParams({source});if(locale!=='en')q.set('lang',locale);
  let raw;try{await this.options.beforeBulk?.(ids.length,source);raw=await this.json(`/api/vehicle/bulk?${q}`,{ids});}catch(e){
   if(e instanceof FullSyncError&&['SYNC_TIMEOUT','SYNC_TOO_LARGE'].includes(e.code)&&ids.length>1){const middle=Math.ceil(ids.length/2);yield* this.bulk(source,ids.slice(0,middle),locale);yield* this.bulk(source,ids.slice(middle),locale);return;}if(e instanceof FullSyncError)e.affectedIds??=ids;throw e;
  }
  const result=bulk.parse(raw.payload),returned=[...result.results.map(r=>r.id),...result.notFound];
  if(returned.length!==ids.length||new Set(returned).size!==ids.length||returned.some(id=>!ids.includes(id))||result.results.some(r=>r.source!==source))throw new FullSyncError('SYNC_BULK_IDENTITY');
  yield {...result,rawResponse:raw.rawResponse};
 }
 daily(kind:'account'|'dictionary'){return this.json(kind==='account'?'/api/me':'/api/enums');}
 report(source:Source,id:string){if(!/^\d{1,100}$/.test(id))throw new FullSyncError('SYNC_ID_INVALID');return this.json(`/api/inspection/${id}?source=${source}`);}
}
