import test from 'node:test';
import assert from 'node:assert/strict';
import * as pub from '../dist/public.js';
import { makePublicVehicleFixture } from '../dist/fixtures.js';
const stamp = { version:'a'.repeat(64), priceView:'original', fx:null,
  checkedAt:'2026-11-13T00:00:00.000Z', validUntil:'2026-11-13T00:00:15.000Z' };
test('SSR reuse metadata is strict, bounded and backwards compatible', () => {
  const meta = {requestId:'request-only',catalogCache:stamp};
  assert(pub.PublicVehicleResponseSchema.safeParse({data:makePublicVehicleFixture(),meta}).success);
  assert(pub.PublicHomeSectionsSchema.safeParse({data:{sections:[]},meta}).success);
  assert(pub.PublicHomeSectionsSchema.safeParse({data:{sections:[]},meta:{requestId:'old-server'}}).success);
  assert(pub.PublicCatalogVersionResponseSchema.safeParse({data:stamp,meta:{requestId:'new'}}).success);
  for (const patch of [{version:'revision'}, {validUntil:stamp.checkedAt}, {validUntil:'2026-11-13T00:00:15.001Z'},
    {privateKey:'secret'}, {fx:{version:'f98da774-3d08-45b0-8e06-4bdfe90da2c0',expiresAt:stamp.validUntil}}])
    assert.equal(pub.PublicCatalogCacheStampSchema.safeParse({...stamp,...patch}).success,false);
});
test('USD reuse stops at FX expiry; original and missing FX stay distinct', () => {
  const usd = {...stamp,priceView:'usd',fx:{version:'f98da774-3d08-45b0-8e06-4bdfe90da2c0',expiresAt:stamp.validUntil}};
  assert(pub.PublicCatalogCacheStampSchema.safeParse(usd).success);
  assert(pub.PublicCatalogCacheStampSchema.safeParse({...usd,fx:null}).success);
  assert.equal(pub.PublicCatalogCacheStampSchema.safeParse({...usd,fx:{...usd.fx,expiresAt:'2026-11-13T00:00:14.999Z'}}).success,false);
  assert.deepEqual(pub.PublicCatalogVersionQuerySchema.parse({}),{});
  assert(pub.PublicCatalogVersionQuerySchema.safeParse({priceView:'usd'}).success);
  assert.equal(pub.PublicCatalogVersionQuerySchema.safeParse({locale:'zh'}).success,false);
});
test('offset 10000 is accepted, larger offset rejects without truncating counts or cursors', () => {
  assert.equal(pub.isPublicCatalogOffsetAllowed(209,48),true);
  assert.equal(pub.isPublicCatalogOffsetAllowed(210,48),false);
  assert.equal(pub.isPublicCatalogOffsetAllowed(2001,5),true);
  assert.equal(pub.isPublicCatalogOffsetAllowed(2002,5),false);
  for(const args of [[0,24],[1.5,24],[1,49],[NaN,5],[Infinity,24]])assert.equal(pub.isPublicCatalogOffsetAllowed(...args),false);
  assert(pub.PublicVehicleQuerySchema.safeParse({page:10001,pageSize:1}).success);
  assert.equal(pub.PublicVehicleQuerySchema.safeParse({page:10002,pageSize:1}).success,false);
  assert(pub.PublicVehicleQuerySchema.safeParse({page:417,pageSize:24}).success);
  assert.equal(pub.PublicVehicleQuerySchema.safeParse({page:418,pageSize:24}).success,false);
  assert(pub.PublicVehicleQuerySchema.safeParse({pagination:'cursor',view:'localized'}).success);
  assert(pub.PublicVehicleQuerySchema.safeParse({cursor:'opaque',view:'localized'}).success);
  assert(pub.CatalogMetaSchema.safeParse({requestId:'one',catalog:'curated',total:500000,totalKind:'exact',accessibleTotal:500000,
    dataAsOf:stamp.checkedAt,freshness:'fresh',catalogCache:stamp}).success);
});
