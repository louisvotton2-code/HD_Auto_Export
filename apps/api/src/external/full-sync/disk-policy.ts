import {z} from 'zod';
import {FullSyncError} from './types.js';

export const heavyWorkPausePercentSchema=z.union([z.literal(70),z.literal(80)]);
export type HeavyWorkPausePercent=z.infer<typeof heavyWorkPausePercentSchema>;
export const projectedPeakPausePercentSchema=z.union([heavyWorkPausePercentSchema,z.literal(90)]);
export type ProjectedPeakPausePercent=z.infer<typeof projectedPeakPausePercentSchema>;
export const defaultHeavyWorkPausePercent:HeavyWorkPausePercent=70;

export function readHeavyWorkPausePercent(value:string|undefined):HeavyWorkPausePercent{
 if(value===undefined||value==='70')return defaultHeavyWorkPausePercent;
 if(value==='80')return 80;
 throw new FullSyncError('SYNC_HEAVY_WORK_PAUSE_PERCENT_INVALID');
}

export function readProjectedPeakPausePercent(value:string|undefined,actualPercent:HeavyWorkPausePercent):ProjectedPeakPausePercent{
 if(value===undefined)return actualPercent;
 if(value==='70'||value==='80'||value==='90')return Number(value) as ProjectedPeakPausePercent;
 throw new FullSyncError('SYNC_PROJECTED_PEAK_PAUSE_PERCENT_INVALID');
}

export function reachedDiskPercent(usedBytes:number,totalBytes:number,percent:ProjectedPeakPausePercent){
 return BigInt(usedBytes)*100n>=BigInt(totalBytes)*BigInt(percent);
}

export function reachedHeavyWorkPause(usedBytes:number,totalBytes:number,percent:HeavyWorkPausePercent){
 return reachedDiskPercent(usedBytes,totalBytes,percent);
}
