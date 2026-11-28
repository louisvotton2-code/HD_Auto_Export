import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {AdmissionChangeRequest,validateAdmissionApproval} from './admission-operations.js';

const now=Date.parse('2026-11-26T04:00:00Z');
const release='1'.repeat(40);
const request=AdmissionChangeRequest.parse({
 id:randomUUID(),database:'hd_release_0123456789ab',snapshotId:randomUUID(),csvSha256:'a'.repeat(64),
 expectedAdmitted:546_799,expectedLimit:546_799,targetRows:1_000_000,workerFence:'22',rollbackOf:null,
});
const receipt={
 kind:'formal-admission-capacity-v1',release,request,sourceEvidenceHash:'b'.repeat(64),
 sourceTargetRows:546_799,sampleRows:10_000,measuredAt:'2026-11-26T11:59:30+08:00',
 sourceNativeExpiresAt:'2026-11-26T04:01:00Z',heavyWorkPausePercent:80,currentUsedBytes:48,
 diskTotalBytes:100,projectedPeakBytes:79,ioSafe:true,
};

test('only the explicit million-row reservation and a floor-safe rollback validate',()=>{
 assert.equal(AdmissionChangeRequest.safeParse({...request,targetRows:900_000}).success,false);
 assert.equal(AdmissionChangeRequest.safeParse({...request,workerFence:'9223372036854775808'}).success,false);
 assert.equal(AdmissionChangeRequest.safeParse({...request,workerFence:'not-a-fence'}).success,false);
 const rollback={...request,id:randomUUID(),rollbackOf:request.id,targetRows:request.expectedLimit,expectedLimit:1_000_000};
 assert.equal(AdmissionChangeRequest.safeParse(rollback).success,true);
 assert.equal(AdmissionChangeRequest.safeParse({...rollback,expectedAdmitted:rollback.targetRows+1}).success,false);
});

test('binds the exact JSON receipt, target, release, policy and freshness',()=>{
 const raw=JSON.stringify(receipt)+'\n';
 assert.deepEqual(validateAdmissionApproval(raw,request,release,80,0,now),{
  hash:createHash('sha256').update(raw).digest('hex'),expiresAt:now+30_000,projectedPeakBytes:79,
  sourceEvidenceHash:receipt.sourceEvidenceHash,sourceTargetRows:request.expectedLimit,sampleRows:10_000,
 });
 const invalid=/SYNC_ADMISSION_CAPACITY_APPROVAL_INVALID/;
 assert.throws(()=>validateAdmissionApproval(raw,{...request,workerFence:'23'},release,80,0,now),invalid);
 assert.throws(()=>validateAdmissionApproval(raw,request,'2'.repeat(40),80,0,now),invalid);
 assert.throws(()=>validateAdmissionApproval(raw,request,release,70,0,now),invalid);
 assert.throws(()=>validateAdmissionApproval(raw,request,release,80,78,now),invalid);
 assert.throws(()=>validateAdmissionApproval(raw,request,release,80,0,now+30_000),invalid);
 for(const changed of [
  {projectedPeakBytes:80},{projectedPeakBytes:47},{ioSafe:false},
  {measuredAt:'2026-11-26T04:00:01Z'},{sourceNativeExpiresAt:'2026-11-26T04:00:00Z'},
 ]) {
  assert.throws(()=>validateAdmissionApproval(JSON.stringify({...receipt,...changed}),request,release,80,0,now),invalid);
 }
});

test('split admission approval enforces current disk, projected peak, and byte budget separately',()=>{
 const approved={...receipt,currentUsedBytes:79,projectedPeakBytes:89,projectedPeakPausePercent:90};
 const validate=(estimate:unknown,byteBudget=0,expectedPeak:80|90=90)=>
  validateAdmissionApproval(JSON.stringify(estimate),request,release,80,byteBudget,now,expectedPeak);
 assert.equal(validate(approved,89).projectedPeakBytes,89);
 const invalid={code:'SYNC_ADMISSION_CAPACITY_APPROVAL_INVALID'};
 assert.throws(()=>validate(approved,88),invalid);
 assert.throws(()=>validate(approved,0,80),invalid);
 assert.throws(()=>validate(receipt),invalid);
 for(const changed of [
  {currentUsedBytes:80}, {projectedPeakBytes:90}, {currentUsedBytes:79,projectedPeakBytes:78},
  {projectedPeakPausePercent:'90'}, {projectedPeakPausePercent:91}, {ioSafe:false},
 ]) {
  assert.throws(()=>validate({...approved,...changed}),invalid);
 }
});
