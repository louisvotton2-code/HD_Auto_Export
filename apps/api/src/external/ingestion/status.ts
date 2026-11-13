import {ExternalIngestionStatusSchema} from '@hd/contracts/admin';
import type {Database} from '../../db/index.js';
export async function ingestionStatus(db:Database,jobId?:string){
 const row=(await db.pool.query(`SELECT j.*,
   (SELECT count(*)::int FROM external_ingestion_members m WHERE m.job_id=j.id) AS raw_count,
   (SELECT count(DISTINCT canonical_id)::int FROM external_ingestion_members m WHERE m.job_id=j.id) AS canonical_count,
   (SELECT count(*)::int FROM external_ingestion_members m JOIN external_listings l ON l.provider=m.provider AND l.platform_id=m.source AND l.external_id=m.external_id JOIN external_catalog c ON c.listing_id=l.id WHERE m.job_id=j.id AND l.formal_primary AND l.upstream_state='active') AS public_count
   FROM external_ingestion_jobs j WHERE ($1::uuid IS NULL OR j.id=$1) ORDER BY created_at DESC,id DESC LIMIT 1`,[jobId??null])).rows[0];
 return ExternalIngestionStatusSchema.parse({mode:'fixed_once',continuous:false,latestJob:row?{
  id:row.id,state:row.state,createdAt:row.created_at.toISOString(),generatedAt:row.generated_at.toISOString(),completedAt:row.completed_at?.toISOString()??null,
  triggeredByStaffId:row.triggered_by,receivedEvents:Number(row.received_seq),appliedEvents:Number(row.applied_seq),rawIdentityCount:row.raw_count,
  canonicalVehicleCount:row.canonical_count,publicVehicleCount:row.public_count,networkRequests:Number(row.network_requests),failures:row.failures,recoveryCount:row.recovery_count,
 }:null});
}
