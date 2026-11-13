import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {catalogColumns,verifyCatalogCsv} from './csv.js';
import {mergePresent,sourceDocumentHash,sourcePresence,type SourceDocument} from './documents.js';
import {adaptSourceDocuments,normalizeEmission} from './mapping.js';
const observedAt='2026-11-13T12:00:00.000Z';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function* chunks(s:string){const b=Buffer.from(s);for(let n=0;n<b.length;n++)yield b.subarray(n,n+1);}
const csv=(source='che168')=>catalogColumns.join(',')+'\r\n'+catalogColumns.map(key=>'"'+(({source,id:'1001',make_zh:'中文 "品牌"\n名称'} as Record<string,string>)[key]??'').replace(/"/g,'""')+'"').join(',')+'\r\n';
const proof=(s:string)=>({expectedSha256:sha(s),expectedBytes:Buffer.byteLength(s),generatedAt:observedAt,downloadCompleted:true as const});
function document(payload:unknown,locale:SourceDocument['locale']='en',kind:SourceDocument['kind']='detail'):SourceDocument{return {identity:{provider:'chinacarapi',source:'che168',externalId:'1001'},kind,locale,observedAt,sourceUpdatedAt:observedAt,payload};}
function detail(id='1001'){return {source:'che168',id,status:'active',updatedAt:observedAt,url:`https://www.che168.com/dealer/1/${id}.html`,title:'Synthetic vehicle',make:{id:'1',name:'Example',nameZh:'示例'},model:{id:'2',name:'Model',nameZh:'车型'},trim:{id:'3',name:'Variant',nameZh:'配置'},modelYear:2022,fuel:'Petrol',specs:{displacementCc:1998,emissionStandard:'China VI',ev:{rangeKm:100}},image:'https://erscglobal2.autoimg.cn/photo/0.jpg',photos:Array.from({length:45},(_,i)=>`https://erscglobal2.autoimg.cn/photo/${i}.jpg`),equipment:[{items:Array.from({length:601},(_,i)=>({name:`Feature ${i}`,value:'Standard',nameZh:`配置${i}`,valueZh:'标配'}))}],unknownFuture:{private:true}};}
test('CSV stream validates full header, UTF8 chunks, quotes and multiline cells before complete',async()=>{
 const data=csv(),rows:Record<string,string>[]=[];const result=await verifyCatalogCsv(chunks(data),proof(data),row=>{rows.push(row);});
 assert.equal(result.rows,1);assert.equal(result.complete,true);assert.equal(rows[0]!.make_zh,'中文 "品牌"\n名称');
});
test('truncation, header drift, invalid source, digest mismatch and incomplete download fail closed',async()=>{
 const good=csv();for(const bad of [good.slice(0,-4),good.replace('source,id','source,unknown'),csv('unknown'),good.replace('1001','1002')])await assert.rejects(verifyCatalogCsv(chunks(bad),proof(good),()=>{}));
 await assert.rejects(verifyCatalogCsv(chunks(good),{...proof(good),downloadCompleted:false as true},()=>{}));
});
test('presence tracks null and sparse details retain duplicate relation and nested values',()=>{
 const merged=mergePresent({duplicate_of:'dongchedi:10',specs:{engineCc:1998,power:100},photos:[1,2]},{specs:{power:null},photos:[]});
 assert.deepEqual(JSON.parse(JSON.stringify(merged)),{duplicate_of:'dongchedi:10',specs:{engineCc:1998,power:null},photos:[]});
 assert.deepEqual(sourcePresence({specs:{power:null}}),['/specs','/specs/power']);
 assert.notEqual(sourceDocumentHash(document({a:null})),sourceDocumentHash(document({})));
 assert.throws(()=>sourceDocumentHash({...document({a:1}),rawText:'{"a":2}'}));
});
test('all photos and configuration survive 30/500 projection limits with supplier provenance',()=>{
 const mapped=adaptSourceDocuments([document(detail())],1,observedAt)!;
 assert.equal(mapped.candidate.facts.engineCc,1998);assert.equal(mapped.fullPhotos.length,45);assert.equal(mapped.candidate.images.length,30);
 assert.ok(mapped.fullConfiguration.en.length>600);assert.equal(mapped.fullConfiguration.en.at(-1)!.value.reviewed,false);assert.equal(mapped.fullConfiguration.en.at(-1)!.value.provenance,'supplier');
 assert.ok(!JSON.stringify(mapped).includes('unknownFuture'));assert.equal(normalizeEmission('国IV(国V)'),normalizeEmission('China IV (China V)'));
});
test('shared trim summary and sections enrich a matching vehicle and reject mismatched trim',()=>{
 const sheet={trimId:3,summary:{displacementCc:2500},sections:[{name:'Body',items:[{id:42,name:'Length',value:'5000 mm'}]}]};
 const mapped=adaptSourceDocuments([document(detail()),document(sheet,'en','specs')],2,observedAt)!;
 assert.equal(mapped.candidate.facts.engineCc,2500);assert.ok(mapped.fullConfiguration.en.some(i=>i.id==='sheet.0.42'));
 assert.throws(()=>adaptSourceDocuments([document(detail()),document({...sheet,trimId:4},'en','specs')],3,observedAt));
});
test('known disputed year, range and title fragments stay out while other records continue',()=>{
 const value=document(detail('60461832'));value.identity.externalId='60461832';const mapped=adaptSourceDocuments([value],1,observedAt)!;
 assert.equal(mapped.candidate.facts.modelYear,null);assert.equal(mapped.candidate.facts.trim,null);assert.equal(mapped.candidate.copy.description,null);
 assert.ok(!mapped.candidate.copy.title?.original.text.includes('2022'));assert.equal(mapped.fullConfiguration.en.length,0);assert.equal(mapped.fullConfiguration.zh.length,0);assert.equal(mapped.fullConfiguration.ru.length,0);
 assert.equal(adaptSourceDocuments([document(detail())],1,observedAt)!.candidate.facts.modelYear,2022);
});
test('CSV alone cannot publish and absent bulk duplicate field cannot clear CSV relation',()=>{
 const input=document({source:'che168',id:'1001',duplicate_of:'dongchedi:1002'},'und','csv');assert.equal(adaptSourceDocuments([input],1,observedAt),null);
 assert.equal(adaptSourceDocuments([input,document(detail())],1,observedAt)!.duplicateOf,'dongchedi:1002');
});

test('report without optional source uses the verified envelope, but an explicit mismatch is rejected',()=>{
 const report={id:'1001',summary:[{area:'Body',result:'No damage'}]};
 const mapped=adaptSourceDocuments([document(detail()),document(report,'en','report')],1,observedAt)!;
 assert.equal(mapped.candidate.inspection?.hasReport,true);assert.ok(mapped.candidate.inspection!.entries.length>0);
 assert.throws(()=>adaptSourceDocuments([document(detail()),document({...report,source:'dongchedi'},'en','report')],1,observedAt));
});

test('localized configuration cannot mix a different identity, trim or factual version; missing translation stays missing',()=>{
 const original=detail(),ru={...detail(),equipment:[{items:[{name:'Особенность',value:'Стандарт'}]}]};
 const matching=adaptSourceDocuments([document(original),document(ru,'ru')],1,observedAt)!;
 assert.equal(matching.fullConfiguration.ru.at(-1)!.value.contentLocale,'ru');
 for(const bad of [{...ru,trim:{...ru.trim,id:'99'}},{...ru,modelYear:2023}]){
  const value=adaptSourceDocuments([document(original),document(bad,'ru')],1,observedAt)!;
  assert.equal(value.fullConfiguration.ru.at(-1)!.value.status,'missing');
 }
 assert.throws(()=>adaptSourceDocuments([document(original),document({...ru,id:'999'},'ru')],1,observedAt));
 assert.equal(adaptSourceDocuments([document(original)],1,observedAt)!.fullConfiguration.ru.at(-1)!.value.status,'missing');
});

test('a locale-only trim sheet cannot mutate later locale projections',()=>{
 const sheet={trimId:3,equipment:[{items:[{name:'中文配置',value:'标配'}]}]};
 const result=adaptSourceDocuments([document(detail()),document(sheet,'zh','specs')],1,observedAt)!;
 assert.equal(result.fullConfiguration.zh.at(-1)!.value.contentLocale,'zh');
 assert.equal(result.fullConfiguration.en.at(-1)!.value.text,'Standard');
});

test('same-version CSV and detail seat counts stay unknown across all public projections without changing evidence',()=>{
 const id='357241284',version='2026-11-10T15:23:08.070Z';
 const row={...detail(id),source:'dongchedi',updatedAt:version,seats:7,specs:{...detail().specs,seats:7}};
 const makeDocument=(payload:unknown,locale:SourceDocument['locale']='en',kind:SourceDocument['kind']='detail'):SourceDocument=>({...document(payload,locale,kind),identity:{provider:'chinacarapi',source:'dongchedi',externalId:id}});
 const docs=[makeDocument({source:'dongchedi',id,seats:'714',detail_fetched_at:'2026-11-10T23:23:08.070+08:00'},'und','csv'),
   ...(['zh','en','ru'] as const).map(locale=>makeDocument(row,locale)),
   makeDocument({trimId:3,summary:{seats:7},sections:[{items:[{name:'Number of seats',value:'7'},{name:'Doors',value:'4'}]}]},'en','specs')];
 const before=docs.map(sourceDocumentHash);const mapped=adaptSourceDocuments(docs,1,observedAt)!;
 assert.ok(!mapped.candidate.specifications.some(item=>item.name.text==='seats'));
 for(const locale of ['zh','en','ru'] as const)assert.equal(mapped.fullConfiguration[locale].find(item=>item.id==='specs.seats')!.value.status,'missing');
 assert.equal(mapped.fullConfiguration.en.find(item=>item.id==='sheet.0.0')!.value.status,'missing');
 assert.equal(mapped.fullConfiguration.en.find(item=>item.id==='sheet.0.1')!.value.text,'4');
 assert.deepEqual(docs.map(sourceDocumentHash),before);
 const newer=adaptSourceDocuments([docs[0]!,makeDocument({...row,updatedAt:observedAt})],2,observedAt)!;
 assert.equal(newer.fullConfiguration.en.find(item=>item.id==='specs.seats')!.value.text,'7');
});

test('engine and system horsepower remain separate supplier fields without inferred conversion or conflict',()=>{
 const row={...detail(),source:'dongchedi',fuel:'Plug-in hybrid',powerHp:252,powerKw:280,
  specs:{displacementCc:1998,powerHp:381,powerKw:280,engineKw:185,motorKw:100,systemKw:280}};
 const doc={...document(row),identity:{provider:'chinacarapi' as const,source:'dongchedi' as const,externalId:'1001'}};
 const mapped=adaptSourceDocuments([doc],1,observedAt)!;
 assert.equal(mapped.candidate.facts.powerKw,280);assert.deepEqual(mapped.candidate.disputes,[]);
 for(const [key,value] of Object.entries({powerHp:'381',engineKw:'185',motorKw:'100',systemKw:'280'}))assert.equal(mapped.fullConfiguration.en.find(item=>item.id===`specs.${key}`)!.value.text,value);
 assert.equal((doc.payload as typeof row).powerHp,252);assert.equal((doc.payload as typeof row).specs.powerHp,381);
});

test('a newer detail price replaces the older CSV quote without an identity dispute',()=>{
 const id='60194350',doc=document({...detail(id),updatedAt:'2026-11-13T10:22:50.420Z',price:{cny:63800}});doc.identity.externalId=id;
 const snapshot={...document({source:'che168',id,price_cny:'65600',detail_fetched_at:'2026-11-10T10:10:50.090Z'},'und','csv'),identity:doc.identity};
 const mapped=adaptSourceDocuments([snapshot,doc],1,observedAt)!;
 assert.equal(mapped.candidate.price?.cny,'63800');assert.equal(mapped.candidate.sourceUpdatedAt,'2026-11-13T10:22:50.420Z');
 assert.deepEqual(mapped.candidate.disputes,[]);assert.equal((snapshot.payload as {price_cny:string}).price_cny,'65600');
});
