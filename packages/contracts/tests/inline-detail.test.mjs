import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makePublicVehicleFixture} from '../dist/fixtures.js';
import {PublicVehicleSchema,PublicVehicleInlineSchema,PublicVehicleDetailQuerySchema,PublicLocaleQuerySchema} from '../dist/public.js';
test('inline detail is explicit and never widens old strict consumers',()=>{
 const old=makePublicVehicleFixture();
 const inline={...old,projection:'detail-inline-v1',inspectionSummary:{status:'unknown',contentLocale:null,checked:null,faults:null,categories:[]},
  inspectionInline:{conclusions:[],defects:[],normalItemCount:0,hasMoreConclusions:false,hasMoreDefects:false},configurationInline:[]};
 assert.equal(PublicVehicleSchema.safeParse(old).success,true);assert.equal(PublicVehicleInlineSchema.safeParse(inline).success,true);
 assert.equal(PublicVehicleSchema.safeParse(inline).success,false);assert.equal(PublicVehicleInlineSchema.safeParse(old).success,false);
 assert.equal(PublicLocaleQuerySchema.safeParse({projection:'detail-inline-v1'}).success,false);
 assert.equal(PublicVehicleDetailQuerySchema.safeParse({projection:'detail-inline-v1'}).success,false);
 assert.equal(PublicVehicleDetailQuerySchema.safeParse({projection:'detail-inline-v1',view:'localized'}).success,true);
 assert.equal(PublicVehicleDetailQuerySchema.safeParse({projection:'unknown',view:'localized'}).success,false);
 assert.equal(PublicVehicleDetailQuerySchema.safeParse({technicalView:'verified',view:'localized'}).success,false);
 assert.equal(PublicVehicleDetailQuerySchema.safeParse({technicalView:'verified',projection:'detail-inline-v1'}).success,false);
 assert.equal(PublicVehicleDetailQuerySchema.safeParse({technicalView:'verified',projection:'detail-inline-v1',view:'localized'}).success,true);
});
