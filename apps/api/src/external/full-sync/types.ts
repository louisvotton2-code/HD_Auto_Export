import type {PoolClient} from 'pg';
import type {SourceDocument} from '../sources/index.js';
export type Source='che168'|'dongchedi';
export type Locale='zh'|'en'|'ru';
export type Actor={id:string;requestId:string};
export type Raw={hash:string;body:string};
export type Change={id:number;source:Source;vehicleId:string;type:'new'|'price'|'removed'|'relisted';at:string};
export type Changes={cursor:number;nextCursor:number;hasMore:boolean;changes:Change[];rawResponse:Raw};
export type Bulk={results:Array<Record<string,unknown>&{id:string;source:Source}>;notFound:string[];rawResponse:Raw};
export type ApplyInput={source:Source;externalId:string;canonicalId:string;operation:'upsert'|'withdraw';documents:SourceDocument[];at:string;batchId:string};
export type FullApply=(tx:PoolClient,input:ApplyInput)=>Promise<void>;
export class FullSyncError extends Error{affectedIds?:string[];constructor(readonly code:string,readonly retryAfterMs=0){super(code);}}
export const LIMITS={bulk:500,events:2000,dbBatch:100,pool:2,rps:2,bodyBytes:16*1024*1024,rotationDays:7,deltaMs:300_000} as const;
