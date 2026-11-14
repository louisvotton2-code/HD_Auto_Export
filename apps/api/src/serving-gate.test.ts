import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ServingGate} from './serving-gate.js';
import {buildApp} from './app.js';
import {readConfig} from './config.js';
test('slot mode fails closed, drains started handlers and refuses auth side effects',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'hd-serving-')),file=path.join(root,'mode');
 const set=async(value:string)=>{await writeFile(file+'.next',value,{mode:0o600});await rename(file+'.next',file);};
 const gate=new ServingGate(file),request={};
 try{
  assert.equal(gate.mode(),'candidate');
  for(const [method,route] of [['POST','/api/v1/admin/vehicles'],['GET','/api/auth/get-session'],['GET','/api/v1/admin/me']])assert.throws(()=>gate.enter({},method!,route!));
  gate.enter({},'GET','/api/v1/vehicles');assert.equal(gate.status().inFlight,0);
  await set('active');gate.enter(request,'POST','/api/v1/admin/vehicles');gate.handling(request);
  await set('draining');gate.response(request);assert.equal(gate.status().inFlight,1,'An early response/connection closure must not finish the executing handler');
  assert.throws(()=>gate.enter({},'POST','/api/v1/admin/vehicles'));gate.finish(request);assert.equal(gate.status().inFlight,0);
  await set('active');let finish!:()=>void;const publicWrite=gate.optionalEffect(()=>new Promise<void>(resolve=>{finish=resolve;}));
  await set('draining');assert.equal(gate.status().inFlight,1);finish();await publicWrite;assert.equal(gate.status().inFlight,0);
  let called=false;await gate.optionalEffect(async()=>{called=true;});assert.equal(called,false);
  await set('invalid');assert.equal(gate.mode(),'candidate');
  const {app}=await buildApp(readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',AUTH_SECRET:'isolated-serving-gate-test-secret',API_SERVING_MODE_FILE:file}));
  try{
   for(const [method,url] of [['POST','/api/auth/sign-in/email'],['GET','/api/auth/get-session'],['GET','/api/v1/admin/me'],['POST','/api/v1/admin/vehicles/00000000-0000-4000-8000-000000000001/translation-plans'],['POST','/api/v1/admin/vehicles/00000000-0000-4000-8000-000000000001/translation-plans/00000000-0000-4000-8000-000000000002/generate']]){
    const response=await app.inject({method:method as 'GET'|'POST',url:url!});assert.equal(response.statusCode,503,response.body);assert.equal(response.headers['cache-control'],'no-store');
   }
   const state=await app.inject({url:'/health/serving'});assert.deepEqual(state.json(),{mode:'candidate',inFlight:0});
  }finally{await app.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
