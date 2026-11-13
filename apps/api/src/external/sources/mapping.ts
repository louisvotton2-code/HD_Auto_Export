import type { ExternalUpsertCandidate } from '@hd/contracts/admin';
import type { DisplayText, Locale } from '@hd/contracts/public';
import { adaptChinaCarSample } from '../china-car-sample.js';
import { chinaCarSampleProfile, knownPhotoExpiry, publicLink } from '../profiles.js';
import { displayText, isPublicText, jsonHash, sha256 } from '../normalize.js';
import { mergePresent, type SourceDocument } from './documents.js';

export type SourceConfigurationItem={id:string;name:DisplayText;value:DisplayText};
export type FullSourceProjection={candidate:ExternalUpsertCandidate;fullPhotos:ExternalUpsertCandidate['images'];fullConfiguration:Record<Locale,SourceConfigurationItem[]>;duplicateOf:string|null;rejectedPhotos:number};
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):ObjectValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:{};
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const text=(value:unknown)=>typeof value==='string'?value:null;
const number=(value:unknown)=>typeof value==='string'&&value!==''&&/^\d+(\.\d+)?$/.test(value)?Number(value):typeof value==='number'?value:null;
export const normalizeEmission=(value:unknown)=>typeof value==='string'?value.replace(/国\s*(VI|IV|V|III|II|I|6|5|4|3|2|1)/g,(_,v:string)=>`China ${{'1':'I','2':'II','3':'III','4':'IV','5':'V','6':'VI'}[v]??v}`).replace(/\s+/g,'').toLowerCase():null;
const energy:Record<string,string>={'汽油':'Petrol','柴油':'Diesel','纯电动':'Electric','纯电':'Electric','插电式混合动力':'Plug-in Hybrid','插电混动':'Plug-in Hybrid','油电混合':'Hybrid','增程式':'Range Extender','Бензин':'Petrol','Дизель':'Diesel','Электро':'Electric','Электрический':'Electric','Гибрид':'Hybrid'};
/** Only known categorical values normalize; translated label differences never become invented facts. */
function normalizedDetail(input:ObjectValue):ObjectValue{
  const row=structuredClone(input),specs=object(row.specs);
  row.fuel=energy[String(row.fuel)]??row.fuel;
  specs.energyType=energy[String(specs.energyType)]??specs.energyType;row.specs=specs;
  row.transmission=({'自动':'Automatic','手动':'Manual','Автоматическая':'Automatic','Механическая':'Manual'} as Record<string,string>)[String(row.transmission)]??row.transmission;
  return row;
}
function csvDetail(csv:ObjectValue):ObjectValue{
  // Empty CSV values are explicitly present, unlike a missing bulk property.
  return {source:csv.source,id:csv.id,status:'active',url:csv.url,title:[csv.make_zh||csv.make,csv.model_zh||csv.model,csv.trim_zh||csv.trim].filter(Boolean).join(' '),
    modelYear:number(csv.model_year),firstRegistration:csv.first_registration||null,manufactureDate:csv.manufacture_date||null,
    mileageKm:number(csv.mileage_km),price:{cny:number(csv.price_cny)},sellerPrice:{cny:number(csv.seller_price_cny)},
    fuel:csv.fuel,transmission:csv.transmission,city:csv.city,powerKw:number(csv.power_kw),drivetrain:csv.drivetrain,
    updatedAt:csv.detail_fetched_at||null,hasInspectionReport:csv.has_report==='true'||csv.has_report==='1',
    specs:{displacementCc:number(csv.displacement_cc),emissionStandard:csv.emission_standard,doors:number(csv.doors),seats:number(csv.seats)},
    duplicate_of:csv.duplicate_of||null,manufactureDateSource:csv.manufacture_date_source,
    manufactureDateRange:{earliest:csv.manufacture_earliest||null,latest:csv.manufacture_latest||null}};
}
function seatsConflict(csv:ObjectValue,detail:ObjectValue){
  const top=number(detail.seats),spec=number(object(detail.specs).seats),snapshot=number(csv.seats);
  if(top!==null&&spec!==null&&top!==spec)return true;
  // Observation time is not a source version. A newer detail may legitimately replace an older CSV value.
  const csvVersion=Date.parse(String(csv.detail_fetched_at)),detailVersion=Date.parse(String(detail.updatedAt));
  return Number.isFinite(csvVersion)&&csvVersion===detailVersion&&snapshot!==null&&
    [top,spec].some(value=>value!==null&&value!==snapshot);
}
function suppressSeats(row:ObjectValue){
  row.seats=null;object(row.specs).seats=null;
  // The same disputed count may also appear in a localized supplier configuration sheet.
  const countLabel=/^(?:seats?|number of seats|seat(?:ing)? capacity|座位数(?:\(个\)|（个）)?|座位数量|座椅数|количество мест|число мест)$/i;
  for(const key of ['specSections','equipment'])if(row[key]!==undefined)row[key]=structuredClone(row[key]);
  for(const group of [...array(row.specSections),...array(row.equipment)])for(const value of array(object(group).items)){
    const item=object(value);
    if([item.name,item.nameZh].some(name=>typeof name==='string'&&countLabel.test(name.trim()))){item.value=null;item.valueZh=null;}
  }
}
function fieldDisplay(value:unknown,locale:Locale):DisplayText{
  const result=typeof value==='number'||typeof value==='boolean'?String(value):text(value);
  if(!result||result.length>500||!isPublicText(result))return displayText(locale,null);
  const neutral=/^[\d\s.,+\-/%]+(?:(?:mm|cm|m|kg|kW|hp|Nm|kWh|km|L|s|h|V|A|°C)(?:\/\d+(?:km|h))?)?$/.test(result);
  const contentLocale=neutral?'und':/\p{Script=Han}/u.test(result)?'zh':/\p{Script=Cyrillic}/u.test(result)?'ru':/[A-Za-z]/.test(result)?'en':'und';
  if(contentLocale!=='und'&&contentLocale!==locale)return displayText(locale,null);
  return displayText(locale,{text:result,contentLocale},'supplier');
}
const specKeys=['displacementCc','powerKw','powerHp','torqueNm','engineKw','motorKw','systemKw','energyType','emissionStandard','cylinders','transmissionType','gears','driveType','bodyType','doors','seats','lengthMm','widthMm','heightMm','wheelbaseMm','curbWeightKg','grossWeightKg','fuelTankL','trunkL','topSpeedKmh','acceleration0to100S','fuelConsumptionL100km','launchDate','warranty'];
const evKeys=['batteryKwh','batteryType','batteryWarranty','consumptionKwh100km','fastChargeHours','motorLayout','motorPowerKw','motorTorqueNm','motorType','motors','rangeKm','slowChargeHours'];
function configuration(row:ObjectValue,locale:Locale,disputed:boolean):SourceConfigurationItem[]{
  // The unresolved trim/year affects the whole supplier specification sheet; retain it privately until reviewed.
  if(disputed)return [];
  const result:SourceConfigurationItem[]=[];
  const add=(id:string,name:unknown,value:unknown)=>{result.push({id,name:fieldDisplay(name,locale),value:fieldDisplay(value,locale)});};
  const specs=object(row.specs);
  for(const [section,group] of array(row.specSections).entries())for(const [position,value] of array(object(group).items).entries()){const item=object(value);if(disputed&&/续航|range|запас хода|年款|model year/i.test(String(item.name)))continue;add(`sheet.${section}.${String(item.id??position)}`,item.name,item.value);}
  for(const key of specKeys)if(Object.hasOwn(specs,key))add(`specs.${key}`,key,specs[key]);
  for(const key of evKeys)if(Object.hasOwn(object(specs.ev),key)&&(!disputed||key!=='rangeKm'))add(`specs.ev.${key}`,key,object(specs.ev)[key]);
  for(const [section,group] of array(row.equipment).entries())for(const [position,value] of array(object(group).items).entries()){
    const item=object(value);const name=locale==='zh'?item.nameZh??item.name:item.name;
    if(disputed&&/续航|range|запас хода|年款|model year/i.test(String(name)))continue;
    add(`equipment.${section}.${position}`,name,locale==='zh'?item.valueZh??item.value:item.value);
  }return result;
}
function allPhotos(row:ObjectValue){
  const map=new Map<string,ExternalUpsertCandidate['images'][number]>();let rejected=0;
  for(const input of [row.image,...array(row.photos)]){
    if(input===undefined||input===null)continue;
    const url=publicLink(text(input),'media',chinaCarSampleProfile);if(!url){rejected++;continue;}
    const parsed=new URL(url),cdn=parsed.hostname.endsWith('.byteimg.com')?'dongchedi':'che168';
    const sourceMediaId=sha256(`${cdn}:${cdn==='dongchedi'?parsed.pathname.split('~')[0]:parsed.pathname}`),expiresAt=knownPhotoExpiry(parsed);
    const previous=map.get(sourceMediaId);
    if(!previous||(expiresAt?Date.parse(expiresAt):Infinity)>(previous.expiresAt?Date.parse(previous.expiresAt):Infinity))map.set(sourceMediaId,{sourceMediaId,url,width:null,height:null,alt:null,expiresAt});
  }return {items:[...map.values()],rejected};
}
/** Project only documented public fields. All supplier documents, including omitted/unsafe fields, remain in the private evidence store. */
export function adaptSourceDocuments(documents:SourceDocument[],revision:number,observedAt:string):FullSourceProjection|null{
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('A monotonic source revision is required.');
  const identity=documents[0]?.identity;if(!identity)return null;
  if(documents.some(d=>jsonHash(d.identity)!==jsonHash(identity)))throw new Error('Source identity changed within one projection.');
  for(const d of documents)if(d.kind==='detail'){const value=object(d.payload);if(value.source!==undefined&&value.source!==identity.source||value.id!==undefined&&String(value.id)!==identity.externalId)throw new Error('Detail source identity differs.');}
  const latest=(kind:SourceDocument['kind'],locale?:SourceDocument['locale'])=>documents.filter(d=>d.kind===kind&&(locale===undefined||d.locale===locale)).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
  const csv=object(latest('csv')?.payload),detail=latest('detail','en')??latest('detail','zh')??latest('detail');
  if(!detail)return null; // A CSV row alone is never a complete vehicle publication.
  const detailRow=object(detail.payload),unknownSeats=seatsConflict(csv,detailRow);
  const base=normalizedDetail(object(mergePresent(csvDetail(csv),detailRow)));
  if(String(base.source)!==identity.source||String(base.id)!==identity.externalId)return null;
  const specsDoc=latest('specs',detail.locale)??latest('specs');
  if(specsDoc){const payload=object(specsDoc.payload);if(payload.trimId!==undefined&&String(payload.trimId)!==String(object(base.trim).id))throw new Error('Shared trim identity differs.');base.specs=mergePresent(base.specs,payload.summary??payload.specs??payload);if(payload.equipment!==undefined)base.equipment=payload.equipment;base.specSections=payload.sections;}
  if(unknownSeats)suppressSeats(base);
  const captures:Partial<Record<Locale,ObjectValue>>={};
  for(const locale of ['zh','en','ru'] as const){const found=latest('detail',locale);if(found)captures[locale]=normalizedDetail(object(found.payload));}
  const disputed=identity.source==='che168'&&identity.externalId==='60461832';
  const evidence=disputed?[{field:'titleAndModelYear'},{field:'structuredRangeKm'}]:[];
  const report=object(latest('report')?.payload);
  if(report.id!==undefined&&String(report.id)!==identity.externalId||report.source!==undefined&&report.source!==identity.source)throw new Error('Report source identity differs.');
  // The optional supplier source field may be absent; the verified request envelope binds the platform.
  const boundReport=report.id===undefined?undefined:{...report,source:report.source??identity.source};
  const candidate=adaptChinaCarSample(base,observedAt,captures,evidence,boundReport);
  if(!candidate)return null;candidate.revision=revision;
  if(disputed){candidate.facts.modelYear=null;candidate.facts.trim=null;
    const make=object(base.make),model=object(base.model);
    const safeName=[make.nameZh??make.name,model.nameZh??model.name].filter(v=>typeof v==='string'&&isPublicText(v)).join(' ');
    candidate.copy.title=safeName?{original:{text:safeName,contentLocale:/\p{Script=Han}/u.test(safeName)?'zh':'en'},translations:{}}:null;
    candidate.copy.description=null;candidate.specifications=[];
  }
  const photos=allPhotos(base);
  const fullConfiguration={} as Record<Locale,SourceConfigurationItem[]>;
  for(const locale of ['zh','en','ru'] as const){const localized=captures[locale];const matching=localized&&matchingFacts(base,localized);
    const localizedRow=matching?object(mergePresent(base,localized)):structuredClone(base);const localizedSpecs=latest('specs',locale);if(localizedSpecs){const sheet=object(localizedSpecs.payload);if(sheet.trimId!==undefined&&String(sheet.trimId)!==String(object(base.trim).id))throw new Error('Shared trim identity differs.');localizedRow.specs=mergePresent(localizedRow.specs,sheet.summary??sheet.specs??sheet);if(sheet.equipment!==undefined)localizedRow.equipment=sheet.equipment;localizedRow.specSections=sheet.sections;}if(unknownSeats)suppressSeats(localizedRow);fullConfiguration[locale]=configuration(localizedRow,locale,disputed);}
  candidate.images=photos.items.slice(0,30);
  return {candidate,fullPhotos:photos.items,fullConfiguration,duplicateOf:text(csv.duplicate_of)??text(base.duplicate_of),rejectedPhotos:photos.rejected};
}

function matchingFacts(base:ObjectValue,localized:ObjectValue){
 const signature=(row:ObjectValue)=>{
  const specs=object(row.specs),ev=object(specs.ev);
  return [row.source,row.id,row.updatedAt,row.status,object(row.make).id,object(row.model).id,object(row.trim).id,row.modelYear,row.firstRegistration,row.manufactureDate,row.mileageKm,object(row.price).cny,row.fuel,row.transmission,row.powerKw,specs.displacementCc,specs.powerKw,specs.energyType,ev.rangeKm,ev.batteryKwh];
 };return jsonHash(signature(base))===jsonHash(signature(localized));
}
