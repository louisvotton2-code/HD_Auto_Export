import assert from 'node:assert/strict';
import test from 'node:test';
import {PublicVehicleQuerySchema,PublicFilterQuerySchema} from '../dist/public.js';
test('cursor pagination is explicit, bounded and cannot be combined with offset or legacy views',()=>{
  const normal=PublicVehicleQuerySchema.parse({view:'localized'});
  assert.equal(Object.hasOwn(normal,'pagination'),false);
  assert.equal(Object.hasOwn(normal,'cursor'),false);
  assert.equal(PublicVehicleQuerySchema.parse({view:'localized',pagination:'cursor'}).pagination,'cursor');
  assert.equal(PublicVehicleQuerySchema.parse({view:'localized',cursor:'abc_-123'}).cursor,'abc_-123');
  for(const input of [{pagination:'cursor'},{view:'legacy',cursor:'abc'},{view:'localized',pagination:'cursor',page:2},
    {view:'localized',cursor:'abc',page:2},{view:'localized',cursor:''},{view:'localized',cursor:'a'.repeat(2049)},
    {view:'localized',cursor:'a=b'},{view:'localized',pagination:'offset'}])assert.equal(PublicVehicleQuerySchema.safeParse(input).success,false);
  assert.equal(PublicFilterQuerySchema.safeParse({view:'localized',pagination:'cursor'}).success,false);
  assert.equal(PublicFilterQuerySchema.safeParse({view:'localized',cursor:'abc'}).success,false);
});
