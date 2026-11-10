import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ApiErrorSchema } from '@hd/contracts/public';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { ApiError } from './errors.js';
import { MediaStorageError } from './media/storage.js';

const id='33333333-3333-4333-8333-333333333333';
const publicPath=`/api/v1/media/${id}`;
const previewPath=`/api/v1/admin/media/${id}/preview`;
const staffCookie='hd-auto.session_token=delivery-test-session';
const bytes=Buffer.from('authorized-direct-image-body');

// Exercise the HTTP authorization and delivery boundary without files, sockets or
// database connections. Service/storage authorization has its own integration tests.
async function setup(t:TestContext,mode:'nginx'|'default'='nginx') {
  const config=readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused',
    AUTH_SECRET:'media-delivery-test-placeholder-not-a-live-secret',
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
  const publicFile=t.mock.method(runtime.media,'publicFile',async(mediaId:string,variant?:'thumb')=>({
    filename:`${mediaId}${variant==='thumb'?'.thumb':''}.webp`,byteSize:bytes.length,
  }));
  const previewFile=t.mock.method(runtime.media,'previewFile',async(mediaId:string)=>({filename:`${mediaId}.webp`,byteSize:bytes.length}));
  const publicRead=t.mock.method(runtime.media,'publicRead',async()=>{
    assert.equal(mode,'default','Nginx delivery must not load the public media body into the API.');
    return bytes;
  });
  const preview=t.mock.method(runtime.media,'preview',async()=>{
    assert.equal(mode,'default','Nginx delivery must not load the preview body into the API.');
    return bytes;
  });
  return {...runtime,config,publicFile,previewFile,publicRead,preview};
}

type HttpResponse={statusCode:number;headers:Record<string,unknown>;body:string};
function secureHeaders(response:HttpResponse) {
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.headers['x-content-type-options'],'nosniff');
}
function redirected(response:HttpResponse,filename:string) {
  assert.equal(response.statusCode,200);assert.equal(response.body,'');
  assert.equal(response.headers['content-type'],'image/webp');
  assert.equal(response.headers['x-accel-redirect'],`/_hd_media/${filename}`);
  assert.equal(response.headers['x-accel-expires'],'0');
  secureHeaders(response);
}
function noRedirect(response:HttpResponse) {
  assert.equal(response.headers['x-accel-redirect'],undefined);
  assert.equal(response.headers['x-accel-expires'],undefined);
  secureHeaders(response);
}

test('Nginx public GET and HEAD delegate only the authorized original or fixed thumbnail',async t=>{
  const {app,publicFile,publicRead}=await setup(t);
  for(const method of ['GET','HEAD'] as const) {
    for(const variant of [undefined,'thumb'] as const) {
      const response=await app.inject({method,url:`${publicPath}${variant?'?variant=thumb':''}`});
      redirected(response,`${id}${variant?'.thumb':''}.webp`);
      assert.deepEqual(publicFile.mock.calls.at(-1)?.arguments,[id,variant]);
    }
  }
  assert.equal(publicFile.mock.callCount(),4);assert.equal(publicRead.mock.callCount(),0);
});

test('Nginx preview requires a staff session for both GET and HEAD before issuing a redirect',async t=>{
  const {app,previewFile,preview}=await setup(t);
  for(const method of ['GET','HEAD'] as const) {
    const denied=await app.inject({method,url:previewPath});
    assert.equal(denied.statusCode,401);noRedirect(denied);
    if(method==='GET') assert.equal(ApiErrorSchema.parse(denied.json()).error.code,'UNAUTHENTICATED');
  }
  assert.equal(previewFile.mock.callCount(),0);
  for(const method of ['GET','HEAD'] as const) {
    redirected(await app.inject({method,url:previewPath,headers:{cookie:staffCookie}}),`${id}.webp`);
    assert.deepEqual(previewFile.mock.calls.at(-1)?.arguments,[id]);
  }
  assert.equal(previewFile.mock.callCount(),2);assert.equal(preview.mock.callCount(),0);
});

test('unavailable or unauthorized public media never exposes a redirect or internal error details',async t=>{
  const {app,publicFile,publicRead}=await setup(t);
  for(const [error,status,code] of [
    [new ApiError(404,'NOT_FOUND','Resource is not available.'),404,'NOT_FOUND'],
    [new MediaStorageError('MEDIA_STORAGE_ERROR','Private file /srv/hd-private/secret.webp is unavailable.'),503,'SERVICE_UNAVAILABLE'],
  ] as const) {
    publicFile.mock.mockImplementation(async()=>{throw error;});
    for(const method of ['GET','HEAD'] as const) {
      const response=await app.inject({method,url:publicPath});
      assert.equal(response.statusCode,status);noRedirect(response);
      if(method==='GET') assert.equal(ApiErrorSchema.parse(response.json()).error.code,code);
      assert.equal(response.body.includes('/srv/hd-private/'),false);
    }
  }
  assert.equal(publicRead.mock.callCount(),0);
});

test('invalid internal filenames and URLs fail closed for public images and authenticated previews',async t=>{
  const {app,publicFile,previewFile}=await setup(t);
  const invalid=['../private-secret.webp','/srv/hd-private/private-secret.webp',
    `/_hd_media/${id}.webp`,`https://media.example.invalid/${id}.webp`,
    `${id}.webp?download=1`,`${id}.webp\r\nX-Injected: private-secret`,
    `${id}.original.webp`,'not-a-uuid.webp'];
  for(const filename of invalid) {
    publicFile.mock.mockImplementation(async()=>({filename,byteSize:bytes.length}));
    previewFile.mock.mockImplementation(async()=>({filename,byteSize:bytes.length}));
    for(const url of [publicPath,previewPath]) {
      const response=await app.inject({method:'GET',url,headers:{cookie:staffCookie}});
      assert.equal(response.statusCode,503);noRedirect(response);
      assert.equal(ApiErrorSchema.parse(response.json()).error.code,'SERVICE_UNAVAILABLE');
      assert.equal(response.body.includes(filename),false);
      assert.equal(response.headers['x-injected'],undefined);
    }
  }
});

test('unknown media variants and invalid IDs are rejected before file authorization',async t=>{
  const {app,publicFile,publicRead}=await setup(t);
  for(const url of [`${publicPath}?variant=original`,`${publicPath}?variant=THUMB`,
    `${publicPath}?variant=thumb&variant=thumb`,'/api/v1/media/not-a-uuid']) {
    const response=await app.inject({method:'GET',url});
    assert.equal(response.statusCode,400);noRedirect(response);
    assert.equal(ApiErrorSchema.parse(response.json()).error.code,'INVALID_REQUEST');
  }
  assert.equal(publicFile.mock.callCount(),0);assert.equal(publicRead.mock.callCount(),0);
});

test('default direct delivery returns authorized bytes without an internal redirect',async t=>{
  const {app,config,publicFile,previewFile,publicRead,preview}=await setup(t,'default');
  assert.equal(config.mediaDelivery,'direct');
  for(const url of [publicPath,`${publicPath}?variant=thumb`,previewPath]) {
    const response=await app.inject({method:'GET',url,headers:{cookie:staffCookie}});
    assert.equal(response.statusCode,200);assert.deepEqual(response.rawPayload,bytes);
    assert.equal(response.headers['content-type'],'image/webp');noRedirect(response);
  }
  assert.equal(publicRead.mock.callCount(),2);assert.equal(preview.mock.callCount(),1);
  assert.equal(publicFile.mock.callCount(),0);assert.equal(previewFile.mock.callCount(),0);
});
