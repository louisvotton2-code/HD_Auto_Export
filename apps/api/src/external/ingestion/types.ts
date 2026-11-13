import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {canonicalJson} from '../normalize.js';
const stamp=z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString());
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/);
export const IdentitySchema=z.strictObject({provider:z.literal('chinacarapi'),source:z.enum(['che168','dongchedi']),externalId:id});
export const ManifestSchema=z.strictObject({version:z.literal(1),provider:z.literal('chinacarapi'),generatedAt:stamp,
 identities:z.array(IdentitySchema.omit({provider:true}).extend({canonicalId:id})).min(1).max(1000),
 csv:z.strictObject({sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive(),rows:z.number().int().positive(),
 sourceCounts:z.strictObject({che168:z.number().int().nonnegative(),dongchedi:z.number().int().nonnegative()}),generatedAt:stamp,complete:z.literal(true)})
}).superRefine((value,ctx)=>{
 if(new Set(value.identities.map(x=>x.canonicalId)).size>300)ctx.addIssue({code:'custom',message:'Fixed manifest exceeds 300 canonical vehicles.'});
 if(new Set(value.identities.map(x=>`${x.source}:${x.externalId}`)).size!==value.identities.length)ctx.addIssue({code:'custom',message:'Duplicate source identity.'});
 if(value.csv.sourceCounts.che168+value.csv.sourceCounts.dongchedi!==value.csv.rows)ctx.addIssue({code:'custom',message:'CSV counts do not add up.'});
 if(value.generatedAt!==value.csv.generatedAt)ctx.addIssue({code:'custom',message:'Snapshot and event start must use the same generated-at.'});
});
export const EventSchema=z.strictObject({key:z.string().min(1).max(512),identity:IdentitySchema,
 operation:z.enum(['upsert','withdraw','relist']),businessOrder:z.string().regex(/^(0|[1-9][0-9]{0,29})$/),observedAt:stamp,
 snapshotHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),document:z.unknown().refine(value=>value!==undefined,'A complete source document is required.')});
export type Manifest=z.infer<typeof ManifestSchema>;
export type IngestionEvent=z.infer<typeof EventSchema>;
export type Lane='snapshot'|'delta'|'detail';
export const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export const identityKey=(value:z.infer<typeof IdentitySchema>)=>`${value.provider}/${value.source}/${value.externalId}`;
export type ApplyContext={obsolete:boolean;jobId:string;canonicalId:string;actor:{id:string;requestId:string};triggeredBy:string};
export type SourceApplier=(tx:PoolClient,event:IngestionEvent,context:ApplyContext)=>Promise<void>;
export class IngestionError extends Error {constructor(readonly code:string){super(code);}}
export const WORKER_LIMITS={pool:2,network:1,batch:200,leaseSeconds:60,maxRecoveries:2,continuous:false} as const;
