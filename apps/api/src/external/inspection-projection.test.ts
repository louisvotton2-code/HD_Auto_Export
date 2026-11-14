import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicInspectionSummarySchema,PublicInspectionEntrySchema} from '@hd/contracts/public';
import {selectInspection,projectInspectionReport} from './sources/inspection-projection.js';
import type {SourceDocument} from './sources/documents.js';

const identity={provider:'chinacarapi' as const,source:'che168' as const,externalId:'900008'};
const report={id:identity.externalId,source:identity.source,hasReport:false,
 counts:[{category:'Accident items',checked:40,faults:1},{category:'Flood items',checked:36,faults:0},{category:'Fire items',checked:19,faults:0}],
 summary:[{area:'Summary',result:'One checked part requires attention',textZh:'不用于中文站正文的额外文字'}],
 checks:[{category:'Major accident check',groups:[{name:'Body',items:[{part:'Door',result:'Repaired',ok:false},{part:'Hood',result:'Original',ok:true},{part:'Roof',result:null,ok:null}]}]}],
 defects:[{category:'Major accident check',items:[{group:'Body',part:'Door',finding:'Repaired',details:[{text:'Paint repair',textZh:'不主动补译'}]}]}],
 reportUrl:'https://private.invalid/report',seller:{phone:'PRIVATE_MARKER'},photos:['https://private.invalid/photo'],unknown:'PRIVATE_MARKER',ev:null};
const doc=(payload:unknown,locale:SourceDocument['locale']='en'):SourceDocument=>({identity,kind:'report',locale,observedAt:'2026-11-14T00:00:00.000Z',sourceUpdatedAt:null,payload});

test('inspection summaries use complete explicit counts, keep zero/unknown distinct and separate history from findings',()=>{
 for(const locale of ['zh','en','ru'] as const){
  const p=selectInspection([doc(report)],identity,{hasInspectionReport:false},locale);
  assert.equal(p.status,'available','Real bound report overrides contradictory presence flags');
  assert.equal(p.summary.contentLocale,'en');assert.equal(p.summary.checked,95);assert.equal(p.summary.faults,1);
  assert.deepEqual(p.summary.categories.map(c=>[c.id,c.checked,c.faults,c.outcome]),[['accident',40,1,'defect'],['flood',36,0,'ok'],['fire',19,0,'ok']]);
  for(const c of p.summary.categories)assert.equal(c.label.contentLocale,locale);
  const defect=p.items.find(i=>i.id==='check.0.0.0')!;
  assert.equal(defect.categoryId,'accident');assert.equal(defect.group?.text,'Body');assert.ok(defect.partId);assert.equal(defect.value.requestedLocale,locale);assert.equal(defect.value.contentLocale,'en');assert.equal(defect.value.reviewed,false);
  assert.equal(p.items.find(i=>i.id==='check.0.0.2')!.value.status,'missing');
  assert.ok(p.items.filter(i=>i.outcome==='defect').length>p.summary.faults!,'Expanded findings do not multiply faults');
  PublicInspectionSummarySchema.parse(p.summary);p.items.forEach(i=>PublicInspectionEntrySchema.parse(i));
  assert.doesNotMatch(JSON.stringify(p),/private\.invalid|PRIVATE_MARKER|textZh|ownershipTransfers|accidentCount|不主动补译|不用于/);
 }
 const unknown=projectInspectionReport({checks:report.checks},'en');
 assert.equal(unknown.summary.checked,null);assert.equal(unknown.summary.faults,null);assert.equal(unknown.summary.categories[0]!.outcome,'unknown');
 const invalid=projectInspectionReport({...report,counts:[{category:'Accident items',checked:0,faults:2}]},'en');
 assert.equal(invalid.summary.categories[0]!.faults,null);
});

test('report language follows ru/en/original policy without fabricating a Chinese body',()=>{
 const russian={id:identity.externalId,summary:[{area:'Итог',result:'Повреждений не обнаружено'}]};
 const chinese={id:identity.externalId,summary:[{area:'结论',result:'已有原始中文内容'}]};
 const documents=[doc(report),doc(russian,'ru'),doc(chinese,'zh')];
 assert.equal(selectInspection(documents,identity,{},'ru').summary.contentLocale,'ru');
 for(const locale of ['zh','en'] as const){const p=selectInspection(documents,identity,{},locale);assert.equal(p.summary.contentLocale,'en');assert.equal(p.conclusions[0]!.value.text,report.summary[0]!.result);}
 assert.equal(selectInspection([doc(chinese,'zh')],identity,{},'ru').summary.contentLocale,'zh');
 assert.equal(selectInspection([doc({id:identity.externalId,summary:[{area:'结论',result:null,textZh:'保留唯一已有原文'}]},'zh')],identity,{},'en').conclusions[0]!.value.contentLocale,'zh');
 assert.equal(selectInspection([doc({...russian,available:false},'ru'),doc(report)],identity,{},'ru').summary.contentLocale,'en');
});

test('missing, pending, explicit absence, unavailable and mismatched evidence never become an available report',()=>{
 assert.equal(selectInspection([],identity,{},'en').status,'unknown');
 assert.equal(selectInspection([],identity,{hasInspectionReport:false},'en').status,'no_report');
 assert.equal(selectInspection([],identity,{hasInspectionReport:false,inspectionAvailable:true},'en').status,'pending');
 assert.equal(selectInspection([doc({...report,available:false})],identity,{},'en').status,'unavailable');
 assert.equal(selectInspection([doc({id:identity.externalId,hasReport:false})],identity,{},'en').status,'no_report');
 assert.equal(selectInspection([doc({...report,id:'900009'})],identity,{},'en').status,'unknown');
 assert.equal(selectInspection([doc({id:identity.externalId,checks:[],counts:[],summary:[],defects:[]})],identity,{},'en').status,'unavailable');
 const unsafe=projectInspectionReport({checks:[{category:'https://private.invalid',groups:[{name:'Contact: +12345678901',items:[{part:'Door',result:'OK',ok:true}]}]}]},'en');
 assert.equal(unsafe.status,'unavailable');assert.equal(unsafe.items.length,0);
});
