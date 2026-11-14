import type {PoolClient} from 'pg';
import {PartialDateSchema,TimestampSchema,MoneySchema,PublicInspectionSummarySchema,type PublicVehicleInspectionQuery,type PublicInspectionEntry,type DisplayText,type Locale,type PartialDate,type Money} from '@hd/contracts/public';
import {jsonHash} from '../normalize.js';
import {sourceDisplay} from './display.js';
import type {SourceDocument} from './documents.js';
import {selectInspection,emptyInspectionSummary,type InspectionProjection} from './inspection-projection.js';
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const locales=['zh','en','ru'] as const;
const missing=(locale:Locale)=>sourceDisplay(null,locale);
const date=(v:unknown):PartialDate|null=>{if(typeof v!=='string')return null;const parsed=PartialDateSchema.safeParse({value:v,precision:{4:'year',7:'month',10:'day'}[v.length]});return parsed.success?parsed.data:null;};
const stamp=(v:unknown)=>{const parsed=TimestampSchema.safeParse(v);return parsed.success?new Date(parsed.data).toISOString():null;};
export type InspectionItem=PublicInspectionEntry;
export type HistoryItem={id:string;at:string|null;money:Money;kind:'asking'|'seller'|'unknown'};
export type EvidenceKind='inspection'|'price-history';
type Status=InspectionProjection['status'];
export type VehicleExtras={identifiers:{sourceId:string|null;source:string|null;inquiryCode:string;vin:string|null};manufacture:{date:PartialDate|null;range:{earliest:PartialDate;latest:PartialDate}|null;source:string|null;basis:DisplayText|null};vehicleClass:DisplayText|null;exportStatus:'eligible'|'restricted'|'unknown';powerHp:number|null;names:{make:DisplayText;model:DisplayText;trim:DisplayText}};
export type VehicleEvidenceProjection=Record<Locale,{extras:VehicleExtras;inspection:InspectionProjection;history:HistoryItem[]}>;
export function validVin(value:unknown):string|null{return typeof value==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/.test(value)&&!/^([A-Z0-9])\1{16}$/.test(value)?value:null;}
function versionMatches(base:Obj,local:Obj){return base.id===local.id&&base.source===local.source&&stamp(base.updatedAt)!==null&&stamp(base.updatedAt)===stamp(local.updatedAt)&&jsonHash([base.modelYear,obj(base.make).id,obj(base.model).id,obj(base.trim).id,obj(base.price).cny])===jsonHash([local.modelYear,obj(local.make).id,obj(local.model).id,obj(local.trim).id,obj(local.price).cny]);}
function history(row:Obj):HistoryItem[]{
 const result:HistoryItem[]=[];
 for(const [i,raw] of arr(row.priceHistory).entries()){const entry=obj(raw),price=obj(entry.price);
  // Supplier USD/EUR fields can be derived. Only explicit original money or the documented CNY asking price is public.
  const parsed=MoneySchema.safeParse(price.currency!==undefined?{currency:price.currency,amount:String(price.amount)}:{currency:'CNY',amount:String(price.cny)});
  if(parsed.success)result.push({id:`asking.${i}`,at:stamp(entry.observedAt),money:parsed.data,kind:'asking'});
 }return result;
}
const sourceCodes=new Set(['listing','nameplatePhoto','supplier','manufacturer','registration']);
const bases:Record<string,[string,string,string]>={listing:['车源信息','Listing information','Данные объявления'],nameplatePhoto:['铭牌照片','Nameplate photo','Фото заводской таблички'],trimLaunchAndFirstRegistration:['配置上市与首次登记时间','Trim launch and first registration','Начало выпуска комплектации и первая регистрация']};
export function projectVehicleEvidence(documents:SourceDocument[]):VehicleEvidenceProjection{
 const newest=(kind:SourceDocument['kind'],locale?:Locale)=>documents.filter(d=>d.kind===kind&&(!locale||d.locale===locale)).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
 const primary=newest('detail','en')??newest('detail'),base=obj(primary?.payload),identity=primary?.identity??documents[0]!.identity;
 const output={} as VehicleEvidenceProjection;
 for(const locale of locales){
  const capture=obj(newest('detail',locale)?.payload),row=versionMatches(base,capture)?capture:base;
  const range=obj(base.manufactureDateRange),earliest=date(range.earliest),latest=date(range.latest),basis=typeof range.basis==='string'?bases[range.basis]:undefined;
  const name=(key:'make'|'model'|'trim')=>{const named=obj(row[key]);return sourceDisplay(locale==='zh'?named.nameZh??named.name:named.name,locale);};
  const exportCode=obj(base.export).status??base.exportStatus;
  const inspection=selectInspection(documents,identity,base,locale);
  output[locale]={extras:{identifiers:{sourceId:identity.externalId,source:identity.source,inquiryCode:`${identity.source}-${identity.externalId}`,vin:validVin(obj(base.nameplate).vin)},
   manufacture:{date:date(base.manufactureDate),range:earliest&&latest&&earliest.value<=latest.value?{earliest,latest}:null,source:typeof base.manufactureDateSource==='string'&&sourceCodes.has(base.manufactureDateSource)?base.manufactureDateSource:null,basis:basis?sourceDisplay(basis[locales.indexOf(locale)],locale):null},
   vehicleClass:sourceDisplay(row.vehicleClass,locale).status==='missing'?null:sourceDisplay(row.vehicleClass,locale),exportStatus:exportCode==='eligible'||exportCode==='restricted'?exportCode:'unknown',powerHp:typeof base.powerHp==='number'&&Number.isFinite(base.powerHp)&&base.powerHp>=0&&base.powerHp<=100000?base.powerHp:null,
   names:{make:name('make'),model:name('model'),trim:identity.source==='che168'&&identity.externalId==='60461832'?missing(locale):name('trim')}},inspection,history:history(base)};
 }return output;
}
/** Projection only: request handlers never parse supplier raw payloads. Caller owns visibility/version guards. */
export async function publicVehicleExtras(tx:Pick<PoolClient,'query'>,listingId:string,locale:Locale):Promise<VehicleExtras|null>{return (await tx.query<{data:VehicleExtras}>('SELECT data FROM external_vehicle_extras WHERE listing_id=$1 AND locale=$2',[listingId,locale])).rows[0]?.data??null;}
export async function readVehicleEvidence(tx:Pick<PoolClient,'query'>,listingId:string,locale:Locale,kind:EvidenceKind,offset:number,limit:number,filters?:Pick<PublicVehicleInspectionQuery,'category'|'part'|'outcome'|'order'>){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid evidence page bounds.');
 if(kind==='inspection'){
  const row=(await tx.query<{source_revision:string;total:number;status:Status;overview:unknown;items:InspectionItem[]}>(`WITH chosen AS MATERIALIZED (
   SELECT * FROM external_vehicle_evidence_sets WHERE listing_id=$1 AND locale=$2 AND kind='inspection'
  ), filtered AS MATERIALIZED (
   SELECT e.position,e.data FROM external_vehicle_evidence e JOIN chosen s USING(listing_id,locale,kind)
   WHERE s.status='available' AND ($5::text IS NULL OR e.data->>'categoryId'=$5) AND ($6::text IS NULL OR e.data->>'partId'=$6) AND ($7::text IS NULL OR e.data->>'outcome'=$7)
  ) SELECT s.source_revision,s.status,s.overview,(SELECT count(*)::integer FROM filtered) AS total,
   coalesce((SELECT jsonb_agg(p.data ORDER BY p.rank,p.position) FROM (SELECT data,position,
    CASE WHEN $8='faults_first' THEN CASE data->>'outcome' WHEN 'defect' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END ELSE 0 END AS rank
    FROM filtered ORDER BY rank,position OFFSET $3 LIMIT $4) p),'[]'::jsonb) AS items FROM chosen s`,[listingId,locale,offset,limit,filters?.category??null,filters?.part??null,filters?.outcome??null,filters?.order??'source'])).rows[0];
  if(!row)return null;
  const overview=obj(row.overview),parsed=PublicInspectionSummarySchema.safeParse(overview.summary);
  return {sourceRevision:row.source_revision,total:row.total,items:row.items,status:row.status,summary:parsed.success&&row.status==='available'?{...parsed.data,status:row.status}:emptyInspectionSummary(row.status),conclusions:row.status==='available'?arr(overview.conclusions):[]};
 }
 const row=(await tx.query<{source_revision:string;total:number;status:Status;items:(InspectionItem|HistoryItem)[]}>(`SELECT s.source_revision,s.total,s.status,
 coalesce((SELECT jsonb_agg(p.data ORDER BY p.position) FROM (SELECT position,data FROM external_vehicle_evidence WHERE listing_id=s.listing_id AND locale=s.locale AND kind=s.kind AND position >= $4 ORDER BY position LIMIT $5) p),'[]'::jsonb) AS items
 FROM external_vehicle_evidence_sets s WHERE listing_id=$1 AND locale=$2 AND kind=$3`,[listingId,locale,kind,offset,limit])).rows[0];
 return row?{sourceRevision:row.source_revision,total:row.total,items:row.items}:null;
}
export async function refreshInspectionEvidence(tx:PoolClient,listingId:string,locale:Locale,inspection:InspectionProjection){
 const {status,summary,conclusions,items}=inspection,overview={summary,conclusions},revision=jsonHash(['inspection-v2',locale,status,overview,items]);
 const updated=await tx.query(`INSERT INTO external_vehicle_evidence_sets(listing_id,locale,kind,source_revision,total,status,overview) VALUES($1,$2,'inspection',$3,$4,$5,$6)
  ON CONFLICT(listing_id,locale,kind) DO UPDATE SET source_revision=excluded.source_revision,total=excluded.total,status=excluded.status,overview=excluded.overview
  WHERE external_vehicle_evidence_sets.source_revision<>excluded.source_revision RETURNING listing_id`,[listingId,locale,revision,items.length,status,JSON.stringify(overview)]);
 if(!updated.rowCount)return false;
 await tx.query("DELETE FROM external_vehicle_evidence WHERE listing_id=$1 AND locale=$2 AND kind='inspection'",[listingId,locale]);
 for(let offset=0;offset<items.length;offset+=100)await tx.query(`INSERT INTO external_vehicle_evidence(listing_id,locale,kind,position,data)
  SELECT $1,$2,'inspection',$3+ordinality-1,value FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS p(value,ordinality)`,[listingId,locale,offset,JSON.stringify(items.slice(offset,offset+100))]);
 return true;
}
export async function refreshVehicleEvidence(tx:PoolClient,listingId:string,projection:VehicleEvidenceProjection){
 let changed=false;
 for(const locale of locales){const {extras,inspection,history}=projection[locale];
  const result=await tx.query(`INSERT INTO external_vehicle_extras(listing_id,locale,data,export_status) VALUES($1,$2,$3,$4) ON CONFLICT(listing_id,locale) DO UPDATE SET data=excluded.data,export_status=excluded.export_status WHERE external_vehicle_extras.data IS DISTINCT FROM excluded.data RETURNING listing_id`,[listingId,locale,JSON.stringify(extras),extras.exportStatus]);changed||=!!result.rowCount;
  const inspectionChanged=await refreshInspectionEvidence(tx,listingId,locale,inspection);changed=changed||inspectionChanged;
  for(const kind of ['price-history'] as const){const items=history,revision=jsonHash([locale,kind,items,inspection.status]);
   const updated=await tx.query(`INSERT INTO external_vehicle_evidence_sets(listing_id,locale,kind,source_revision,total,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(listing_id,locale,kind) DO UPDATE SET source_revision=excluded.source_revision,total=excluded.total,status=excluded.status WHERE external_vehicle_evidence_sets.source_revision<>excluded.source_revision RETURNING listing_id`,[listingId,locale,kind,revision,items.length,inspection.status]);
   if(!updated.rowCount)continue;changed=true;await tx.query('DELETE FROM external_vehicle_evidence WHERE listing_id=$1 AND locale=$2 AND kind=$3',[listingId,locale,kind]);
   for(let offset=0;offset<items.length;offset+=100)await tx.query(`INSERT INTO external_vehicle_evidence(listing_id,locale,kind,position,data) SELECT $1,$2,$3,$4+ordinality-1,value FROM jsonb_array_elements($5::jsonb) WITH ORDINALITY AS p(value,ordinality)`,[listingId,locale,kind,offset,JSON.stringify(items.slice(offset,offset+100))]);
  }
 }return changed;
}
