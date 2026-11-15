import type {Database} from '../../db/index.js';
import {ChinaCarClient} from './provider.js';
import {admitFormalListing,FORMAL_LISTING_LIMIT} from '../formal-admission.js';
import {persistSourceResponse} from '../sources/index.js';
/** No network inside a transaction. Withdrawals can commit while a different source detail is unavailable. */
export async function hydratePending(db:Database,client:ChinaCarClient,jobId:string){
 const rows=await db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(78291332)');
  const limit=(await tx.query<{reached:boolean}>('SELECT admitted_count >= $1 AS reached FROM external_formal_admission_state WHERE id=1',[FORMAL_LISTING_LIMIT])).rows[0]!.reached;
  const pending=(await tx.query<{seq:string;source:'che168'|'dongchedi';external_id:string;document:unknown[]}>(`SELECT seq,source,external_id,document FROM external_ingestion_events e
   WHERE job_id=$1 AND completed_at IS NULL AND lane='delta' AND operation<>'withdraw' AND hydrated_document IS NULL AND hydration_attempts<3
   AND hydration_retry_at<=clock_timestamp() AND ($2=false OR EXISTS(
    SELECT 1 FROM external_formal_admissions a WHERE a.source=e.source AND a.external_id=e.external_id))
   AND NOT EXISTS(SELECT 1 FROM external_ingestion_identity_state i
    WHERE i.provider=e.provider AND i.source=e.source AND i.external_id=e.external_id AND i.withdrawn
      AND (e.operation<>'relist' OR i.business_order>=e.business_order
       OR date_trunc('milliseconds',i.business_at)>date_trunc('milliseconds',coalesce((
        SELECT doc->>'sourceUpdatedAt' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.document)='array' THEN e.document ELSE '[]'::jsonb END) WITH ORDINALITY AS entries(doc,position)
        WHERE doc->>'kind'='event' ORDER BY position LIMIT 1)::timestamptz,e.observed_at))))
   ORDER BY seq LIMIT 200`,[jobId,limit])).rows;
  const admitted=[];
  for(const event of pending)if(await admitFormalListing(tx,event.source,event.external_id))admitted.push(event);
  return admitted;
 });
 if(!rows.length)return 0;
 const documents=new Map<string,unknown[]>(),missing=new Set<string>(),observedAt=new Date().toISOString();
 for(const source of ['che168','dongchedi'] as const){
  const ids=[...new Set(rows.filter(r=>r.source===source).map(r=>r.external_id))];if(!ids.length)continue;
  for(const locale of ['zh','en','ru'] as const){const result=await client.bulk(source,ids,locale);
   await db.transaction(tx=>persistSourceResponse(tx,result.rawResponse));
   for(const id of result.notFound)missing.add(`${source}:${id}`);
   for(const payload of result.results){const key=`${source}:${payload.id}`,items=documents.get(key)??[];
    items.push({identity:{provider:'chinacarapi',source,externalId:payload.id},kind:'detail',locale,observedAt,
     sourceUpdatedAt:typeof payload.updatedAt==='string'?payload.updatedAt:null,payload,rawResponse:{hash:result.rawResponse.hash}});documents.set(key,items);}
  }
 }
 return db.transaction(async tx=>{let count=0;
  for(const row of rows){if(missing.has(`${row.source}:${row.external_id}`)){await tx.query(`UPDATE external_ingestion_events SET hydration_attempts=hydration_attempts+1,hydration_retry_at=clock_timestamp()+interval '60 seconds',hydration_error='not_found' WHERE job_id=$1 AND seq=$2 AND hydrated_document IS NULL`,[jobId,row.seq]);continue;}
   const result=await tx.query(`UPDATE external_ingestion_events SET hydrated_document=$3 WHERE job_id=$1 AND seq=$2 AND completed_at IS NULL AND hydrated_document IS NULL`,[jobId,row.seq,JSON.stringify([...row.document,...documents.get(`${row.source}:${row.external_id}`)!])]);count+=result.rowCount??0;}
  return count;
 });
}
