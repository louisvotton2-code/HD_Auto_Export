import type {PoolClient} from 'pg';
import type {Database} from './db/index.js';
const lock=78291335;
export function validateBackupReference(reference:string){if(!/^backup:[A-Za-z0-9:_-]{1,180}$/.test(reference))throw new Error('Invalid backup reference');return reference;}
/** Acquire before the database snapshot; durable even if the backup process exits. No timeout releases protection. */
export async function changeBackupLease(db:Database,action:'acquire'|'release',reference:string){
 validateBackupReference(reference);
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock($1)',[lock]);
  if(action==='acquire')await tx.query('INSERT INTO backup_gc_leases(reference) VALUES($1) ON CONFLICT DO NOTHING',[reference]);
  else await tx.query('DELETE FROM backup_gc_leases WHERE reference=$1',[reference]);
  return {reference,protected:action==='acquire',activeLeases:(await tx.query('SELECT count(*)::int AS n FROM backup_gc_leases')).rows[0].n};
 });
}
/** The caller MUST hold this transaction through its physical unlink/DELETE. Contention skips GC. */
export async function physicalCleanupAllowed(tx:PoolClient):Promise<boolean>{
 const got=(await tx.query('SELECT pg_try_advisory_xact_lock_shared($1) AS locked',[lock])).rows[0]?.locked;
 if(!got)return false;
 return !(await tx.query('SELECT 1 FROM backup_gc_leases LIMIT 1')).rowCount;
}
