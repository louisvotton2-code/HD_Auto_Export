import type {PoolClient} from 'pg';
import {PublicVehicleInlineSchema,PublicConfigurationInlineItemSchema,PublicInspectionEntrySchema,PublicInspectionConclusionSchema,type PublicVehicle,type Locale} from '@hd/contracts/public';
import {emptyInspectionSummary} from '../external/sources/inspection-projection.js';
import {sourceDisplay} from '../external/sources/display.js';

const aliases:Record<string,string[]>={
 displacementCc:['engineCc','排量','displacement','рабочий объём'],engineKw:['发动机功率','engine power','мощность двигателя'],engineHp:['发动机马力','engine horsepower'],
 motorKw:['motorPowerKw','电机功率','motor power','мощность электродвигателя'],motorHp:['电机马力','motor horsepower'],motorTorqueNm:['电机扭矩','motor torque'],
 powerKw:['功率','power'],powerHp:['马力','horsepower'],torqueNm:['扭矩','torque'],cylinders:['气缸数','cylinders'],
 batteryKwh:['电池容量','battery capacity','ёмкость батареи'],batteryType:['电池类型','battery type'],batteryWarranty:['电池质保','battery warranty'],
 rangeKm:['续航里程','range','запас хода'],fastChargeHours:['快充时间','fast charging'],slowChargeHours:['慢充时间','slow charging'],
 motorType:['电机类型','motor type'],motorLayout:['电机布局','motor layout'],motors:['电机数量','number of motors'],
 driveType:['drivetrain','驱动方式','drive type','привод'],transmissionType:['transmission','变速箱','gearbox','коробка передач'],gears:['挡位数','gears'],
 bodyType:['车身类型','body type'],doors:['车门数','doors','количество дверей'],seats:['座位数','seats','количество мест'],
 lengthMm:['车长','长度','length','длина'],widthMm:['车宽','宽度','width','ширина'],heightMm:['车高','高度','height','высота'],wheelbaseMm:['轴距','wheelbase','колёсная база'],
 curbWeightKg:['整备质量','curb weight'],grossWeightKg:['总质量','gross weight'],fuelTankL:['油箱容积','fuel tank'],trunkL:['行李厢容积','trunk volume'],
 wheelSize:['轮毂尺寸','wheel size'],tireSize:['轮胎规格','tire size','tyre size'],frontTireSize:['前轮胎规格','front tires'],rearTireSize:['后轮胎规格','rear tires'],
 abs:['防抱死系统','anti-lock braking system'],airbags:['安全气囊','подушки безопасности'],seatHeating:['座椅加热','seat heating','подогрев сидений'],
 cruiseControl:['定速巡航','cruise control'],parkingCamera:['倒车影像','parking camera'],parkingSensors:['泊车雷达','parking sensors'],sunroof:['天窗','люк'],airConditioning:['空调','air conditioning'],
 energyType:['能源类型','energy type'],emissionStandard:['排放标准','emission standard'],topSpeedKmh:['最高车速','top speed'],acceleration0to100S:['百公里加速','0-100 acceleration'],fuelConsumptionL100km:['油耗','fuel consumption'],consumptionKwh100km:['电耗','energy consumption'],systemKw:['系统功率','system power'],launchDate:['上市时间','launch date'],warranty:['质保','warranty'],
};
const normalized=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s_()（）·³/.-]/g,'');
const names=new Map(Object.entries(aliases).flatMap(([key,values])=>[key,...values].map(value=>[normalized(value),key] as const)));
export function configurationSemanticKey(id:string,label:string|null):string|null {
 let stable=id.replace(/^specs\.(?:ev\.)?/,'');
 if(/^cfg-(?:[0-9a-f]{4})+$/.test(id))stable=String.fromCharCode(...(id.slice(4).match(/.{4}/g)??[]).map(hex=>parseInt(hex,16)));
 return names.get(normalized(stable))??(label?names.get(normalized(label)):null)??null;
}

/** Called inside the same visibility-checked REPEATABLE READ transaction as the ordinary detail. No stored DTO changes. */
export async function inlineDetail(tx:PoolClient,vehicle:PublicVehicle,locale:Locale){
 const inspectionSummary=vehicle.inspectionSummary??emptyInspectionSummary(vehicle.report?.hasReport?'unavailable':'unknown');
 let conclusions:unknown[]=[],defects:unknown[]=[],normalItemCount=0;
 let items:Array<{id:string;name:ReturnType<typeof sourceDisplay>;value:ReturnType<typeof sourceDisplay>}>=vehicle.configuration?.items??[];
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
  if(config.rows.length)items=config.rows.map(row=>row.data);
  else items=(vehicle.external?.detail?.specifications??[]).slice(0,200).map((entry,index)=>({id:`legacy.${index}`,name:sourceDisplay(entry.name.text,locale),value:sourceDisplay(entry.value.text,locale)}));
 }
 return PublicVehicleInlineSchema.parse({...vehicle,projection:'detail-inline-v1',inspectionSummary,
  inspectionInline:{conclusions:conclusions.slice(0,3).map(v=>PublicInspectionConclusionSchema.parse(v)),defects:defects.slice(0,8).map(v=>PublicInspectionEntrySchema.parse(v)),normalItemCount,hasMoreConclusions:conclusions.length>3,hasMoreDefects:defects.length>8},
  configurationInline:items.slice(0,200).map(item=>PublicConfigurationInlineItemSchema.parse({...item,semanticKey:configurationSemanticKey(item.id,item.name.text)}))});
}
