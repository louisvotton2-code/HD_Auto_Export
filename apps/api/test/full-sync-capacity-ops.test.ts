import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readCapacityDecision} from '../src/external/full-sync/capacity.js';

// Run on the integrated BE + OPS checkout. No copied controller, fallback output or skipped missing producer.
// Import only decision/atomic_write; never main(), live measurement, production paths or supplier calls.
test('BE consumes actual OPS controller output for allow, limit, insufficient sample and failed measurement',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'hd-capacity-ops-'));
 const controller=fileURLToPath(new URL('../../../deploy/runtime/production/capacity-decision.py',import.meta.url));
 const now=Date.parse('2026-11-14T00:00:00Z');
 const binding={snapshotId:'00000000-0000-4000-8000-000000000007',targetRows:480000,sampleRows:10000,evidenceHash:'a'.repeat(64)};
 const disk={total:1000000000,available:800000000,used:.2};
 const measurement={...binding,sampleEvidenceSufficient:true,projectedPeakBytes:699999999,diskTotalBytes:disk.total,currentUsedBytes:disk.total-disk.available,components:{databaseBytes:200000000}};
 try{
  await promisify(execFile)('python3',['-B','-c',`
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location('capacity_decision', sys.argv[1])
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)
measurement = json.loads(sys.argv[3])
now = dt.datetime(2026, 11, 14, tzinfo=dt.timezone.utc)
for name, value in [
    ('allow', measurement),
    ('limit', {**measurement, 'projectedPeakBytes': 700000000}),
    ('insufficient', {**measurement, 'sampleEvidenceSufficient': False}),
    ('failed', None),
]:
    controller.atomic_write(Path(sys.argv[2]) / (name + '.json'), controller.decision(value, now), os.getgid())
`,controller,directory,JSON.stringify(measurement)],{timeout:10000,maxBuffer:65536});
  const cases=[
   {name:'allow',decision:'allow',reason:'SYNC_CAPACITY_VERIFIED',allowed:true,code:null,parsed:true},
   {name:'limit',decision:'blocked',reason:'SYNC_CAPACITY_LIMIT',allowed:false,code:'SYNC_CAPACITY_LIMIT',parsed:true},
   {name:'insufficient',decision:'wait',reason:'SYNC_CAPACITY_INSUFFICIENT_SAMPLE',allowed:false,code:'SYNC_CAPACITY_AWAITING_DECISION',parsed:true},
   {name:'failed',decision:'wait',reason:'SYNC_CAPACITY_WAITING_MEASUREMENT',allowed:false,code:'SYNC_CAPACITY_AWAITING_DECISION',parsed:false},
  ];
  for(const fixture of cases){
   const file=path.join(directory,fixture.name+'.json');
   const generated=JSON.parse(await readFile(file,'utf8'));
   assert.equal(generated.decision,fixture.decision);assert.equal(generated.reason,fixture.reason);
   const result=await readCapacityDecision(file,binding,disk,0,now);
   assert.equal(result.allowed,fixture.allowed,fixture.name);assert.equal(result.code,fixture.code,fixture.name);
   // Missing measurement carries null identity/hash and zero disk: it must fail closed, never reuse the old allow.
   if(fixture.parsed)assert.deepEqual(result.decision,generated);else assert.equal(result.decision,null);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
