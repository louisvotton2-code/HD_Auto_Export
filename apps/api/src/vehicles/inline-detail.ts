import type {PoolClient} from 'pg';
import {CONFIGURATION_SEMANTIC_ALIASES,SUPPLIER_TECHNICAL_CONFIGURATION_KEYS,type ConfigurationSemanticKey,type VehicleDetailMatchKey,type VehicleTechnicalDetails} from '@hd/contracts/public';
import {PublicVehicleInlineSchema,PublicConfigurationInlineItemSchema,PublicInspectionEntrySchema,PublicInspectionConclusionSchema,type PublicVehicle,type PublicVehicleInline,type Locale} from '@hd/contracts/public';
import {emptyInspectionSummary} from '../external/sources/inspection-projection.js';
import {sourceDisplay} from '../external/sources/display.js';
import {configurationTechnicalKey} from './configuration-technical-facts.js';
import {projectSupplierTechnicalDetails} from './supplier-technical-detail.js';

const supplierTechnicalIds=Object.keys(SUPPLIER_TECHNICAL_CONFIGURATION_KEYS);
const supplierTechnicalRowLimit=supplierTechnicalIds.length*3+1;

const normalized=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s_()（）·³/.-]/g,'');
const names=new Map(Object.entries(CONFIGURATION_SEMANTIC_ALIASES).flatMap(([key,values])=>[key,...values].map(value=>[normalized(value),key as ConfigurationSemanticKey] as const)));
export function configurationSemanticKey(id:string,label:string|null):ConfigurationSemanticKey|VehicleDetailMatchKey|null {
 let stable=id.replace(/^(?:specs\.(?:ev\.)?|supplier[:/.]|sheet\.\d+\.)/,'');
 if(/^cfg-(?:[0-9a-f]{4})+$/.test(id)){
  stable=String.fromCharCode(...(id.slice(4).match(/.{4}/g)??[]).map(hex=>parseInt(hex,16)));
  const technicalKey=configurationTechnicalKey(stable);
  if(technicalKey)return technicalKey;
 }
 return names.get(normalized(stable))??(label?names.get(normalized(label)):null)??null;
}

/** Called inside the same visibility-checked REPEATABLE READ transaction as the ordinary detail. No stored DTO changes. */
export async function inlineDetail(tx:PoolClient,vehicle:PublicVehicle & Pick<PublicVehicleInline,'englishTitle'>,locale:Locale,technicalView?:'verified'){
 const inspectionSummary=vehicle.inspectionSummary??emptyInspectionSummary(vehicle.report?.hasReport?'unavailable':'unknown');
 let conclusions:unknown[]=[],defects:unknown[]=[],normalItemCount=0;
 let items:Array<{id:string;name:ReturnType<typeof sourceDisplay>;value:ReturnType<typeof sourceDisplay>}>=vehicle.configuration?.items??[];
 let technicalDetails:VehicleTechnicalDetails|undefined;
 if(vehicle.id.startsWith('ext-')){
  const id=vehicle.id.slice(4);
  if(inspectionSummary.status==='available'){
   // All grouping stays in PostgreSQL: transfer at most 4 conclusions + 9 defects, never the complete report.
   const result=await tx.query<{conclusions:unknown[];defects:unknown[];normal:number}>(`WITH rows AS MATERIALIZED (
     SELECT position,data FROM external_vehicle_evidence WHERE listing_id=$1 AND locale=$2 AND kind='inspection'
    ), eligible AS (
     SELECT position,data,CASE WHEN nullif(data->>'categoryId','') IS NOT NULL AND nullif(data->>'partId','') IS NOT NULL
       THEN jsonb_build_array(data->>'categoryId',data->>'partId',data->'value'->>'text',data->'value'->>'contentLocale')::text
       ELSE 'unidentified:'||position::text END AS identity
     FROM rows WHERE data->>'outcome'='defect' AND data->'part'->>'status'='ready' AND data->'value'->>'status'='ready'
    ), distinct_defects AS (SELECT DISTINCT ON(identity) position,data FROM eligible ORDER BY identity,position)
    SELECT coalesce((SELECT jsonb_agg(data ORDER BY position) FROM (SELECT position,data FROM distinct_defects ORDER BY position LIMIT 9) d),'[]'::jsonb) AS defects,
     (SELECT count(*)::int FROM rows WHERE data->>'outcome'='ok' AND coalesce(data->>'kind','check')<>'summary') AS normal,
     coalesce((SELECT jsonb_agg(value ORDER BY ordinality) FROM (SELECT value,ordinality FROM external_vehicle_evidence_sets s,
      jsonb_array_elements(coalesce(s.overview->'conclusions','[]'::jsonb)) WITH ORDINALITY c(value,ordinality)
      WHERE s.listing_id=$1 AND s.locale=$2 AND s.kind='inspection' AND value->'value'->>'status'='ready'
      ORDER BY ordinality LIMIT 4) c),'[]'::jsonb) AS conclusions`,[id,locale]);
   ({conclusions,defects,normal:normalItemCount}=result.rows[0]!);
  }
  const config=await tx.query<{data:typeof items[number]}>("SELECT data FROM external_source_segments WHERE listing_id=$1 AND locale=$2 AND kind='configuration' ORDER BY position LIMIT 200",[id,locale]);
  if(config.rows.length){
   items=config.rows.map(row=>row.data);
   const disputedSpecifications=vehicle.external?.issues.some(issue=>
    (issue.field==='specifications'&&(issue.code==='conflict'||issue.code==='invalid'))
    ||(issue.code==='conflict'&&(issue.field==='powertrain'||issue.field==='trim'||issue.field==='modelYear')));
   if(technicalView==='verified'&&!disputedSpecifications){
    // Check the documented keys across all locales, including rows beyond the inline configuration limit.
    const technical=await tx.query<{locale:Locale;data:typeof items[number]}>(`SELECT locale,data FROM external_source_segments
     WHERE listing_id=$1 AND kind='configuration' AND locale IN ('zh','en','ru') AND data->>'id'=ANY($2::text[])
     ORDER BY locale,position LIMIT $3`,[id,supplierTechnicalIds,supplierTechnicalRowLimit]);
    if(technical.rows.length<supplierTechnicalRowLimit){
     technicalDetails=projectSupplierTechnicalDetails(vehicle.facts,technical.rows,new Set(items.map(item=>item.id)));
    }
   }
  }else items=(vehicle.external?.detail?.specifications??[]).slice(0,200).map((entry,index)=>({id:`legacy.${index}`,name:sourceDisplay(entry.name.text,locale),value:sourceDisplay(entry.value.text,locale)}));
 }
 return PublicVehicleInlineSchema.parse({...vehicle,...(technicalDetails?{technicalDetails}:{}),projection:'detail-inline-v1',inspectionSummary,
  inspectionInline:{conclusions:conclusions.slice(0,3).map(v=>PublicInspectionConclusionSchema.parse(v)),defects:defects.slice(0,8).map(v=>PublicInspectionEntrySchema.parse(v)),normalItemCount,hasMoreConclusions:conclusions.length>3,hasMoreDefects:defects.length>8},
  configurationInline:items.slice(0,200).map(item=>PublicConfigurationInlineItemSchema.parse({...item,semanticKey:configurationSemanticKey(item.id,item.name.text)}))});
}
