import type {Locale} from './common.js';
import {PublicInspectionSummarySchema,PublicVehicleInspectionResponseSchema} from './public.js';
/** Synthetic API example: complete counts are independent of this one-item page. */
export function makePublicInspectionFixture(locale:Locale='en'){
 const text=(value:string)=>({status:'ready' as const,text:value,requestedLocale:locale,contentLocale:'en',provenance:'supplier' as const,reviewed:false});
 const summary=PublicInspectionSummarySchema.parse({status:'available',contentLocale:'en',checked:95,faults:1,categories:[
  {id:'accident',label:text('Accident damage inspection'),checked:40,faults:1,outcome:'defect'},
  {id:'flood',label:text('Flood damage inspection'),checked:36,faults:0,outcome:'ok'},
  {id:'fire',label:text('Fire damage inspection'),checked:19,faults:0,outcome:'ok'},
 ]});
 return PublicVehicleInspectionResponseSchema.shape.data.parse({vehicleId:'ext-00000000-0000-4000-8000-000000000008',locale,revision:'8'.repeat(64),status:'available',summary,conclusions:[{id:'summary.0',name:text('Summary'),value:text('One inspected part requires attention.')}],
  total:1,nextCursor:null,items:[{id:'check.0.0.0',kind:'check',categoryId:'accident',category:summary.categories[0]!.label,partId:'part.fixture',part:text('Door'),groupId:'group.fixture',group:text('Body'),name:text('Body'),value:text('Repair observed'),outcome:'defect'}]});
}
