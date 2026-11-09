import assert from 'node:assert/strict';
import test from 'node:test';
import {PublicUsdPriceSchema,PublicVehicleQuerySchema,PublicFilterQuerySchema,PublicLocaleQuerySchema,PublicVehicleSchema} from '../dist/public.js';
import {makePublicVehicleFixture} from '../dist/fixtures.js';
test('USD display is an explicit localized opt-in across public queries',()=>{
  for(const schema of [PublicVehicleQuerySchema,PublicFilterQuerySchema,PublicLocaleQuerySchema]){
    assert.equal(schema.parse({view:'localized',priceView:'usd'}).priceView,'usd');
    for(const input of [{priceView:'usd'},{view:'legacy',priceView:'usd'},{view:'localized',priceView:'eur'}])assert.equal(schema.safeParse(input).success,false);
    assert.equal(Object.hasOwn(schema.parse({view:'localized'}),'priceView'),false);
  }
  for(const schema of [PublicVehicleQuerySchema,PublicFilterQuerySchema]){
    assert.ok(schema.safeParse({view:'localized',priceView:'usd',priceMin:'1',priceCurrency:'USD'}).success);
    assert.equal(schema.safeParse({view:'localized',priceView:'usd',priceMin:'1'}).success,false);
    assert.equal(schema.safeParse({view:'localized',priceView:'usd',priceCurrency:'CNY'}).success,false);
    assert.ok(schema.safeParse({priceMin:'1',priceCurrency:'USD'}).success);
  }
  const original=makePublicVehicleFixture();assert.deepEqual(PublicVehicleSchema.parse(original),original);
});
test('USD DTO excludes rate internals and distinguishes unavailable from on-request',()=>{
  const ready={status:'ready',kind:'reference',money:{amount:'13888.89',currency:'USD'},conversion:{asOf:'2026-11-10T00:00:00Z',source:'synthetic'}};
  assert.deepEqual(PublicUsdPriceSchema.parse(ready),ready);
  for(const key of ['rate','version','base','quote','expiresAt'])assert.equal(PublicUsdPriceSchema.safeParse({...ready,conversion:{...ready.conversion,[key]:'PRIVATE'}}).success,false);
  assert.equal(PublicUsdPriceSchema.safeParse({...ready,kind:'asking'}).success,false);
  assert.ok(PublicUsdPriceSchema.safeParse({...ready,kind:'asking',conversion:null}).success);
  assert.ok(PublicUsdPriceSchema.safeParse({status:'on_request',money:null,conversion:null}).success);
  for(const reason of ['rate_unavailable','amount_out_of_range'])assert.ok(PublicUsdPriceSchema.safeParse({status:'unavailable',money:null,conversion:null,reason}).success);
  assert.equal(PublicUsdPriceSchema.safeParse({...ready,money:{amount:'1.00',currency:'CNY'}}).success,false);
});
