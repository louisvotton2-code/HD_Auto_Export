import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicVehicleQuerySchema,PublicFilterQuerySchema,PublicVehicleSchema,DisplayTextSchema,findBrand} from '../dist/public.js';
import {makePublicVehicleFixture,makeLocalizedPublicVehicleFixture,demoPublicVehicleFixture} from '../dist/fixtures.js';
import {DisplayFieldSchema,getDisplayTextLimit} from '../dist/admin.js';

test('invalid decimal bounds are validation failures, never BigInt exceptions',()=>{
  for(const schema of [PublicVehicleQuerySchema,PublicFilterQuerySchema])for(const invalid of ['abc','1e3','-1','0x10','1.123','',[],null]){
    assert.doesNotThrow(()=>assert.equal(schema.safeParse({priceMin:invalid,priceMax:'20',priceCurrency:'USD'}).success,false));
  }
  assert.equal(PublicVehicleQuerySchema.safeParse({priceMin:'99999999999999.98',priceMax:'99999999999999.97',priceCurrency:'USD'}).success,false);
});
test('ranges use explicit currencies, inclusive zero and ordered bounds',()=>{
  assert.equal(PublicVehicleQuerySchema.safeParse({priceMin:'0'}).success,false);
  assert.equal(PublicVehicleQuerySchema.safeParse({priceMin:'0',priceMax:'0.00',priceCurrency:'CNY',mileageMin:0,mileageMax:0,yearMin:2024,yearMax:2024}).success,true);
  for(const input of [{mileageMin:2,mileageMax:1},{yearMin:2025,yearMax:2024},{generation:'g1'},{trim:'t1',make:'toyota'}])assert.equal(PublicVehicleQuerySchema.safeParse(input).success,false);
  assert.equal(PublicVehicleQuerySchema.safeParse({make:'toyota',model:'corolla',generation:'g1',trim:'t1',drivetrain:'awd'}).success,true);
});
test('old responses gain no opt-in fields; localized demo facts are allowed',()=>{
  const old=PublicVehicleSchema.parse(makePublicVehicleFixture());
  assert.equal('display' in old,false);assert.equal('generation' in old.facts,false);
  assert.equal(PublicVehicleSchema.safeParse({...demoPublicVehicleFixture,facts:{...demoPublicVehicleFixture.facts,generation:null,drivetrain:null}}).success,true);
  for(const locale of ['zh','en','ru'])for(const state of ['ready','missing','machine'])assert.equal(PublicVehicleSchema.safeParse(makeLocalizedPublicVehicleFixture(locale,state)).success,true);
});
test('display status is unambiguous and public metadata rejects internal attributes',()=>{
  const missing={status:'missing',text:null,requestedLocale:'en',contentLocale:null,provenance:null,reviewed:false};
  assert.equal(DisplayTextSchema.safeParse(missing).success,true);
  for(const input of [{...missing,status:'ready'},{...missing,reviewed:true},{...missing,text:'hidden raw text'},{...missing,sourceHash:'secret'},{...missing,engineVersion:'private'}])assert.equal(DisplayTextSchema.safeParse(input).success,false);
  assert.equal(DisplayTextSchema.safeParse({status:'ready',text:' ',requestedLocale:'en',contentLocale:'en',provenance:'human',reviewed:true}).success,false);
});
test('brand aliases are exact and do not replace the stored identity',()=>{
  const old={id:'manual_unchanged',name:'丰田'};assert.equal(findBrand(old).labels.en,'Toyota');assert.equal(old.id,'manual_unchanged');
  assert.equal(findBrand({id:'unknown',name:'Toyota maybe'}),undefined);
  for(const name of ['Bestune','MHero','GAC','Chery','Geely','Changan'])assert.ok(findBrand({id:'manual',name}));
});
test('translations obey their destination field limit, including Cyrillic text',()=>{
  for(const [ref,limit] of [['model',120],['source.platform',120],['location.city',120],['location.displayName',200],['price.includes.b671b2d8-9c0f-5903-a228-b2218c6dcf53',200],['media.b671b2d8-9c0f-5903-a228-b2218c6dcf53.alt',500]]){
    assert.equal(getDisplayTextLimit(ref),limit);
    const field={ref,sourceLanguage:'zh',sourceText:'样例',sourceVersion:1,sourceHash:'a'.repeat(64),translations:{zh:null,en:null,ru:{text:'Ж'.repeat(limit),kind:'human',reviewStatus:'approved',sourceVersion:1,humanEditVersion:1,engineVersion:null}}};
    assert.equal(DisplayFieldSchema.safeParse(field).success,true);field.translations.ru.text+='Ж';assert.equal(DisplayFieldSchema.safeParse(field).success,false);
  }
});
