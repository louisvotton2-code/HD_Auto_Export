import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeVehicleDraftFixture} from '@hd/contracts/fixtures';
import {AliyunGeneralProvider,LibreTranslateProvider,VehicleTranslator,rpcSignature,splitTranslationText,type TranslationProvider} from './translation.js';
import type {TranslatableField} from '@hd/contracts/admin';
import {readConfig} from '../config.js';
import {sourceHash} from './content.js';
import {ApiError} from '../errors.js';
const config=readConfig({DATABASE_URL:'postgres://example:example@127.0.0.1/example',AUTH_SECRET:'a'.repeat(32),TRANSLATION_PROVIDER:'aliyun',ALI_MT_ACCESS_KEY_ID:'test-id',ALI_MT_ACCESS_KEY_SECRET:'test-secret'}).translation;
const source=()=>({id:'550e8400-e29b-41d4-a716-446655440000',version:3,draft:makeVehicleDraftFixture()});
const code=(expected:string)=>(error:unknown)=>!!error && typeof error==='object' && 'code' in error && error.code===expected;

test('RPC signature encodes Unicode and reserved characters exactly',()=>{
  assert.equal(rpcSignature({Action:'TranslateGeneral',SourceText:'中文 + ~*()!',TargetLanguage:'ru'},'test-secret'),'+9aX/1UMHy3QSl8kIMnFMQS0J3M=');
});
test('LibreTranslate sends only explicit source text and languages to the configured local path',async()=>{
  const provider=new LibreTranslateProvider({...config,libreUrl:'http://127.0.0.1:3340',libreEngineVersion:'test-model:1',libreApiKey:'test-only'},(async(url,init)=>{
    assert.equal(String(url),'http://127.0.0.1:3340/translate');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');
    assert.deepEqual(JSON.parse(String(init?.body)),{q:'车辆中文',source:'zh',target:'ru',format:'text',api_key:'test-only'});
    return Response.json({translatedText:'Автомобиль'});
  }) as typeof fetch);
  assert.equal(provider.engineVersion,'libretranslate:test-model:1');assert.equal(await provider.translate('车辆中文','ru',new AbortController().signal),'Автомобиль');
  for(const result of [Response.json({error:'private detail'},{status:400}),Response.json({translatedText:['wrong shape']}),Response.json({translatedText:'车辆中文'})]) {
    const broken=new LibreTranslateProvider({...config,libreUrl:'http://127.0.0.1:3340',libreEngineVersion:'test'},(async()=>result) as typeof fetch);
    await assert.rejects(broken.translate('车辆中文','en',new AbortController().signal),code('TRANSLATION_UPSTREAM_FAILED'));
  }
});
test('fixed official host, signed query and pure text form protocol; no redirects or internal data',async()=>{
  let calls=0;
  const provider=new AliyunGeneralProvider(config,(async(url,init)=>{
    calls++;const requestUrl=new URL(String(url));assert.equal(requestUrl.origin,'https://mt.cn-hangzhou.aliyuncs.com');
    assert.equal(requestUrl.pathname,'/');assert.equal(requestUrl.searchParams.has('SourceText'),false);assert.equal(init?.redirect,'error');assert.equal(init?.method,'POST');
    const form=init?.body as URLSearchParams;
    assert.deepEqual(Object.fromEntries(form),{FormatType:'text',SourceLanguage:'zh',TargetLanguage:'ru',SourceText:'待翻译车辆',Scene:'general'});
    const all={...Object.fromEntries(requestUrl.searchParams),...Object.fromEntries(form)};
    assert.equal(requestUrl.searchParams.get('Signature'),rpcSignature(all,'test-secret'));
    assert.equal(requestUrl.searchParams.get('Version'),'2018-10-12');assert.equal(requestUrl.searchParams.get('Action'),'TranslateGeneral');
    return Response.json({Code:200,Data:{Translated:'Переведенный автомобиль'}});
  }) as typeof fetch);
  assert.equal(await provider.translate('待翻译车辆','ru',new AbortController().signal),'Переведенный автомобиль');assert.equal(calls,1);
});
test('both Aliyun regions bind their fixed HTTPS host, RPC signature and engine version',async()=>{
  const fixtures=[
    {region:'cn-hangzhou' as const,host:'mt.cn-hangzhou.aliyuncs.com',signature:'9++JG6dDtjKxfzYg/FGb2VuFquY='},
    {region:'ap-southeast-1' as const,host:'mt.ap-southeast-1.aliyuncs.com',signature:'rWyOQNAkXwUvAotg7dMOlzw1mIQ='},
  ];
  for(const {region,host,signature} of fixtures) {
    assert.equal(rpcSignature({Action:'TranslateGeneral',SourceText:'中文 + ~*()!',TargetLanguage:'ru',RegionId:region},'test-secret'),signature);
    const provider=new AliyunGeneralProvider({...config,region},(async(url,init)=>{
      const address=new URL(String(url));const form=init?.body as URLSearchParams;
      assert.equal(address.protocol,'https:');assert.equal(address.hostname,host);assert.equal(address.pathname,'/');assert.equal(init?.redirect,'error');
      assert.equal(address.searchParams.get('RegionId'),region);
      const params={...Object.fromEntries(address.searchParams),...Object.fromEntries(form)};
      assert.equal(address.searchParams.get('Signature'),rpcSignature(params,'test-secret'));
      assert.notEqual(address.searchParams.get('Signature'),rpcSignature({...params,RegionId:region==='cn-hangzhou'?'ap-southeast-1':'cn-hangzhou'},'test-secret'));
      return Response.json({TranslateGeneralResponse:{Code:200,Data:{Translated:'Translated vehicle'}}});
    }) as typeof fetch);
    assert.equal(provider.engineVersion,`aliyun-general:2018-10-12:general:${region}:1`);
    assert.equal(await provider.translate('中文车辆','en',new AbortController().signal),'Translated vehicle');
  }
});
test('Aliyun accepts only flat or single known wrapper bodies with exact numeric/string success codes',async()=>{
  for(const result of [
    {Code:200,Data:{Translated:'Flat result'}},
    {Code:'200',Data:{Translated:'Flat string code result'}},
    {TranslateGeneralResponse:{Code:200,Data:{Translated:'Wrapped result'}}},
    {TranslateGeneralResponse:{Code:'200',Data:{Translated:'Wrapped string code result'}}},
  ]) {
    const provider=new AliyunGeneralProvider(config,(async()=>Response.json(result)) as typeof fetch);
    assert.match(await provider.translate('车辆','en',new AbortController().signal),/result$/);
  }
  for(const result of [
    {TranslateGeneralResponse:{Code:10013,Data:{Translated:'Do not accept'}}},
    {Code:10013,TranslateGeneralResponse:{Code:200,Data:{Translated:'Do not accept'}}},
    {TranslateGeneralResponse:{Code:200,Data:{Translated:' '}}},
    {TranslateGeneralResponse:{TranslateGeneralResponse:{Code:200,Data:{Translated:'Do not accept'}}}},
    {OtherResponse:{Code:200,Data:{Translated:'Do not accept'}}},
    {TranslateGeneralResponse:null},null,[],
  ]) {
    const provider=new AliyunGeneralProvider(config,(async()=>Response.json(result)) as typeof fetch);
    await assert.rejects(provider.translate('车辆','en',new AbortController().signal),code('TRANSLATION_UPSTREAM_FAILED'));
  }
});
test('Aliyun never coerces other numeric-looking strings or values into success for either response shape',async()=>{
  for(const status of ['0200','200.0',' 200','200 ','\t200','200\n','','2e2','+200','0xc8',201,0,null,true,undefined]) {
    const body={Code:status,Data:{Translated:'Do not accept'}};
    for(const result of [body,{TranslateGeneralResponse:body}]) {
      const provider=new AliyunGeneralProvider(config,(async()=>Response.json(result)) as typeof fetch);
      await assert.rejects(provider.translate('车辆','en',new AbortController().signal),code('TRANSLATION_UPSTREAM_FAILED'));
    }
  }
});
test('changing only Aliyun region cannot reuse another region translation cache',async()=>{
  const calls={'cn-hangzhou':0,'ap-southeast-1':0};
  const provider=(region:'cn-hangzhou'|'ap-southeast-1')=>new AliyunGeneralProvider({...config,region},(async(_url,init)=>{
    calls[region]++;const target=(init?.body as URLSearchParams).get('TargetLanguage');
    return Response.json({Code:200,Data:{Translated:`${region}:${target}:translated`}});
  }) as typeof fetch);
  const china=provider('cn-hangzhou'),singapore=provider('ap-southeast-1');let current=china;
  const translator=new VehicleTranslator({get engineVersion(){return current.engineVersion;},translate(...args){return current.translate(...args);}});
  const first=await translator.generate(source());await translator.generate(source());assert.equal(calls['cn-hangzhou'],4);
  current=singapore;const second=await translator.generate(source());assert.equal(calls['ap-southeast-1'],4);
  assert.notEqual(first.engineVersion,second.engineVersion);assert.notEqual(first.content.title.translations.en.text,second.content.title.translations.en.text);
  current=china;assert.deepEqual(await translator.generate(source()),first);assert.equal(calls['cn-hangzhou'],4);
});
test('bounded upstream rejects HTTP errors, business errors, blank/unchanged text, malformed/oversized JSON and timeout without leaking details',async()=>{
  for(const fixture of [new Response('private failure',{status:500}),Response.json({Code:10013,Message:'private-account'}),Response.json({Code:200,Data:{Translated:'  '}}),Response.json({Code:200,Data:{Translated:'中文'}}),new Response('not json'),new Response('x'.repeat(150001))]) {
    const provider=new AliyunGeneralProvider(config,(async()=>fixture) as typeof fetch);
    await assert.rejects(provider.translate('中文','en',new AbortController().signal),code('TRANSLATION_UPSTREAM_FAILED'));
  }
  const provider=new AliyunGeneralProvider(config,(async(_url,init)=>{assert.equal(init?.signal?.aborted,true);init?.signal?.throwIfAborted();throw new Error('sensitive URL or secret');}) as typeof fetch);
  await assert.rejects(provider.translate('中文','en',AbortSignal.abort()),error=>code('TRANSLATION_UPSTREAM_FAILED')(error) && !String(error).includes('sensitive'));
});
test('segments preserve every code point and stay within 5000 UTF-16 units',()=>{
  const text='中'.repeat(4999)+'😀'+'文'.repeat(4999)+'后';const chunks=splitTranslationText(text);
  assert.equal(chunks.join(''),text);assert.ok(chunks.every(part=>part.length<=5000));assert.equal(chunks[0]!.length,4999);
});
test('suggestions are pending, preserve snapshots/human revision, no draft writes, cache same source/config and account for both targets',async()=>{
  const vehicle=source();const before=structuredClone(vehicle);const calls:Array<[string,string]>=[];
  const translator=new VehicleTranslator({engineVersion:'test:1',async translate(text,target){calls.push([text,target]);return `${target}:${text}`;}},100_000);
  const result=await translator.generate(vehicle);
  assert.equal(result.content.title.sourceHash,sourceHash(vehicle.draft.content.title));assert.equal(result.version,3);
  assert.equal(result.content.title.translations.zh.kind,'original');assert.equal(result.content.title.translations.zh.engineVersion,null);
  for(const locale of ['en','ru'] as const){assert.equal(result.content.title.translations[locale].kind,'machine');assert.equal(result.content.title.translations[locale].reviewStatus,'pending');}
  assert.deepEqual(vehicle,before);assert.ok(calls.every(([text])=>text!==vehicle.draft.internal.notes));
  const originalCalls=calls.length;await translator.generate(vehicle);assert.equal(calls.length,originalCalls);
  vehicle.draft.content.description.sourceText=null;assert.equal((await translator.generate(vehicle)).content.description,null);
  vehicle.draft.content.title.sourceLanguage='en';await assert.rejects(translator.generate(vehicle),code('TRANSLATION_SOURCE_UNSUPPORTED'));
  await assert.rejects(new VehicleTranslator(null).generate(before),code('TRANSLATION_DISABLED'));
  await assert.rejects(new VehicleTranslator({engineVersion:'test',async translate(){return 'x';}},1).generate(before),code('TRANSLATION_QUOTA_EXCEEDED'));
});
test('finite concurrent generations, shared in-flight calls, failure releases capacity',async()=>{
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let calls=0;
  const provider:TranslationProvider={engineVersion:'test',async translate(){calls++;await pending;return 'translated';}};
  const translator=new VehicleTranslator(provider);const a=translator.generate(source()),b=translator.generate(source());
  await assert.rejects(translator.generate(source()),code('TRANSLATION_BUSY'));release();await Promise.all([a,b]);
  assert.equal(calls,4);await translator.generate(source());assert.equal(calls,4);
});
test('a shared translation waiter observes its own deadline without cancelling the owner or shared cache',async()=>{
  let release!:(text:string)=>void;let calls=0;let ownerCompleted=false;
  const shared=new Promise<string>(resolve=>{release=resolve;});
  const translator=new VehicleTranslator({engineVersion:'deadline-test',async translate(){calls++;return shared;}});
  // Exercise the per-text boundary directly so each request has a short, independently controlled deadline.
  const translate=translator as unknown as {text:(field:TranslatableField,target:'en'|'ru',signal:AbortSignal)=>Promise<string>};
  const field=source().draft.content.title;const ownerSignal=new AbortController().signal;
  const owner=translate.text(field,'en',ownerSignal).then(text=>{ownerCompleted=true;return text;});
  const waiter=new AbortController();const timeout=new DOMException('Test deadline expired','TimeoutError');
  const timer=setTimeout(()=>waiter.abort(timeout),5);
  try {
    const waiting=translate.text(field,'en',waiter.signal);
    await assert.rejects(waiting,error=>error===timeout);
    assert.equal(ownerCompleted,false);assert.equal(ownerSignal.aborted,false);assert.equal(calls,1);
    release('Translated shared result');assert.equal(await owner,'Translated shared result');
    await assert.rejects(translate.text(field,'en',waiter.signal),error=>error===timeout); // An expired waiter cannot consume the cache.
    assert.equal(await translate.text(field,'en',ownerSignal),'Translated shared result');assert.equal(calls,1);
  } finally{clearTimeout(timer);release('Translated shared result');await owner;}
});
test('aborted work cannot consume budget or cache a late provider result',async()=>{
  let release!:(text:string)=>void;let calls=0;
  const shared=new Promise<string>(resolve=>{release=resolve;});
  const translator=new VehicleTranslator({engineVersion:'deadline-budget-test',async translate(){calls++;return calls===1?shared:'fresh result';}});
  const translate=translator as unknown as {text:(field:TranslatableField,target:'en'|'ru',signal:AbortSignal)=>Promise<string>;usedCharacters:number};
  const field=source().draft.content.title;const expired=new AbortController();expired.abort();
  await assert.rejects(translate.text(field,'en',expired.signal),error=>error===expired.signal.reason);
  assert.equal(translate.usedCharacters,0);assert.equal(calls,0);
  const owner=new AbortController();const pending=translate.text(field,'en',owner.signal);owner.abort();release('late result');
  await assert.rejects(pending,error=>error===owner.signal.reason);
  assert.equal(await translate.text(field,'en',new AbortController().signal),'fresh result');assert.equal(calls,2);
});
test('generate refuses a final provider result after the request deadline',async(context)=>{
  const deadline=new AbortController();
  context.mock.method(AbortSignal,'timeout',()=>deadline.signal);
  const translator=new VehicleTranslator({engineVersion:'deadline-final-test',async translate(_text,target){
    if(target==='ru')deadline.abort(new DOMException('Test deadline expired','TimeoutError'));
    return 'provider ignored abort';
  }});
  await assert.rejects(translator.generate(source()),code('TRANSLATION_UPSTREAM_FAILED'));
});
test('display generation maps its total deadline to a retryable upstream error',async(context)=>{
  const deadline=new AbortController();context.mock.method(AbortSignal,'timeout',()=>deadline.signal);
  const translator=new VehicleTranslator({engineVersion:'display-deadline-test',async translate(){deadline.abort(new DOMException('Test deadline expired','TimeoutError'));return 'late result';}});
  const field={ref:'model',sourceLanguage:'zh',sourceText:'样例车型',sourceHash:'a'.repeat(64),sourceVersion:1,translations:{zh:null,en:null,ru:null}};
  await assert.rejects(translator.generateDisplay([field]),(error:unknown)=>error instanceof ApiError&&error.status===503&&error.code==='TRANSLATION_UPSTREAM_FAILED'&&error.retryable);
});
