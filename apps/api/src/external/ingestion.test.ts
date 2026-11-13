import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ManifestSchema} from './ingestion/types.js';
import {isObsolete} from './ingestion/worker.js';
import {ChinaCarClient,deltaPage,ProviderHttpError} from './ingestion/provider.js';
const time='2026-11-13T00:00:00.000Z';
const manifest=()=>ManifestSchema.parse({version:1,provider:'chinacarapi',generatedAt:time,identities:[{source:'che168',externalId:'123',canonicalId:'car-1'}],csv:{sha256:'a'.repeat(64),bytes:10,rows:1,sourceCounts:{che168:1,dongchedi:0},generatedAt:time,complete:true}});
const json=(value:unknown,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
test('fixed manifest bounds canonical vehicles and source identity uniqueness',()=>{
 const m=manifest();m.identities=Array.from({length:301},(_,i)=>({source:'che168',externalId:String(i),canonicalId:String(i)}));assert.throws(()=>ManifestSchema.parse(m));
 m.identities[300]!.canonicalId='0';assert.equal(ManifestSchema.parse(m).identities.length,301);m.identities.push(m.identities[0]!);assert.throws(()=>ManifestSchema.parse(m));
});
test('withdrawal blocks stale or later detail and only a newer explicit relist revives',()=>{
 const prior={businessOrder:'100',withdrawn:true,observedAt:time};
 for(const order of ['99','100','101'])assert.equal(isObsolete({operation:'upsert',businessOrder:order,observedAt:time},prior),true);
 assert.equal(isObsolete({operation:'relist',businessOrder:'100',observedAt:time},prior),true);assert.equal(isObsolete({operation:'relist',businessOrder:'101',observedAt:time},prior),false);
});
test('same event permits fresh observation but rejects older evidence',()=>{
 const prior={businessOrder:'100',withdrawn:false,observedAt:time};assert.equal(isObsolete({operation:'upsert',businessOrder:'100',observedAt:'2026-11-12T00:00:00.000Z'},prior),true);
 assert.equal(isObsolete({operation:'upsert',businessOrder:'100',observedAt:'2026-11-14T00:00:00.000Z'},prior),false);
});
test('HTTP uses fixed origin, refuses redirects, and only selects fixed identities',async()=>{
 const paths:string[]=[];const client=new ChinaCarClient('fake-key',{fetch:async(input,init)=>{
  const u=new URL(String(input));paths.push(u.pathname+u.search);assert.equal(u.origin,'https://api.chinacarapi.com');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('x-api-key'),'fake-key');
  return json({cursor:0,nextCursor:2,hasMore:false,changes:[{id:1,source:'che168',vehicleId:'123',type:'removed',at:time},{id:2,source:'che168',vehicleId:'999',type:'new',at:time}]});}});
 const page=await deltaPage(client,manifest(),null,time);assert.equal(page.events.length,1);assert.equal(page.events[0]!.operation,'withdraw');assert.equal(page.nextCursor,'2');assert.equal(paths.length,1);assert.match(paths[0]!,/since=/);
});
test('429 bounded retry and 410 do not invent removals',async()=>{
 let calls=0;const waits:number[]=[];const client=new ChinaCarClient('fake-key',{fetch:async()=>{calls++;return json({},429,{'retry-after':'2'});},wait:async ms=>{waits.push(ms);}});
 await assert.rejects(client.changes(time,null),(e:unknown)=>e instanceof ProviderHttpError&&e.status===429);assert.equal(calls,3);assert.deepEqual(waits,[2000,2000]);
 const gone=new ChinaCarClient('fake-key',{fetch:async()=>json({},410)});await assert.rejects(gone.changes(time,null),(e:unknown)=>e instanceof ProviderHttpError&&e.status===410);assert.equal(gone.requestCount,1);
});
test('bulk rejects mismatched identity',async()=>{const client=new ChinaCarClient('fake-key',{fetch:async()=>json({results:[{id:'123',source:'dongchedi'}],notFound:[]})});await assert.rejects(client.bulk('che168',['123'],'en'));});
test('invalid and truncated responses never advance a page',async()=>{
 for(const response of [json({changes:[]}),new Response('{',{headers:{'content-type':'application/json'}})]){const client=new ChinaCarClient('fake-key',{fetch:async()=>response});await assert.rejects(client.changes(time,null));}
});
test('network is single-flight and request budget bounded',async()=>{
 let resolve!:(r:Response)=>void;const pending=new Promise<Response>(r=>{resolve=r;});const client=new ChinaCarClient('fake-key',{maxRequests:1,fetch:async()=>pending});const first=client.changes(time,null);
 await assert.rejects(client.changes(time,null),/INGESTION_NETWORK_CONCURRENCY/);resolve(json({cursor:0,nextCursor:0,hasMore:false,changes:[]}));await first;await assert.rejects(client.changes(time,null),/INGESTION_REQUEST_BUDGET/);
});
test('feed refuses a response that rolls the requested cursor backwards',async()=>{
 const client=new ChinaCarClient('fake-key',{fetch:async()=>json({cursor:50,nextCursor:80,hasMore:false,changes:[]})});await assert.rejects(client.changes(time,'100'),/INGESTION_RESPONSE_INVALID/);
});
test('raw package index selects a bulk identity while preserving the complete response and verifying bytes',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const {createHash}=await import('node:crypto');const {readDocuments}=await import('./ingestion/snapshot.js');
 const root=await mkdtemp(path.join(tmpdir(),'hd-ingestion-index-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'raw'));
 const body=JSON.stringify({results:[{source:'che168',id:'123',unknownField:'kept'},{source:'che168',id:'456'}],notFound:[],unknownEnvelope:{keep:true}});
 await writeFile(path.join(root,'raw/bulk.json'),body);const entry={identity:{provider:'chinacarapi',source:'che168',externalId:'123'},kind:'detail',locale:'zh',observedAt:time,sourceUpdatedAt:null,path:'raw/bulk.json',sha256:createHash('sha256').update(body).digest('hex')};
 const index=path.join(root,'documents.jsonl');await writeFile(index,JSON.stringify(entry)+'\n');const items=[];for await(const doc of readDocuments(index))items.push(doc);
 assert.equal(items.length,1);assert.deepEqual(items[0]!.payload,{source:'che168',id:'123',unknownField:'kept'});assert.equal(items[0]!.rawResponse!.body,body);
 await writeFile(index,JSON.stringify({...entry,sha256:'a'.repeat(64)})+'\n');await assert.rejects(async()=>{for await(const _ of readDocuments(index)){void _;}},/DOCUMENT_HASH/);
 await writeFile(index,JSON.stringify({...entry,path:'../outside.json'})+'\n');await assert.rejects(async()=>{for await(const _ of readDocuments(index)){void _;}},/DOCUMENT_PATH/);
});
