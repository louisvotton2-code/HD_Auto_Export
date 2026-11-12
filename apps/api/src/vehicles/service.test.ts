import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeVehicleDraftFixture} from '@hd/contracts/fixtures';
import {AdminVehicleSchema} from '@hd/contracts/admin';
import {PublicPriceSchema} from '@hd/contracts/public';
import {hasUnpublishedChanges} from './service.js';
test('publication comparison excludes internal data, compares publishable content and normalizes media order',()=>{
  const draft=makeVehicleDraftFixture();draft.media=[];
  const snapshot={source:structuredClone(draft.source),facts:structuredClone(draft.facts),price:PublicPriceSchema.parse(draft.price),content:structuredClone(draft.content),images:[]};
  assert.equal(hasUnpublishedChanges(draft),true);assert.equal(hasUnpublishedChanges(draft,snapshot),false);
  draft.internal.notes='private change';draft.internal.supplierContact='private supplier';assert.equal(hasUnpublishedChanges(draft,snapshot),false);
  draft.facts.model!.name='New public model';assert.equal(hasUnpublishedChanges(draft,snapshot),true);
  draft.facts=structuredClone(snapshot.facts);draft.content.title.translations.en!.reviewStatus='pending';assert.equal(hasUnpublishedChanges(draft,snapshot),true);
  assert.equal(AdminVehicleSchema.shape.hasUnpublishedChanges.parse(undefined),null);
});
