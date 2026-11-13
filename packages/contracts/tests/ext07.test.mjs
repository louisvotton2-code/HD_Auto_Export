import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as pub from '../dist/public.js';
import * as admin from '../dist/admin.js';
test('card query has explicit projection and export/sort semantics',()=>{
 assert.equal(pub.PublicVehicleQuerySchema.parse({projection:'card',exportStatus:'all',sort:'price_asc'}).projection,'card');
 assert.equal(pub.PublicVehicleQuerySchema.safeParse({projection:'raw'}).success,false);
 assert.equal(pub.PublicVehicleCardSchema.shape.images.safeParse([{},{}]).success,false);
 assert.equal(pub.PublicVehicleCardSchema.shape.external,undefined);
 assert.equal(pub.PublicVehicleCardSchema.shape.configuration,undefined);
});
test('full VIN is syntactic and source identifiers cannot carry arbitrary extra data',()=>{
 const value={sourceId:'123',source:'che168',inquiryCode:'che168-123',vin:'1HGCM82633A004352'};
 assert.equal(pub.VehicleIdentifiersSchema.safeParse(value).success,true);
 assert.equal(pub.VehicleIdentifiersSchema.safeParse({...value,vin:'masked***'}).success,false);
 assert.equal(pub.VehicleIdentifiersSchema.safeParse({...value,sellerPhone:'hidden'}).success,false);
});
test('history retains original currency and zero, never accepts an FX conversion',()=>{
 const row={id:'price-1',at:null,money:{amount:'0',currency:'CNY'},kind:'asking'};
 assert.equal(pub.PublicPriceHistoryEntrySchema.safeParse(row).success,true);
 assert.equal(pub.PublicPriceHistoryEntrySchema.safeParse({...row,conversion:{rate:7}}).success,false);
});
test('sync control accepts only bounded version and pause or resume',()=>{
 assert.equal(admin.ExternalFullSyncControlSchema.safeParse({version:0,action:'pause'}).success,true);
 for(const value of [{version:-1,action:'resume'},{version:0,action:'full'},{version:0,action:'resume',actorId:'forged'}])assert.equal(admin.ExternalFullSyncControlSchema.safeParse(value).success,false);
});
