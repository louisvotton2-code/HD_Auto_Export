import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { AdmissionReplayRequest } from './admission-replay.js';
import { validateReplayApproval } from './replay-approval.js';

const release = 'a'.repeat(40);
const now = Date.parse('2026-11-23T13:00:00Z');
const sha = (input: string) => createHash('sha256').update(input).digest('hex');
const events = ['12', '9'];
const basis = { id: '781af2ee-24b6-4b2f-8613-556805f53a16', snapshotId: '3b8f5c37-7ab6-4404-851a-efccf88894ce',
  csvSha256: 'a'.repeat(64), expectedAdmitted: 150_000, expectedLimit: 150_000, targetRows: 150_002 };
const batch = { ...basis, eventCount: events.length, eventSetSha256: sha(JSON.stringify(events.slice().sort())) };
const forecast = { kind: 'replay-prospective-capacity-v1', release, batch, preflightAt: '2026-11-23T12:59:40+00:00',
  sourceNativeExpiresAt: '2026-11-23T13:00:45Z', workerFence: 7, diskTotalBytes: 100, estimatedPeakBytes: 69,
  quota: { requiredInitialDetailIds: 6, operatorApprovedRetryIds: 2, verifiedRemainingDetailIds: 8,
    accountCheckedAt: '2026-11-23T12:59:30+00:00' } };

function receipts(estimate = forecast) {
  const raw = JSON.stringify(estimate)+'\n';
  const proof = { kind: 'replay-prewrite-checked-v1', release, batch, prospectiveReceiptSha256: sha(raw),
    checkedAt: '2026-11-23T12:59:50Z' };
  const plan: AdmissionReplayRequest = { ...basis, eventIds: events, capacityReceipt: sha(raw) };
  return { raw, proof, plan };
}

test('production evidence binds the exact bytes, live release, events, capacity and worker fence', () => {
  const {raw,proof,plan} = receipts();
  assert.deepEqual(validateReplayApproval(plan,release,raw,JSON.stringify(proof),now),
    {workerFence:'7',expiresAt:Date.parse('2026-11-23T13:00:40Z')});
  const refusals: Array<[AdmissionReplayRequest,string,string,typeof proof,number]> = [
    [plan,release,raw.trimEnd(),proof,now],
    [plan,'b'.repeat(40),raw,proof,now],
    [{...plan,eventIds:['12','10']},release,raw,proof,now],
    [{...plan,targetRows:150_003},release,raw,proof,now],
    [plan,release,raw,{...proof,checkedAt:'2026-11-23T12:59:39Z'},now],
    [plan,release,raw,proof,now+40_000],
  ];
  for(const [request,signedRelease,estimate,checked,timestamp] of refusals) {
    assert.throws(()=>validateReplayApproval(request,signedRelease,estimate,JSON.stringify(checked),timestamp),
      {code:'SYNC_REPLAY_APPROVAL_INVALID'});
  }
});

test('production approval rejects the physical boundary, insufficient quota and a stale account check', () => {
  for(const estimate of [{...forecast,estimatedPeakBytes:70},
    {...forecast,quota:{...forecast.quota,verifiedRemainingDetailIds:7}},
    {...forecast,quota:{...forecast.quota,accountCheckedAt:'2026-11-22T23:59:00Z'}},
    {...forecast,sourceNativeExpiresAt:'2026-11-23T13:00:00Z'}]) {
    const {raw,proof,plan} = receipts(estimate);
    assert.throws(()=>validateReplayApproval(plan,release,raw,JSON.stringify(proof),now),
      {code:'SYNC_REPLAY_APPROVAL_INVALID'});
  }
});
