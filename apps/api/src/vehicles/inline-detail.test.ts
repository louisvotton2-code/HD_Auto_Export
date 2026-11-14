import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configurationSemanticKey} from './inline-detail.js';
test('stable configuration semantics survive source IDs, manual Chinese IDs and translated labels',()=>{
 assert.equal(configurationSemanticKey('specs.ev.motorPowerKw','任意译文'),'motorKw');
 const id='cfg-'+Array.from('电池容量').map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 assert.equal(configurationSemanticKey(id,'Unknown translated label'),'batteryKwh');
 assert.equal(configurationSemanticKey('sheet.0.1','Wheelbase'),'wheelbaseMm');
 assert.equal(configurationSemanticKey('equipment.0.1','ABS'),'abs');
 assert.equal(configurationSemanticKey('sheet.0.2','Unrecognized supplier wording'),null);
});

test('BE generates the shared three-language configuration cases consumed by FE',async()=>{
 const {CONFIGURATION_SEMANTIC_FIXTURES}=await import('@hd/contracts/fixtures');
 const {CONFIGURATION_SEMANTIC_KEYS,CONFIGURATION_SEMANTIC_ALIASES}=await import('@hd/contracts/public');
 for(const fixture of CONFIGURATION_SEMANTIC_FIXTURES)for(const label of fixture.labels){
  assert.equal(configurationSemanticKey(fixture.id,label),fixture.semanticKey,`${fixture.id}: ${label}`);
 }
 // Every advertised key is actually produced; exact known labels work on opaque source items and manually entered Chinese names.
 for(const key of CONFIGURATION_SEMANTIC_KEYS){
  assert.equal(configurationSemanticKey(`specs.${key}`,'Unrelated fallback'),key);
  for(const label of CONFIGURATION_SEMANTIC_ALIASES[key]){
   assert.equal(configurationSemanticKey('equipment.0.0',label),key,label);
   if(/\p{Script=Han}/u.test(label)){
    const id='cfg-'+label.split('').map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
    assert.equal(configurationSemanticKey(id,'Unrelated translated label'),key,label);
   }
  }
 }
 assert.equal(configurationSemanticKey('equipment.0.0','Not equipped with seat ventilation'),null);
 assert.equal(configurationSemanticKey('equipment.0.0','Possible navigation upgrade'),null);
});
