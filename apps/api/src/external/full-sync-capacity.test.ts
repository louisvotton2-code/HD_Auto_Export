import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,rename,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readCapacityDecision} from './full-sync/capacity.js';

test('capacity decisions fail closed for missing, stale, mismatched and unsafe files; atomic allow is revocable',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'hd-capacity-')),file=path.join(root,'decision.json'),now=Date.parse('2026-11-14T00:00:00Z');
 const binding={snapshotId:randomUUID(),targetRows:480000,sampleRows:10000,evidenceHash:'a'.repeat(64)};
 const disk={total:400*1024**3,available:350*1024**3,used:.125};
 const good={schemaVersion:1,model:'hd-ext07-peak-v1',...binding,measuredAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),decision:'allow',reason:'within_budget',projectedPeakBytes:200*1024**3,diskTotalBytes:disk.total,currentUsedBytes:disk.total-disk.available,components:{model:'measured_components',remainingGrowthBytes:1024}};
 const replace=async(value:unknown)=>{const temporary=file+'.next';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,file);};
 const read=(at=now,cap=0)=>readCapacityDecision(file,binding,disk,cap,at);
 try{
  assert.equal((await read()).code,'SYNC_CAPACITY_AWAITING_DECISION');
  for(const patch of [{evidenceHash:'b'.repeat(64)},{snapshotId:randomUUID()},{sampleRows:9999},{targetRows:1},{schemaVersion:2},{model:'other'},{extra:'private'},{projectedPeakBytes:null},{projectedPeakBytes:-1},{projectedPeakBytes:1},{projectedPeakBytes:Number.MAX_SAFE_INTEGER+1},{currentUsedBytes:disk.total+1},{diskTotalBytes:disk.total+1},{components:{url:'https://private.example'}},{decision:'wait'},{decision:'blocked'},{measuredAt:new Date(now+60001).toISOString()},{expiresAt:new Date(now+600001).toISOString()},{expiresAt:new Date(now).toISOString()}]){
   await replace({...good,...patch});assert.equal((await read()).allowed,false,JSON.stringify(patch));
  }
  await writeFile(file,'{"schemaVersion":',{mode:0o600});assert.equal((await read()).allowed,false);
  await writeFile(file,'x'.repeat(65537),{mode:0o600});assert.equal((await read()).allowed,false);
  await replace(good);await chmod(file,0o666);assert.equal((await read()).allowed,false);await chmod(file,0o600);
  await replace(good);assert.equal((await read()).allowed,true);assert.equal((await read(now+600000)).allowed,false);
  assert.equal((await read(now,100)).code,'SYNC_CAPACITY_BUDGET_CAP');
  await replace({...good,projectedPeakBytes:disk.total*.7});assert.equal((await read()).code,'SYNC_CAPACITY_LIMIT');
  await replace(good);assert.equal((await readCapacityDecision(file,binding,{...disk,available:disk.total*.3,used:.7},0,now)).code,'SYNC_CAPACITY_LIMIT');
  const linked=path.join(root,'link.json');await symlink(file,linked);assert.equal((await readCapacityDecision(linked,binding,disk,0,now)).allowed,false);
  // Reader reopens each time; it sees complete old/new files and never caches an allow permanently.
  for(let i=0;i<8;i++){
   const [,during]=await Promise.all([replace({...good,decision:i%2?'wait':'allow'}),read()]);
   assert.notEqual(during.decision,null,'An atomic replacement yields one complete JSON inode');
   assert.equal((await read()).allowed,i%2===0);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
