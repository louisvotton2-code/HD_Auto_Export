import {z} from 'zod';
import {FullSyncError} from './types.js';

export const heavyWorkPausePercentSchema=z.union([z.literal(70),z.literal(80)]);
export type HeavyWorkPausePercent=z.infer<typeof heavyWorkPausePercentSchema>;
export const defaultHeavyWorkPausePercent:HeavyWorkPausePercent=70;

export function readHeavyWorkPausePercent(value:string|undefined):HeavyWorkPausePercent{
 if(value===undefined||value==='70')return defaultHeavyWorkPausePercent;
 if(value==='80')return 80;
 throw new FullSyncError('SYNC_HEAVY_WORK_PAUSE_PERCENT_INVALID');
}

export function reachedHeavyWorkPause(usedBytes:number,totalBytes:number,percent:HeavyWorkPausePercent){
 return BigInt(usedBytes)*100n>=BigInt(totalBytes)*BigInt(percent);
}
