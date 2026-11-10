import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeVehicleDraftFixture} from '@hd/contracts/fixtures';
import {syncLocalization,applyLocalizationInput,projectDisplay} from './localization.js';

const id='4a68472a-3f21-4ac9-a965-1edbaf508c98';
function source(){const draft=makeVehicleDraftFixture();draft.facts.make={id:'manual_toyota',name:'丰田'};draft.facts.model={id:'m1',name:'车型甲'};draft.facts.location={country:'CN',city:'成都',displayName:null};draft.media=[{id,alt:'照片甲',sortOrder:0,isCover:true}];draft.price.includes=['车辆','运输'];return draft;}
function reviewed(){
  const draft=source();let saved=syncLocalization(id,draft);let input=structuredClone(saved.data);
  for(const field of input.fields)field.sourceLanguage='zh';saved=applyLocalizationInput(id,draft,saved,input);
  input=structuredClone(saved.data);for(const field of input.fields)for(const locale of ['zh','en','ru'] as const)field.translations[locale]={text:locale==='zh'?field.sourceText:`${locale} ${field.sourceText}`,kind:locale==='zh'?'original':'human',reviewStatus:'approved',sourceVersion:field.sourceVersion,humanEditVersion:0,engineVersion:null};
  return {draft,saved:applyLocalizationInput(id,draft,saved,input)};
}
test('only public raw fields become translation inputs and no language is guessed',()=>{
  const draft=source();draft.internal.notes='PRIVATE_NOT_TRANSLATABLE';const state=syncLocalization(id,draft);
  assert.ok(state.data.fields.every(field=>field.sourceLanguage==='und'));assert.equal(state.data.fields.some(field=>field.ref==='make'),false);
  assert.equal(JSON.stringify(state).includes('PRIVATE_NOT_TRANSLATABLE'),false);
  const projected=projectDisplay(id,{...draft,images:[]},'en');assert.equal(projected.facts.make!.name,'Toyota');assert.equal(projected.display!.model.status,'missing');assert.equal(projected.facts.location!.city,null);assert.deepEqual(projected.price.includes,[]);
});
test('parent identity, country and price group changes invalidate affected fields, price amount does not',()=>{
  const {draft,saved}=reviewed();const prior=saved.data.fields.find(field=>field.ref==='model')!;
  const changed=structuredClone(draft);changed.facts.make!.id='different_make';changed.facts.location!.country='US';changed.price.includes.reverse();
  const after=syncLocalization(id,changed,saved);
  for(const field of after.data.fields.filter(field=>field.ref==='model'||field.ref==='location.city'||field.ref.startsWith('price.includes.')))assert.equal(field.translations.en!.reviewStatus,'stale');
  assert.equal(after.data.fields.find(field=>field.ref==='model')!.sourceVersion,prior.sourceVersion+1);
  const originalAlt=saved.data.fields.find(field=>field.ref.endsWith('.alt'))!;assert.deepEqual(after.data.fields.find(field=>field.ref===originalAlt.ref),originalAlt);
  const onlyPrice=structuredClone(draft);if(onlyPrice.price.money)onlyPrice.price.money.amount='999.00';assert.deepEqual(syncLocalization(id,onlyPrice,saved).data.fields,saved.data.fields);
});
test('human edits and source revisions reject old suggestions, public projection hides stale fields',()=>{
  const {draft,saved}=reviewed();const input=structuredClone(saved.data);const model=input.fields.find(field=>field.ref==='model')!;
  model.translations.en!.humanEditVersion--;assert.throws(()=>applyLocalizationInput(id,draft,saved,input));
  const machine=structuredClone(saved.data);Object.assign(machine.fields.find(field=>field.ref==='model')!.translations.en!,{kind:'machine',text:'old job',engineVersion:'test'});assert.throws(()=>applyLocalizationInput(id,draft,saved,machine));
  const changed=structuredClone(draft);changed.facts.model!.name='车型乙';const state=syncLocalization(id,changed,saved);
  assert.equal(state.data.fields.find(field=>field.ref==='model')!.translations.en!.text,'en 车型甲');
  assert.equal(projectDisplay(id,changed,'en',state).display!.model.status,'missing');
});
test('vehicle/media UUID casing does not change display bindings or alt projection',()=>{
  const {draft,saved}=reviewed();const upper=structuredClone(draft);upper.media[0]!.id=id.toUpperCase();
  assert.deepEqual(syncLocalization(id.toUpperCase(),upper,saved).data,saved.data);
  const projection=projectDisplay(id.toUpperCase(),{...upper,images:upper.media.map(media=>({...media,url:`/api/v1/media/${media.id}`,width:32,height:32}))},'en',saved);
  assert.equal(projection.images[0]!.alt,'en 照片甲');
});
