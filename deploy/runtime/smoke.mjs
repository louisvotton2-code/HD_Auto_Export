// Run only in the isolated OPS fixture project, using the container's dependencies.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {makeVehicleDraftFixture} from '@hd/contracts/fixtures';
const base='http://127.0.0.1:3320',origin=process.env.AUTH_BASE_URL;
let cookie='';
async function req(path,{method='GET',body,status=200,anonymous=false,headers={}}={}) {
 const r=await fetch(base+path,{method,headers:{origin,...(!anonymous?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal(r.status,status,`${method} ${path}: expected ${status}, got ${r.status}`);return r;
}
async function data(path,options){return(await(await req(path,options)).json()).data;}
const login=await req('/api/auth/sign-in/email',{method:'POST',body:{email:'ops-local@example.invalid',password:process.env.OPS_TEST_PASSWORD}});
const cookies=login.headers.getSetCookie();assert.ok(cookies.some(c=>/Secure/i.test(c)&&/HttpOnly/i.test(c)));
cookie=cookies.map(c=>c.split(';')[0]).join('; ');assert.ok(cookie);
await req('/api/v1/admin/me',{anonymous:true,status:401});
const draft=makeVehicleDraftFixture();draft.media=[];draft.internal.notes='OPS_ISOLATED_SYNTHETIC_NOT_REAL_INVENTORY';
let vehicle=await data('/api/v1/admin/vehicles',{method:'POST',body:{draft},headers:{'idempotency-key':randomUUID()},status:201});
const png=await sharp({create:{width:640,height:480,channels:3,background:'#274a5e'}}).png().toBuffer();
const upload=await data('/api/v1/admin/media/uploads',{method:'POST',body:{vehicleId:vehicle.id,contentType:'image/png',sizeBytes:png.length,rights:{basis:'owned',note:'OPS isolated generated test image, not a real vehicle.'}},status:201});
const binary=await fetch(base+upload.uploadUrl,{method:'PUT',headers:{cookie,origin,'content-type':'image/png','if-match':String(upload.media.version)},body:png});assert.equal(binary.status,200);
const uploaded=(await binary.json()).data;
const media=await data(`/api/v1/admin/media/${uploaded.id}/complete`,{method:'POST',body:{version:uploaded.version}});
await req(`/api/v1/media/${media.id}`,{anonymous:true,status:404});
vehicle.draft.media=[{id:media.id,sortOrder:0,isCover:true,alt:'OPS synthetic test image'}];
vehicle=await data(`/api/v1/admin/vehicles/${vehicle.id}`,{method:'PATCH',body:{version:vehicle.version,draft:vehicle.draft}});
vehicle=await data(`/api/v1/admin/vehicles/${vehicle.id}/availability`,{method:'POST',body:{version:vehicle.version,availability:'available',checkedAt:new Date().toISOString()}});
vehicle=await data(`/api/v1/admin/vehicles/${vehicle.id}/publish`,{method:'POST',body:{version:vehicle.version},headers:{'idempotency-key':randomUUID()}});
for(const locale of ['zh','en','ru']) await req(`/api/v1/vehicles/${vehicle.id}?locale=${locale}`,{anonymous:true});
const image=Buffer.from(await(await req(`/api/v1/media/${media.id}`,{anonymous:true})).arrayBuffer());
vehicle=await data(`/api/v1/admin/vehicles/${vehicle.id}/archive`,{method:'POST',body:{version:vehicle.version}});
await req(`/api/v1/vehicles/${vehicle.id}`,{anonymous:true,status:404});await req(`/api/v1/media/${media.id}`,{anonymous:true,status:404});
vehicle=await data(`/api/v1/admin/vehicles/${vehicle.id}/publish`,{method:'POST',body:{version:vehicle.version},headers:{'idempotency-key':randomUUID()}});
console.log(JSON.stringify({vehicleId:vehicle.id,stockCode:vehicle.stockCode,mediaId:media.id,imageSha256:createHash('sha256').update(image).digest('hex'),bytes:image.length,checks:['login_secure_cookie','anonymous_401','upload_private_404','publish_three_locales','archive_vehicle_and_media_404','republish_for_restore']}));
