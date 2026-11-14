import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicInspectionSummarySchema,PublicVehicleInspectionResponseSchema,PublicVehicleInspectionQuerySchema} from '../dist/public.js';
import {makePublicInspectionFixture} from '../dist/fixtures.js';
test('inspection summary, grouped page and bounded filters preserve zeros, nulls and actual language',()=>{
 for(const locale of ['zh','en','ru']){
  const data=makePublicInspectionFixture(locale);PublicVehicleInspectionResponseSchema.shape.data.parse(data);
  assert.equal(data.summary.faults,1);assert.equal(data.summary.categories[1].faults,0);assert.equal(data.items[0].value.contentLocale,'en');assert.equal(data.items[0].value.requestedLocale,locale);
  assert.equal(PublicInspectionSummarySchema.parse({...data.summary,checked:null,faults:null}).faults,null);
 }
 assert.equal(PublicVehicleInspectionQuerySchema.parse({category:'accident',part:'part.fixture',outcome:'defect',order:'faults_first',limit:'100'}).limit,100);
 for(const q of [{limit:101},{category:'https://private.invalid'},{part:'private text'},{outcome:'accident'},{order:'random'}])assert.equal(PublicVehicleInspectionQuerySchema.safeParse(q).success,false);
 const sample=makePublicInspectionFixture();assert.equal(PublicInspectionSummarySchema.safeParse({...sample.summary,reportUrl:'https://private.invalid'}).success,false);
 assert.equal(PublicInspectionSummarySchema.safeParse({...sample.summary,checked:-1}).success,false);
});
