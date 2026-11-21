import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PublicVehicleSeoSchema,PublicSeoManifestSchema,PublicSeoQuerySchema} from '../dist/seo.js';
test('SEO metadata is bounded and permission must have a current language and timestamp',()=>{
 assert.ok(PublicVehicleSeoSchema.safeParse({indexable:false,locales:[],lastModified:null}).success);
 assert.equal(PublicVehicleSeoSchema.safeParse({indexable:true,locales:[],lastModified:null}).success,false);
 assert.equal(PublicVehicleSeoSchema.safeParse({indexable:true,locales:['zh','zh'],lastModified:'2026-11-21T00:00:00Z'}).success,false);
 assert.equal(PublicSeoQuerySchema.safeParse({limit:501}).success,false);
 assert.equal(PublicSeoQuerySchema.safeParse({limit:0}).success,false);
 assert.equal(PublicSeoQuerySchema.parse({limit:'100'}).limit,100);
 assert.equal(PublicSeoManifestSchema.safeParse({enabled:false,validUntil:null,revision:'disabled',items:[],nextCursor:'abc'}).success,false);
 const row={id:'ext-00000000-0000-4000-8000-000000000001',locales:['zh'],lastModified:'2026-11-21T00:00:00Z'};
 assert.equal(PublicSeoManifestSchema.safeParse({enabled:true,validUntil:null,revision:'x',items:[row,row],nextCursor:null}).success,false);
});
