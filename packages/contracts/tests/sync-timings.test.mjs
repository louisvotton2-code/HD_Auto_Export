import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ExternalSyncTimingsResponseSchema} from '../dist/admin.js';
const at='2026-11-21T00:00:00.000Z';
const response={data:{asOf:at,window:{from:at,to:at,instrumentedSince:at,complete:false,uninstrumentedEvents:1,lastReceivedAt:null,nextReceiveAt:at,
 coverage:{slotMs:300000,expectedSlots:288,successfulSlots:0,missingSlots:288,failedSlots:0,through:at}},
 backlog:{pendingEvents:1,pendingWork:2,failedWork:1,oldestEventAt:at,oldestWorkAt:at},metrics:[{kind:'price',received:1,applied:1,detailUpdated:0,publicEffective:0,incomplete:1,failed:1,notPublic:0,superseded:0,
 oldestIncompleteAt:at,p95SourceToReceivedMs:null,p95ReceivedToAppliedMs:3,p95AppliedToDetailMs:null,p95ReceivedToPublicMs:null}],
 events:[{eventId:'1',kind:'unknown',sourceAt:at,receivedAt:at,appliedAt:at,detailUpdatedAt:null,publicEffectiveAt:null,outcome:'unknown'}]},meta:{requestId:'timing-schema'}};
test('sync timing contract preserves unknown/missing stages and rejects leaking fields or invented durations',()=>{
 assert.deepEqual(ExternalSyncTimingsResponseSchema.parse(response),response);
 for(const patch of [{p95ReceivedToPublicMs:-1},{publicEffective:-1},{sourceUrl:'https://private.invalid'}]){
  const invalid=structuredClone(response);Object.assign(invalid.data.metrics[0],patch);assert.equal(ExternalSyncTimingsResponseSchema.safeParse(invalid).success,false);
 }
 const extra=structuredClone(response);extra.data.events[0].raw={private:true};assert.equal(ExternalSyncTimingsResponseSchema.safeParse(extra).success,false);
 const tooMany=structuredClone(response);tooMany.data.events=Array(51).fill(response.data.events[0]);assert.equal(ExternalSyncTimingsResponseSchema.safeParse(tooMany).success,false);
});
