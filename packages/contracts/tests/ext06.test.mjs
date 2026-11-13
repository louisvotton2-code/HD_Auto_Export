import test from 'node:test';
import assert from 'node:assert/strict';
import * as admin from '../dist/admin.js';
import * as pub from '../dist/public.js';
const actor={kind:'unknown',staffId:null,name:null};
const at='2026-11-13T00:00:00.000Z';
const event={id:'old-1',action:'vehicle.save',at,actor,oldVersion:1,newVersion:2,detailState:'unknown',changes:null};
test('old activity has explicitly unknown differences and accepts legacy actor uncertainty',()=>{
 assert.equal(admin.ActivityEventSchema.parse(event).changes,null);
 assert.equal(admin.ActivityEventSchema.safeParse({...event,changes:[]}).success,false);
 assert.equal(admin.ActivityEventSchema.safeParse({...event,detailState:'recorded'}).success,false);
});
test('activity differences preserve absent, null, empty and zero values',()=>{
 const changes=[{path:'facts.engineCc',beforePresent:false,afterPresent:true,before:null,after:0},{path:'content.title',beforePresent:true,afterPresent:true,before:'',after:null}];
 assert.deepEqual(admin.ActivityEventSchema.parse({...event,detailState:'recorded',changes}).changes,changes);
 assert.equal(admin.ActivityEventSchema.safeParse({...event,detailState:'recorded',changes:[{...changes[0],cookie:'secret'}]}).success,false);
});
test('activity and segments paginate at 20 by default and cap at 100',()=>{
 for(const schema of [admin.ActivityQuerySchema,pub.PublicVehicleSegmentQuerySchema]){
  assert.equal(schema.parse({}).limit,20);assert.equal(schema.parse({limit:'100'}).limit,100);
  for(const limit of [0,101,1.5])assert.equal(schema.safeParse({limit}).success,false);
 }
});
test('public entry does not export employee activity and segment responses reject staff fields',()=>{
 assert.equal(pub.ActivityEventSchema,undefined);assert.equal(pub.AdminActivitySummarySchema,undefined);
 const data={vehicleId:'vehicle-1',locale:'zh',revision:'a'.repeat(64),total:0,nextCursor:null,items:[]};
 const value={data,meta:{requestId:'request-1'}};
 assert.equal(pub.PublicVehicleGalleryResponseSchema.safeParse(value).success,true);
 assert.equal(pub.PublicVehicleConfigurationResponseSchema.safeParse(value).success,true);
 assert.equal(pub.PublicVehicleGalleryResponseSchema.safeParse({...value,data:{...data,activity:{actor}}}).success,false);
});
test('gallery pages keep absolute positions beyond the initial thirty photos',()=>{
 const photo={id:'ximg-11111111-1111-4111-8111-111111111111',url:'https://photos.example.invalid/a.jpg',alt:'',width:null,height:null,sortOrder:75,isCover:false,
  remote:{revision:1,refreshedAt:at,expiresAt:null}};
 assert.equal(pub.PublicMediaSchema.parse(photo).sortOrder,75);
 assert.equal(pub.PublicMediaSchema.safeParse({...photo,url:'javascript:alert(1)'}).success,false);
});
test('formal importer status cannot imply continuous scheduling or expose a raw manifest',()=>{
 const data={mode:'fixed_once',continuous:false,latestJob:null};
 assert.deepEqual(admin.ExternalIngestionStatusSchema.parse(data),data);
 assert.equal(admin.ExternalIngestionStatusSchema.safeParse({...data,continuous:true}).success,false);
 assert.equal(admin.ExternalIngestionStatusSchema.safeParse({...data,manifest:{}}).success,false);
});
test('private source documents expose a single identity body and only reference shared bulk archives',()=>{
 const data={id:'11111111-1111-4111-8111-111111111111',kind:'detail',locale:'en',hash:'b'.repeat(64),firstObservedAt:at,lastObservedAt:at,sourceUpdatedAt:null,
  payload:{id:'1001',unknownField:'kept'},rawText:null,response:{hash:'c'.repeat(64),shared:true}};
 const value={data,meta:{requestId:'request-1'}};
 assert.equal(admin.ExternalSourceDocumentResponseSchema.safeParse(value).success,true);
 assert.equal(admin.ExternalSourceDocumentResponseSchema.safeParse({...value,data:{...data,response:{...data.response,payload:{results:['another identity']}}}}).success,false);
 assert.equal(pub.ExternalSourceDocumentResponseSchema,undefined);
 assert.equal(admin.ExternalProviderStatusSchema.shape.worker.safeParse('fixed_once').success,true);
});
test('gallery alt metadata retains actual source language and review status',()=>{
 const image={id:'ximg-11111111-1111-4111-8111-111111111111',url:'https://photos.example.invalid/a.jpg',alt:'正面',width:null,height:null,sortOrder:31,isCover:false,
  remote:{revision:1,refreshedAt:at,expiresAt:null},altText:{text:'正面',requestedLocale:'en',contentLocale:'zh',status:'ready',provenance:'supplier',reviewed:false}};
 assert.deepEqual(pub.PublicMediaSchema.parse(image).altText,image.altText);
});
