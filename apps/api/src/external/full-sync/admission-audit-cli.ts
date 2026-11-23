import { parseArgs } from 'node:util';
import { createDatabase } from '../../db/index.js';
import { AdmissionAuditOptions, AdmissionAuditUnavailableError, auditSupplierAdmissionGap } from './admission-audit.js';

async function main() {
  const { values }=parseArgs({options:{
    database:{type:'string'},checkpoint:{type:'string'},
    'snapshot-id':{type:'string'},'restore-receipt':{type:'string'},'restore-as-of':{type:'string'},
    'chunk-rows':{type:'string',default:'1000'},'max-chunks':{type:'string',default:'20'},
  }});
  const options=AdmissionAuditOptions.parse({
    database:values.database,checkpoint:values.checkpoint,snapshotId:values['snapshot-id'],
    restoreReceipt:values['restore-receipt'],restoreAsOf:values['restore-as-of'],
    chunkRows:Number(values['chunk-rows']),maxChunks:Number(values['max-chunks']),
  });
  const address=new URL(process.env.ADMISSION_AUDIT_DATABASE_URL??'');
  if (!['postgres:','postgresql:'].includes(address.protocol) || !['127.0.0.1','[::1]'].includes(address.hostname) ||
      address.search || address.hash || decodeURIComponent(address.pathname.slice(1))!==options.database) {
    throw new AdmissionAuditUnavailableError('Explicitly matched loopback restore required');
  }
  const db=createDatabase(address.toString(),1);
  try {
    const result=await auditSupplierAdmissionGap(db,options);
    console.log(JSON.stringify(result));
    if (!result.complete) process.exitCode=2;
  } finally { await db.close(); }
}

void main().catch(error=>{
  // Never print connection strings, SQL or source identities from database failures.
  console.error(error instanceof AdmissionAuditUnavailableError?error.message:
    'Admission audit failed. Verify the isolated restore, CSV manifest and private checkpoint before resuming.');
  process.exitCode=1;
});
