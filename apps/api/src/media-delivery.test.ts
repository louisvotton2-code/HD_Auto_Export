import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiErrorSchema } from '@hd/contracts/public';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { ApiError } from './errors.js';
import { MediaStorageError } from './media/storage.js';

const id='33333333-3333-4333-8333-333333333333';
const publicPath=`/api/v1/media/${id}`;
const previewPath=`/api/v1/admin/media/${id}/preview`;
const staffCookie='hd-auto.session_token=delivery-test-session';
const original={body:Buffer.from('authorized-direct-image-body'),etag:'W/"original-media-test"'};
const thumbnail={body:Buffer.from('authorized-direct-thumbnail-body'),etag:'W/"thumbnail-media-test"'};
const methods=['GET','HEAD'] as const;
const modes=['nginx','default'] as const;

// Exercise the HTTP authorization and delivery boundary without media files, sockets or
// database connections. Service/storage authorization has its own integration tests.
async function setup(t:TestContext,mode:'nginx'|'default'='nginx',servingModeFile?:string) {
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
    AUTH_SECRET:'media-delivery-test-placeholder-not-a-live-secret',
    API_SERVING_MODE_FILE:servingModeFile,
    ...(mode==='nginx'?{MEDIA_DELIVERY:'nginx'}:{})});
  const runtime=await buildApp(config);
  t.after(()=>runtime.app.close());
  t.mock.method(runtime.db.pool,'connect',()=>{throw new Error('This test must not connect to a database.');});
  t.mock.method(runtime.db.pool,'query',async(sql:unknown)=>{
    assert.equal(sql,'SELECT id,name,role,banned FROM staff WHERE id=$1');
    return {rows:[{id:'delivery-test-staff',name:'Test editor',role:'editor',banned:false}],rowCount:1};
  });
  t.mock.method(runtime.auth.api,'getSession',async(options:{headers?:HeadersInit})=>{
    if(new Headers(options?.headers).get('cookie')!==staffCookie) return null;
    return {user:{id:'delivery-test-staff'},session:{id:'delivery-test-session'}};
  });
  const publicDelivery=t.mock.method(runtime.media,'publicDelivery',async(
    mediaId:string,variant:'thumb'|undefined,options:{ifNoneMatch?:string;readBody:boolean},
  )=>{
    const image=variant==='thumb'?thumbnail:original;
    const notModified=options.ifNoneMatch===image.etag||options.ifNoneMatch==='*';
    return {
      filename:`${mediaId}${variant==='thumb'?'.thumb':''}.webp`,
      byteSize:image.body.length,etag:image.etag,notModified,
      body:options.readBody&&!notModified?image.body:undefined,
    };
  });
  const previewFile=t.mock.method(runtime.media,'previewFile',async(mediaId:string)=>({
    filename:`${mediaId}.webp`,byteSize:original.body.length,
  }));
  const preview=t.mock.method(runtime.media,'preview',async()=>{
    assert.equal(mode,'default','Nginx delivery must not load the preview body into the API.');
    return original.body;
  });
  return {...runtime,config,publicDelivery,previewFile,preview};
}

type HttpResponse={statusCode:number;headers:Record<string,unknown>;body:string};
function noStore(response:HttpResponse) {
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.equal(response.headers.etag,undefined);
}
function publicHeaders(response:HttpResponse,etag:string) {
  assert.equal(response.headers['cache-control'],'private, no-cache');
  assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.equal(response.headers.etag,etag);
}
function redirected(response:HttpResponse,target:string) {
  assert.equal(response.statusCode,200);
  assert.equal(response.body,'');
  assert.equal(response.headers['content-type'],'image/webp');
  assert.equal(response.headers['x-accel-redirect'],target);
  assert.equal(response.headers['x-accel-expires'],'0');
  assert.equal(response.headers['cache-control'],undefined);
  assert.equal(response.headers['x-content-type-options'],'nosniff');
}
function noRedirect(response:HttpResponse) {
  assert.equal(response.headers['x-accel-redirect'],undefined);
  assert.equal(response.headers['x-accel-expires'],undefined);
}

test('Nginx public GET and HEAD delegate authorized originals and thumbnails to the public location',async t=>{
  const {app,publicDelivery}=await setup(t);
  for(const method of methods) {
    for(const [variant,image,suffix] of [[undefined,original,''],['thumb',thumbnail,'.thumb']] as const) {
      const response=await app.inject({method,url:`${publicPath}${variant?'?variant=thumb':''}`});
      redirected(response,`/_hd_public_media/${id}${suffix}.webp`);
      assert.equal(response.headers.etag,image.etag);
      const [mediaId,requestedVariant,options]=publicDelivery.mock.calls.at(-1)!.arguments;
      assert.equal(mediaId,id);
      assert.equal(requestedVariant,variant);
      assert.equal(options.readBody,false);
      assert.equal(options.ifNoneMatch,undefined);
    }
  }
  assert.equal(publicDelivery.mock.callCount(),4);
});

test('matching public validators return a bodyless 304 after the service checks delivery',async t=>{
  for(const mode of modes) {
    const {app,publicDelivery}=await setup(t,mode);
    for(const method of methods) {
      const response=await app.inject({
        method,url:`${publicPath}?variant=thumb`,headers:{'if-none-match':thumbnail.etag},
      });
      assert.equal(response.statusCode,304);
      assert.equal(response.body,'');
      assert.equal(response.headers['content-type'],undefined);
      publicHeaders(response,thumbnail.etag);
      noRedirect(response);
      assert.deepEqual(publicDelivery.mock.calls.at(-1)?.arguments,[
        id,'thumb',{ifNoneMatch:thumbnail.etag,readBody:mode==='default'&&method==='GET'},
      ]);
    }
    assert.equal(publicDelivery.mock.callCount(),2);
  }
});

test('Nginx public requests use API decisions for conditional delivery',async t=>{
  const {app,publicDelivery}=await setup(t);
  const directHeaders=[
    {'if-match':'*'},
    {'if-unmodified-since':'Sat, 01 Jan 2000 00:00:00 GMT'},
  ];
  for(const headers of directHeaders) {
    const response=await app.inject({method:'GET',url:publicPath,headers});
    assert.equal(response.statusCode,200);
    assert.deepEqual(response.rawPayload,original.body);
    publicHeaders(response,original.etag);
    noRedirect(response);
    assert.equal(publicDelivery.mock.calls.at(-1)?.arguments[2].readBody,true);
  }
  const response=await app.inject({method:'GET',url:publicPath,headers:{
    'if-match':original.etag,'if-none-match':original.etag,
  }});
  assert.equal(response.statusCode,412);
  assert.equal(ApiErrorSchema.parse(response.json()).error.code,'VERSION_CONFLICT');
  noStore(response);
  noRedirect(response);
  assert.equal(publicDelivery.mock.calls.at(-1)?.arguments[2].readBody,false);
  const invalidList=`*, ${thumbnail.etag}`;
  const unmatched=await app.inject({method:'GET',url:publicPath,headers:{'if-none-match':invalidList}});
  redirected(unmatched,`/_hd_public_media/${id}.webp`);
  assert.equal(unmatched.headers.etag,original.etag);
  assert.deepEqual(publicDelivery.mock.calls.at(-1)?.arguments,[
    id,undefined,{ifNoneMatch:invalidList,readBody:false},
  ]);
  const wildcard=await app.inject({method:'GET',url:publicPath,headers:{'if-none-match':'*'}});
  assert.equal(wildcard.statusCode,304);
  assert.equal(wildcard.body,'');
  publicHeaders(wildcard,original.etag);
  noRedirect(wildcard);
  assert.deepEqual(publicDelivery.mock.calls.at(-1)?.arguments,[id,undefined,{ifNoneMatch:'*',readBody:false}]);
  assert.equal(publicDelivery.mock.callCount(),5);
});

test('a candidate slot can serve the original without caching it at the thumbnail URL',async t=>{
  const root=await mkdtemp(join(tmpdir(),'hd-media-delivery-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const servingModeFile=join(root,'serving-mode');
  await writeFile(servingModeFile,'candidate',{mode:0o600});
  const {app,publicDelivery}=await setup(t,'nginx',servingModeFile);
  for(const method of methods) {
    const response=await app.inject({
      method,url:`${publicPath}?variant=thumb`,headers:{'if-none-match':original.etag},
    });
    assert.equal(response.statusCode,200);
    if(method==='GET') assert.deepEqual(response.rawPayload,original.body);
    else assert.equal(response.body,'');
    assert.equal(response.headers['content-type'],'image/webp');
    noStore(response);
    noRedirect(response);
    assert.deepEqual(publicDelivery.mock.calls.at(-1)?.arguments,[id,undefined,{readBody:method==='GET'}]);
  }
  assert.equal(publicDelivery.mock.callCount(),2);
});

test('Nginx preview requires a staff session for both GET and HEAD before issuing a redirect',async t=>{
  const {app,previewFile,preview}=await setup(t);
  for(const method of methods) {
    const denied=await app.inject({method,url:previewPath,headers:{'if-none-match':'*'}});
    assert.equal(denied.statusCode,401);
    noRedirect(denied);
    noStore(denied);
    if(method==='GET') assert.equal(ApiErrorSchema.parse(denied.json()).error.code,'UNAUTHENTICATED');
  }
  assert.equal(previewFile.mock.callCount(),0);
  for(const method of methods) {
    const response=await app.inject({method,url:previewPath,headers:{cookie:staffCookie}});
    redirected(response,`/_hd_media/${id}.webp`);
    assert.equal(response.headers.etag,undefined);
    assert.deepEqual(previewFile.mock.calls.at(-1)?.arguments,[id]);
  }
  assert.equal(previewFile.mock.callCount(),2);
  assert.equal(preview.mock.callCount(),0);
});

test('public media errors stay uncached with a previously issued validator',async t=>{
  for(const mode of modes) {
    const {app,publicDelivery}=await setup(t,mode);
    for(const [error,status,code] of [
      [new ApiError(404,'NOT_FOUND','Resource is not available.'),404,'NOT_FOUND'],
      [new MediaStorageError('MEDIA_STORAGE_ERROR','Private file /srv/hd-private/secret.webp is unavailable.'),503,'SERVICE_UNAVAILABLE'],
    ] as const) {
      publicDelivery.mock.mockImplementation(async()=>{throw error;});
      for(const method of methods) {
        const response=await app.inject({method,url:publicPath,headers:{'if-none-match':original.etag}});
        assert.equal(response.statusCode,status);
        noRedirect(response);
        noStore(response);
        if(method==='GET') assert.equal(ApiErrorSchema.parse(response.json()).error.code,code);
        else assert.equal(response.body,'');
        assert.equal(response.body.includes('/srv/hd-private/'),false);
      }
    }
    assert.equal(publicDelivery.mock.callCount(),4);
  }
});

test('invalid internal filenames and URLs fail closed for public images and authenticated previews',async t=>{
  const {app,publicDelivery,previewFile}=await setup(t);
  const invalid=['../private-secret.webp','/srv/hd-private/private-secret.webp',
    `/_hd_media/${id}.webp`,`https://media.example.invalid/${id}.webp`,
    `${id}.webp?download=1`,`${id}.webp\r\nX-Injected: private-secret`,
    `${id}.original.webp`,'not-a-uuid.webp'];
  for(const filename of invalid) {
    publicDelivery.mock.mockImplementation(async()=>({
      filename,byteSize:original.body.length,etag:original.etag,notModified:false,
    }));
    previewFile.mock.mockImplementation(async()=>({filename,byteSize:original.body.length}));
    for(const url of [publicPath,previewPath]) {
      const response=await app.inject({method:'GET',url,headers:{cookie:staffCookie}});
      assert.equal(response.statusCode,503);
      noRedirect(response);
      noStore(response);
      assert.equal(ApiErrorSchema.parse(response.json()).error.code,'SERVICE_UNAVAILABLE');
      assert.equal(response.body.includes(filename),false);
      assert.equal(response.headers['x-injected'],undefined);
    }
  }
});

test('unknown media variants and invalid IDs are rejected before file authorization',async t=>{
  const {app,publicDelivery}=await setup(t);
  for(const url of [`${publicPath}?variant=original`,`${publicPath}?variant=THUMB`,
    `${publicPath}?variant=thumb&variant=thumb`,'/api/v1/media/not-a-uuid']) {
    const response=await app.inject({method:'GET',url,headers:{'if-none-match':original.etag}});
    assert.equal(response.statusCode,400);
    noRedirect(response);
    noStore(response);
    assert.equal(ApiErrorSchema.parse(response.json()).error.code,'INVALID_REQUEST');
  }
  assert.equal(publicDelivery.mock.callCount(),0);
});

test('default direct public delivery returns bytes for GET and metadata for HEAD with an unmatched validator',async t=>{
  const {app,config,publicDelivery}=await setup(t,'default');
  assert.equal(config.mediaDelivery,'direct');
  for(const method of methods) {
    for(const [variant,image,validator] of [[undefined,original,thumbnail.etag],['thumb',thumbnail,original.etag]] as const) {
      const response=await app.inject({
        method,url:`${publicPath}${variant?'?variant=thumb':''}`,headers:{'if-none-match':validator},
      });
      assert.equal(response.statusCode,200);
      if(method==='GET') assert.deepEqual(response.rawPayload,image.body);
      else assert.equal(response.body,'');
      assert.equal(response.headers['content-type'],'image/webp');
      assert.equal(Number(response.headers['content-length']),image.body.length);
      publicHeaders(response,image.etag);
      noRedirect(response);
      assert.deepEqual(publicDelivery.mock.calls.at(-1)?.arguments,[
        id,variant,{ifNoneMatch:validator,readBody:method==='GET'},
      ]);
    }
  }
  assert.equal(publicDelivery.mock.callCount(),4);
});

test('conditional staff preview sends authorized bytes with no-store in both modes',async t=>{
  for(const mode of modes) {
    const {app,previewFile,preview}=await setup(t,mode);
    preview.mock.mockImplementation(async()=>original.body);
    for(const method of methods) {
      const response=await app.inject({method,url:previewPath,headers:{cookie:staffCookie,'if-none-match':'*'}});
      assert.equal(response.statusCode,200);
      assert.deepEqual(response.rawPayload,method==='GET'?original.body:Buffer.alloc(0));
      assert.equal(response.headers['content-type'],'image/webp');
      noRedirect(response);
      noStore(response);
    }
    assert.equal(preview.mock.callCount(),2);
    assert.equal(previewFile.mock.callCount(),0);
  }
});
