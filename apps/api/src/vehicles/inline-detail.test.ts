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
