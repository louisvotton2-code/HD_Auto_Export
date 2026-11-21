import assert from 'node:assert/strict';
import {test} from 'node:test';
import Fastify from 'fastify';
import {serializerCompiler,validatorCompiler} from 'fastify-type-provider-zod';
import type {Database} from '../db/index.js';
import {registerSeoRoutes} from './routes.js';
const result={enabled:true,validUntil:null,revision:'synthetic',items:[],nextCursor:null};
function server(db:Database){
 const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
 app.setErrorHandler((error,_request,reply)=>reply.status((error as {status?:number}).status??500).send({error:{code:'SERVICE_UNAVAILABLE',message:'Unavailable',retryable:true},meta:{requestId:'test'}}));
 registerSeoRoutes(app,db,true);return app;
}
test('manifest generation admits one request without a queue and releases the lane after success',async()=>{
 let finish!:(value:typeof result)=>void,started!:()=>void,calls=0;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const app=server({transaction:async()=>{calls++;started();return new Promise(resolve=>{finish=resolve;});}} as unknown as Database);
 try{
  const first=app.inject('/api/v1/seo/vehicles');await entered;
  const busy=await app.inject('/api/v1/seo/vehicles');assert.equal(busy.statusCode,503);assert.equal(calls,1);
  finish(result);assert.equal((await first).statusCode,200);
  const next=app.inject('/api/v1/seo/vehicles');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
  finish(result);assert.equal((await next).statusCode,200);
 }finally{await app.close();}
});
test('image deadline crossed during a manifest read returns 503 and the lane can be retried',async()=>{
 let calls=0;
 const app=server({transaction:async()=>({...result,validUntil:++calls===1?new Date(Date.now()-1000).toISOString():null})} as unknown as Database);
 try{assert.equal((await app.inject('/api/v1/seo/vehicles')).statusCode,503);assert.equal((await app.inject('/api/v1/seo/vehicles')).statusCode,200);}
 finally{await app.close();}
});
