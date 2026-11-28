import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readCapacityDecision} from '../src/external/full-sync/capacity.js';
import {readHeavyWorkPausePercent,readProjectedPeakPausePercent} from '../src/external/full-sync/disk-policy.js';

// Run on the integrated BE + OPS checkout. No copied controller, fallback output or skipped missing producer.
// Import only decision/atomic_write; never main(), live measurement, production paths or supplier calls.
test('BE consumes actual OPS output for both policies and fails closed across mixed settings',async()=>{
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
    ('legacy80', {**measurement, 'heavyWorkPausePercent': 80, 'projectedPeakBytes': 799999999}),
    ('explicit80', {**measurement, 'heavyWorkPausePercent': 80, 'projectedPeakPausePercent': 80, 'projectedPeakBytes': 799999999}),
    ('split', {**measurement, 'heavyWorkPausePercent': 80, 'projectedPeakPausePercent': 90, 'projectedPeakBytes': 899999999}),
    ('split_actual', {**measurement, 'heavyWorkPausePercent': 80, 'projectedPeakPausePercent': 90,
                      'currentUsedBytes': 800000000, 'projectedPeakBytes': 899999999}),
    ('split_peak', {**measurement, 'heavyWorkPausePercent': 80, 'projectedPeakPausePercent': 90, 'projectedPeakBytes': 900000000}),
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
  const legacy=path.join(directory,'legacy80.json'),explicitLegacy=path.join(directory,'explicit80.json');
  const split=path.join(directory,'split.json'),splitActual=path.join(directory,'split_actual.json'),splitPeak=path.join(directory,'split_peak.json');
  assert.deepEqual(JSON.parse(await readFile(legacy,'utf8')),JSON.parse(await readFile(explicitLegacy,'utf8')));
  assert.equal(Object.hasOwn(JSON.parse(await readFile(legacy,'utf8')),'projectedPeakPausePercent'),false);
  assert.equal((await readCapacityDecision(legacy,binding,disk,0,now,80)).allowed,true);
  assert.equal((await readCapacityDecision(legacy,binding,disk,0,now,80,90)).code,'SYNC_CAPACITY_AWAITING_DECISION');
  assert.equal((await readCapacityDecision(split,binding,disk,0,now,80)).code,'SYNC_CAPACITY_AWAITING_DECISION');
  const liveBelow={...disk,available:200000001,used:.799999999};
  const liveAt={...disk,available:200000000,used:.8};
  const allow=await readCapacityDecision(split,binding,liveBelow,899999999,now,80,90);
  assert.equal(allow.allowed,true);
  assert.equal(allow.decision?.heavyWorkPausePercent,80);
  assert.equal(allow.decision?.projectedPeakPausePercent,90);
  assert.equal((await readCapacityDecision(split,binding,liveAt,0,now,80,90)).code,'SYNC_CAPACITY_LIMIT');
  assert.equal((await readCapacityDecision(splitActual,binding,liveBelow,0,now,80,90)).code,'SYNC_CAPACITY_LIMIT');
  assert.equal((await readCapacityDecision(splitPeak,binding,liveBelow,0,now,80,90)).code,'SYNC_CAPACITY_LIMIT');
  assert.equal((await readCapacityDecision(split,binding,liveBelow,899999998,now,80,90)).code,'SYNC_CAPACITY_BUDGET_CAP');
  assert.equal((await readCapacityDecision(split,{...binding,evidenceHash:'0'.repeat(64)},disk,0,now,80,90)).allowed,false);
  assert.equal((await readCapacityDecision(split,binding,disk,0,now+600_001,80,90)).allowed,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('forecast percentage defaults to physical and cannot set the physical pause to 90',()=>{
 assert.equal(readProjectedPeakPausePercent(undefined,70),70);
 assert.equal(readProjectedPeakPausePercent(undefined,80),80);
 assert.equal(readProjectedPeakPausePercent('90',80),90);
 for(const invalid of ['', '090', '89', '91', '90.0', ' 90'])
  assert.throws(()=>readProjectedPeakPausePercent(invalid,80),{code:'SYNC_PROJECTED_PEAK_PAUSE_PERCENT_INVALID'});
 assert.throws(()=>readHeavyWorkPausePercent('90'),{code:'SYNC_HEAVY_WORK_PAUSE_PERCENT_INVALID'});
});
