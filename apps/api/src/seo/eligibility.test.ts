import assert from 'node:assert/strict';
import {test} from 'node:test';
import {eligibleSeoLocales,type SeoRecord} from './eligibility.js';
const text=(text:string,locale:string)=>({text,kind:'human',contentLocale:locale});
const display=(locale:string)=>({status:'ready',text:'Sample',contentLocale:locale});
const fixture=():SeoRecord=>({id:'ext-fixture',kind:'external',facts:{make:{id:'make'},model:{id:'model'},modelYear:2024,mileageKm:0,powertrain:'electric'},
 localized:{en:{title:text('Synthetic sample vehicle','en'),description:text('A complete synthetic description for this vehicle.','en'),display:{make:display('en'),model:display('en')}}},
 content:null,price:'100',visible:true,has_image:true,last_modified:new Date('2026-11-21T00:00:00Z')});
test('quality preserves zero mileage but excludes missing facts, unavailable photos and wrong-language fallback',()=>{
 const row=fixture();assert.deepEqual(eligibleSeoLocales(row),['en']);
 for(const change of [{visible:false},{has_image:false},{price:'0'},{price:null},{facts:{...row.facts,mileageKm:null}},{facts:{...row.facts,powertrain:'unknown'}}])assert.deepEqual(eligibleSeoLocales({...row,...change}),[]);
 row.localized.en.title.kind='catalog';assert.deepEqual(eligibleSeoLocales(row),[]);
 row.localized.en.title=text('Synthetic sample vehicle','zh');assert.deepEqual(eligibleSeoLocales(row),[]);
});
test('manual SEO uses current publication texts and published display, never draft content',()=>{
 const row=fixture();row.kind='manual';row.content={};row.display={en:{display:{make:display('en'),model:display('en')}}};
 for(const field of ['title','description'])row.content[field]={sourceLanguage:'zh',sourceVersion:2,translations:{en:{text:'A complete synthetic vehicle description',kind:'machine',reviewStatus:'pending',sourceVersion:2}}};
 assert.deepEqual(eligibleSeoLocales(row),['en']);row.content.title.translations.en.sourceVersion=1;assert.deepEqual(eligibleSeoLocales(row),[]);
 row.content.title.translations.en.sourceVersion=2;row.content.title.translations.en.reviewStatus='stale';assert.deepEqual(eligibleSeoLocales(row),[]);
});
