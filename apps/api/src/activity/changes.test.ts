import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeVehicleDraftFixture, makeExternalVehicleDraftFixture } from '@hd/contracts/fixtures';
import { activityChanges, draftChanges } from './changes.js';

test('activity differences retain absent, null, empty, zero and empty containers', () => {
  const changes = activityChanges({ nullable: null, empty: '', zero: 0 }, { nullable: undefined, empty: null, zero: false, list: [] });
  assert.deepEqual(changes.find(x => x.path === 'nullable'), {path:'nullable',beforePresent:true,afterPresent:false,before:null,after:null});
  assert.deepEqual(changes.find(x => x.path === 'list'), {path:'list',beforePresent:false,afterPresent:true,before:null,after:[]});
  assert.equal(changes.length,4);
  assert.deepEqual(activityChanges({nullable:null},{nullable:undefined}),[{path:'nullable',beforePresent:true,afterPresent:false,before:null,after:null}]);
  assert.deepEqual(activityChanges({x:1,y:2},{y:2,x:1}),[]);
});
test('draft audit records public facts and image identities but redacts internal text', () => {
  const draft=makeVehicleDraftFixture(), next=structuredClone(draft);
  next.internal.notes='password=never-keep-this';next.facts.modelYear=2025;
  next.media=[{id:'11111111-1111-4111-8111-111111111111',alt:'front',sortOrder:0,isCover:true}];
  const changes=draftChanges(draft,next),text=JSON.stringify(changes);
  assert.ok(changes.some(x=>x.path==='draft.facts.modelYear'&&x.after===2025));
  assert.ok(changes.some(x=>x.path.startsWith('draft.media.11111111')));
  assert.ok(changes.some(x=>x.path==='draft.internal'));
  assert.equal(text.includes('never-keep-this'),false);
  assert.equal(text.includes('engineVersion'),false);
  assert.equal(text.includes('sourceHash'),false);
});

test('editable external source metadata is audited while arbitrary URL credentials remain redacted',()=>{
 const before=makeExternalVehicleDraftFixture(),after=structuredClone(before);
 if(after.source.kind!=='external')throw new Error('Expected external fixture');
 after.source.platform.name='Updated platform';after.source.collectedAt='2026-11-13T10:00:00Z';
 after.source.listingUrl='https://example.invalid/private?x-signature=never-store-this';
 const changes=draftChanges(before,after);
 assert.ok(changes.some(c=>c.path==='draft.source.platform.name'&&c.after==='Updated platform'));
 assert.ok(changes.some(c=>c.path==='draft.source.collectedAt'&&c.after==='2026-11-13T10:00:00Z'));
 assert.ok(changes.some(c=>c.path==='draft.source.listingUrl'&&c.beforePresent&&c.afterPresent));
 assert.equal(JSON.stringify(changes).includes('never-store-this'),false);
});
