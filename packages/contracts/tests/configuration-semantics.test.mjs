import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CONFIGURATION_SEMANTIC_KEYS,CONFIGURATION_SEMANTIC_ALIASES} from '../dist/public.js';
import {CONFIGURATION_SEMANTIC_FIXTURES} from '../dist/fixtures.js';
test('known configuration semantics form one unambiguous producer/consumer vocabulary',()=>{
 assert.equal(new Set(CONFIGURATION_SEMANTIC_KEYS).size,CONFIGURATION_SEMANTIC_KEYS.length);
 const names=new Map(),normalize=value=>value.normalize('NFKC').toLowerCase().replace(/[\s_()（）·³/.-]/g,'');
 for(const key of CONFIGURATION_SEMANTIC_KEYS){
  assert.match(key,/^[a-z][A-Za-z0-9]{0,79}$/);
  for(const label of [key,...CONFIGURATION_SEMANTIC_ALIASES[key]]){
   const name=normalize(label),prior=names.get(name);assert.ok(prior===undefined||prior===key,`Ambiguous known alias: ${label}`);names.set(name,key);
  }
 }
 for(const item of CONFIGURATION_SEMANTIC_FIXTURES)if(item.semanticKey!==null)assert.ok(CONFIGURATION_SEMANTIC_KEYS.includes(item.semanticKey));
});
