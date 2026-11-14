import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertLocalPreviewTarget,LocalPreviewManifest} from './local-preview.js';
const base={NODE_ENV:'development',HD_DEPLOYMENT_ENV:'local',DATABASE_URL:'postgresql://test:test@127.0.0.1/hd_local_preview',TRANSLATION_PROVIDER:'disabled'};
test('persistent sample importer refuses production, remote/other databases, excessive scope and translation',()=>{
 assert.equal(assertLocalPreviewTarget(base),base.DATABASE_URL);
 for(const env of [{NODE_ENV:'production'},{HD_DEPLOYMENT_ENV:'production'},{DATABASE_URL:'postgresql://test:test@db/hd_local_preview'},{DATABASE_URL:'postgresql://test:test@127.0.0.1/production'},{TRANSLATION_PROVIDER:'aliyun'},{DATABASE_URL:base.DATABASE_URL+'?host=/tmp&host=remote.example'}])assert.throws(()=>assertLocalPreviewTarget({...base,...env}));
 assert.equal(LocalPreviewManifest.safeParse({version:1,batchKey:'local-real-v1',identities:Array.from({length:201},(_,i)=>({source:'che168',externalId:String(i)}))}).success,false);
});
