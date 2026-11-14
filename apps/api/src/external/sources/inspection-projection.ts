import type {DisplayText,Locale,PublicInspectionEntry,PublicInspectionSummary} from '@hd/contracts/public';
import {displayText,jsonHash} from '../normalize.js';
import {sourceDisplay} from './display.js';
import type {SourceDocument,SourceIdentity} from './documents.js';

type Obj=Record<string,unknown>;
const obj=(value:unknown):Obj=>value&&typeof value==='object'&&!Array.isArray(value)?value as Obj:{};
const arr=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
type Conclusion={id:string;name:DisplayText;value:DisplayText};
export type InspectionProjection={status:PublicInspectionSummary['status'];items:PublicInspectionEntry[];summary:PublicInspectionSummary;conclusions:Conclusion[]};
export const emptyInspectionSummary=(status:PublicInspectionSummary['status']='unknown'):PublicInspectionSummary=>({status,contentLocale:null,checked:null,faults:null,categories:[]});
const normalize=(text:string)=>text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const aliases:Record<string,string>={
 'accident items':'accident','major accident check':'accident','accident check':'accident','事故项':'accident','重大事故排查':'accident','事故检测':'accident','проверка на серьезные аварии':'accident','проверка на серьёзные аварии':'accident',
 'flood items':'flood','flood damage check':'flood','flood check':'flood','泡水项':'flood','泡水排查':'flood','水泡检测':'flood','проверка на затопление':'flood',
 'fire items':'fire','fire damage check':'fire','fire check':'fire','火烧项':'fire','火烧排查':'fire','火烧检测':'fire','проверка на пожар':'fire',
};
const labels:Record<string,Record<Locale,string>>={accident:{zh:'事故损伤检测',en:'Accident damage inspection',ru:'Проверка повреждений при ДТП'},flood:{zh:'泡水检测',en:'Flood damage inspection',ru:'Проверка следов затопления'},fire:{zh:'火烧检测',en:'Fire damage inspection',ru:'Проверка следов пожара'}};
const key=(prefix:string,text:string)=>`${prefix}.${jsonHash(normalize(text)).slice(0,32)}`;
const categoryKey=(text:string)=>aliases[normalize(text)]??key('category',text);
const outcome=(checked:number|null,faults:number|null):PublicInspectionEntry['outcome']=>faults!==null&&faults>0?'defect':faults===0&&checked!==null&&checked>0?'ok':'unknown';

/** Only known text/count leaves are public. Full statistics never depend on pagination or expanded defect rows. */
export function projectInspectionReport(report:Obj,locale:Locale):InspectionProjection{
 const items:PublicInspectionEntry[]=[],conclusions:Conclusion[]=[];
 const categories=new Map<string,PublicInspectionSummary['categories'][number]>();
 const category=(raw:unknown)=>{
  const source=sourceDisplay(raw,locale);if(source.status!=='ready')return null;
  const id=categoryKey(source.text);
  if(!categories.has(id))categories.set(id,{id,label:labels[id]?displayText(locale,{text:labels[id]![locale],contentLocale:locale},'catalog'):source,checked:null,faults:null,outcome:'unknown'});
  return categories.get(id)!;
 };
 const seenCounts=new Set<string>();
 for(const raw of arr(report.counts)){
  const value=obj(raw),c=category(value.category);if(!c)continue;
  const checked=count(value.checked),rawFaults=count(value.faults),faults=checked!==null&&rawFaults!==null&&rawFaults>checked?null:rawFaults;
  if(seenCounts.has(c.id)){if(c.checked!==checked)c.checked=null;if(c.faults!==faults)c.faults=null;}
  else {c.checked=checked;c.faults=faults;seenCounts.add(c.id);}
 }
 const add=(id:string,kind:NonNullable<PublicInspectionEntry['kind']>,rawCategory:unknown,rawPart:unknown,name:unknown,value:unknown,result:PublicInspectionEntry['outcome'])=>{
  const n=sourceDisplay(name,locale);if(n.status!=='ready')return;
  const c=category(rawCategory),p=sourceDisplay(rawPart,locale),v=sourceDisplay(value,locale);
  items.push({id,kind,categoryId:c?.id??null,category:c?.label??null,partId:p.status==='ready'?key('part',p.text):null,part:p.status==='ready'?p:null,
   groupId:kind==='summary'?null:key('group',`${c?.id??''}:${n.text}`),group:kind==='summary'?null:n,name:n,value:v,outcome:result});
 };
 for(const [i,raw] of arr(report.summary).entries()){
  const row=obj(raw),body=row.result??row.textZh,name=sourceDisplay(row.area,locale),value=sourceDisplay(body,locale);
  if(name.status==='ready'&&value.status==='ready'){
   if(conclusions.length<30)conclusions.push({id:`summary.${i}`,name,value});
   add(`summary.${i}`,'summary',null,row.area,row.area,body,'unknown');
  }
 }
 for(const [i,raw] of arr(report.checks).entries()){
  const c=obj(raw);category(c.category);
  for(const [j,rawGroup] of arr(c.groups).entries()){
   const g=obj(rawGroup);
   for(const [k,rawItem] of arr(g.items).entries()){
    const item=obj(rawItem);add(`check.${i}.${j}.${k}`,'check',c.category,item.part,g.name??item.part,item.result,item.ok===true?'ok':item.ok===false?'defect':'unknown');
   }
  }
 }
 for(const [i,raw] of arr(report.defects).entries()){
  const c=obj(raw);category(c.category);
  for(const [j,rawItem] of arr(c.items).entries()){
   const item=obj(rawItem);add(`defect.${i}.${j}`,'defect',c.category,item.part,item.group??item.part,item.finding,'defect');
   for(const [k,rawDetail] of arr(item.details).entries()){
    const d=obj(rawDetail);add(`defect.${i}.${j}.${k}`,'defect',c.category,item.part,item.group??item.part,d.text??d.textZh,'defect');
   }
  }
 }
 for(const c of categories.values())c.outcome=outcome(c.checked,c.faults);
 const all=[...categories.values()];
 const total=(field:'checked'|'faults')=>{
  if(!all.length||all.length>30||all.some(c=>c[field]===null))return null;
  const n=all.reduce((sum,c)=>sum+c[field]!,0);return Number.isSafeInteger(n)?n:null;
 };
 const languages=new Set(items.flatMap(i=>[i.name,i.value]).filter(t=>t.status==='ready'&&t.contentLocale!=='und').map(t=>t.contentLocale));
 const usable=items.length>0||all.some(c=>c.checked!==null||c.faults!==null);
 // Explicit unavailable observations can carry stale merged arrays. A hasReport flag cannot erase real current content.
 const status:PublicInspectionSummary['status']=report.available===false?'unavailable':usable?'available':report.hasReport===false?'no_report':'unavailable';
 if(status!=='available')return {status,items:[],conclusions:[],summary:emptyInspectionSummary(status)};
 return {status,items,conclusions,summary:{status,contentLocale:languages.size===1?[...languages][0]!:null,checked:total('checked'),faults:total('faults'),categories:all.slice(0,30)}};
}

export function selectInspection(documents:SourceDocument[],identity:SourceIdentity,base:Obj,locale:Locale):InspectionProjection{
 const newest=new Map<string,SourceDocument>();
 for(const d of documents.filter(d=>d.kind==='report').sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))){
  const r=obj(d.payload);
  if(d.identity.provider!==identity.provider||d.identity.source!==identity.source||d.identity.externalId!==identity.externalId||String(r.id)!==identity.externalId||r.source!==undefined&&r.source!==identity.source)continue;
  if(!newest.has(d.locale))newest.set(d.locale,d);
 }
 const preference=locale==='ru'?['ru','en','und','zh']:['en','und','ru','zh'];
 const reports=[...newest.values()].sort((a,b)=>preference.indexOf(a.locale)-preference.indexOf(b.locale)).map(d=>projectInspectionReport(obj(d.payload),locale));
 const selected=reports.find(r=>r.status==='available')??reports[0];if(selected)return selected;
 const status=base.hasInspectionReport===true||base.inspectionAvailable===true||base.hasReport===true?'pending':base.hasInspectionReport===false||base.hasReport===false?'no_report':'unknown';
 return {status,items:[],conclusions:[],summary:emptyInspectionSummary(status)};
}
