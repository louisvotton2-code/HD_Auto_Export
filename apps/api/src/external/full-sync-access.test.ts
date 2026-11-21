import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FullSyncAccessHints} from './full-sync/access.js';
import {ServingGate} from '../serving-gate.js';
test('hot hints detach, deduplicate, bound active work and retain serving drain accounting',async()=>{
 const gate=new ServingGate(),pending:Array<()=>void>=[],ids:string[]=[];
 let now=0;const hints=new FullSyncAccessHints(async id=>{ids.push(id);await new Promise<void>(r=>pending.push(r));},work=>gate.optionalEffect(work),()=>now);
 assert.equal(hints.hint('one'),undefined);hints.hint('one');hints.hint('two');hints.hint('three');assert.deepEqual(ids,['one','two']);assert.equal(gate.status().inFlight,2);
 pending.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));assert.equal(gate.status().inFlight,0);
 hints.hint('one');assert.equal(ids.length,2);now=3_600_000;hints.hint('one');assert.equal(ids.length,3);pending.splice(0).forEach(r=>r());await hints.close();hints.hint('four');assert.equal(ids.length,3);
});
test('hot hints have a bounded hour map and failures or nonactive admission do not consume the hour',async()=>{
 let writes=0,allow=false,fail=true,now=0;const hints=new FullSyncAccessHints(async()=>{writes++;if(fail)throw new Error('synthetic');},async work=>{if(allow)await work();},()=>now);
 hints.hint('one');await new Promise(r=>setImmediate(r));allow=true;hints.hint('one');await new Promise(r=>setImmediate(r));assert.equal(writes,1);
 fail=false;hints.hint('one');await new Promise(r=>setImmediate(r));assert.equal(writes,2);
 for(let i=1;i<2048;i++){hints.hint(String(i));await new Promise(r=>setImmediate(r));}
 hints.hint('over-cap');await new Promise(r=>setImmediate(r));assert.equal(writes,2049);
 now=3_600_001;hints.hint('over-cap');await hints.close();assert.equal(writes,2050);
});
