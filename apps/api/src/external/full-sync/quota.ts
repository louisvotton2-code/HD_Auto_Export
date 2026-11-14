import {z} from 'zod';
import type {Database} from '../../db/index.js';
import {FullSyncError,type Source} from './types.js';
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// Keep the same documented plan set as provider-probe.ts; unknown plans fail closed.
const schema=z.looseObject({product:z.enum(['chinacarapi','encarapi-addon']),plan:z.enum(['sandbox','trial','starter','business','scale','internal']),
 sources:z.array(z.enum(['che168','dongchedi'])).max(2).refine(items=>new Set(items).size===items.length),
 expiresAt:z.iso.datetime({offset:true}).nullable().optional(),dailyLimit:count.nullable().optional(),remainingToday:count.nullable().optional()});
export function syncAccount(input:unknown,now=new Date()){
 const parsed=schema.safeParse(input);if(!parsed.success)throw new FullSyncError('SYNC_ACCOUNT_INVALID');
 if(parsed.data.expiresAt&&Date.parse(parsed.data.expiresAt)<=now.getTime())throw new FullSyncError('SYNC_ACCOUNT_EXPIRED');return parsed.data;
}
export function checkBulkQuota(input:{account:unknown;checkedAt:Date|string|null;day:string|null;used:number;reservedSinceCheck:number;requested:number;source:Source},now=new Date()){
 const account=syncAccount(input.account,now),today=now.toISOString().slice(0,10);
 if(!input.checkedAt||new Date(input.checkedAt).toISOString().slice(0,10)!==today)throw new FullSyncError('SYNC_ACCOUNT_REFRESH_REQUIRED');
 if(!account.sources.includes(input.source))throw new FullSyncError('SYNC_SOURCE_FORBIDDEN');
 if(!Number.isSafeInteger(input.requested)||input.requested<1||input.requested>500)throw new FullSyncError('SYNC_BULK_INVALID');
 const used=input.day===today?input.used:0;
 const limit=Math.min(account.dailyLimit??Number.MAX_SAFE_INTEGER,account.plan==='trial'?1000:Number.MAX_SAFE_INTEGER);
 if(used+input.requested>limit||account.remainingToday!==null&&account.remainingToday!==undefined&&input.reservedSinceCheck+input.requested>account.remainingToday)throw new FullSyncError('SYNC_ACCOUNT_DAILY_LIMIT');
 return {day:today,used:used+input.requested,reserved:input.reservedSinceCheck+input.requested};
}
export async function reserveBulkQuota(db:Database,requested:number,source:Source){
 return db.transaction(async tx=>{
  const s=(await tx.query("SELECT *,clock_timestamp() AS checked_now,to_char(bulk_day,'YYYY-MM-DD') AS quota_day FROM external_full_sync WHERE id=1 FOR UPDATE")).rows[0]!;
  const quota=checkBulkQuota({account:s.account,checkedAt:s.account_checked_at,day:s.quota_day,used:s.bulk_ids,reservedSinceCheck:s.account_reserved_ids,requested,source},s.checked_now);
  await tx.query('UPDATE external_full_sync SET bulk_day=$1,bulk_ids=$2,account_reserved_ids=$3 WHERE id=1',[quota.day,quota.used,quota.reserved]);
 });
}
