import assert from 'node:assert/strict';
import test from 'node:test';
import { makeImportedPublicVehicleFixture } from '@hd/contracts/fixtures';
import { PublicVehicleConfigurationResponseSchema, PublicVehicleGalleryResponseSchema } from '@hd/contracts/public';
import type { PoolClient } from 'pg';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { displayText } from '../external/normalize.js';

test('public supplier segments neutralize saved private text without losing pagination or language metadata', async t=>{
  const runtime=await buildApp(readConfig({NODE_ENV:'test',
    DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
    AUTH_SECRET:'segment-test-placeholder-not-a-live-secret'}));
  t.after(()=>runtime.app.close());
  const vehicle=makeImportedPublicVehicleFixture('en');
  const savedNumber='(202) 555-0101';
  const contactLabel='Seller contact';
  const bareNumber=displayText('en',{text:savedNumber,contentLocale:'und'},'supplier');
  const taggedContact=displayText('en',{text:`${contactLabel}: ${savedNumber}`,contentLocale:'en'},'supplier');
  const safeLabel=displayText('en',{text:'Power',contentLocale:'en'},'catalog');
  const safeValue=displayText('en',{text:'80 kW',contentLocale:'und'},'supplier');
  const missing=displayText('en',null);
  const cover=vehicle.images[0]!;
  const photos=[{...cover,alt:contactLabel,altText:bareNumber},
    {...cover,id:'ximg-22222222-2222-4222-8222-222222222222',sortOrder:1,isCover:false,alt:savedNumber,altText:taggedContact},
    {...cover,id:'ximg-33333333-3333-4333-8333-333333333333',sortOrder:2,isCover:false,
      alt:'Rear view',altText:displayText('en',{text:'Rear view',contentLocale:'en'},'supplier')}];
  const configuration=[{id:'sheet.0.0',name:displayText('en',{text:'内部采购成本',contentLocale:'zh'}),
    value:displayText('en',{text:'CNY 73421',contentLocale:'und'},'supplier')},
    {id:'sheet.0.1',name:safeLabel,value:taggedContact},
    {id:'specs.powerKw',name:safeLabel,value:safeValue}];
  t.mock.method(runtime.inventory,'getPublic',async(id:string,locale:string,view:string)=>{
    assert.deepEqual([id,locale,view],[vehicle.id,'en','localized']);
    return vehicle;
  });
  t.mock.method(runtime.db.pool,'connect',()=>{throw new Error('This test must not connect to a database.');});
  t.mock.method(runtime.db.pool,'query',async(sql:string)=>{
    assert.equal(sql,'SELECT epoch::text,revision::text FROM public_catalog_state WHERE id=1');
    return {rows:[{epoch:'00000000-0000-4000-8000-000000000001',revision:'1'}]};
  });
  const readPersisted=async(sql:string,args?:unknown[])=>{
    if(sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')return {rows:[]};
    assert.match(sql,/FROM external_source_segments/);
    assert.deepEqual(args?.slice(0,2),[vehicle.id.slice(4),'en']);
    const gallery=sql.includes("p.kind='photos'");
    const [offset,limit]=args!.slice(gallery?2:3) as [number,number];
    const all=gallery?photos:configuration;
    return {rows:[{total:all.length,items:all.slice(offset,offset+limit),revision:'stored-revision',visible:[]}]};
  };
  t.mock.method(runtime.db,'transaction',async (work:(tx:PoolClient)=>Promise<unknown>)=>
    work({query:readPersisted} as unknown as PoolClient));

  for(const kind of ['gallery','configuration'] as const){
    const schema=kind==='gallery'?PublicVehicleGalleryResponseSchema:PublicVehicleConfigurationResponseSchema;
    const first=await runtime.app.inject({url:`/api/v1/vehicles/${vehicle.id}/${kind}?locale=en&limit=2`});
    assert.equal(first.statusCode,200,first.body);
    const page=schema.parse(first.json()).data;
    assert.equal(page.total,3);
    assert.ok(page.nextCursor);
    assert.deepEqual(page.items,kind==='gallery'?photos.slice(0,2).map(photo=>({...photo,alt:'',altText:missing}))
      :[{id:'sheet.0.0',name:missing,value:missing},{id:'sheet.0.1',name:safeLabel,value:missing}]);
    const second=await runtime.app.inject({url:`/api/v1/vehicles/${vehicle.id}/${kind}?locale=en&limit=1&cursor=${page.nextCursor}`});
    assert.equal(second.statusCode,200,second.body);
    const remaining=schema.parse(second.json()).data;
    assert.equal(remaining.total,3);
    assert.equal(remaining.revision,page.revision);
    assert.equal(remaining.nextCursor,null);
    assert.deepEqual(remaining.items,kind==='gallery'?[photos[2]]:[configuration[2]]);
  }
});
