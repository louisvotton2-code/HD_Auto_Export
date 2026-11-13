import {z} from 'zod';
import {isCursorTime} from '../../cursor-time.js';
import type {Database} from '../../db/index.js';
import {ApiError,notFound} from '../../errors.js';
import type {SourceDocument} from './documents.js';
import {decodeSourceBlob} from './archive.js';
const publicId=z.string().regex(/^ext-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const Cursor=z.strictObject({listingId:publicId,time:z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/),id:z.uuid()});
type Row={id:string;kind:SourceDocument['kind'];locale:SourceDocument['locale'];hash:string;first_observed_at:Date;last_observed_at:Date;source_updated_at:Date|null;cursor_time:string};
const summary=(row:Row)=>({id:row.id,kind:row.kind,locale:row.locale,hash:row.hash,firstObservedAt:row.first_observed_at.toISOString(),lastObservedAt:row.last_observed_at.toISOString(),sourceUpdatedAt:row.source_updated_at?.toISOString()??null});
const relation=`FROM external_source_documents d JOIN external_listings l ON l.provider=d.provider AND l.platform_id=d.source AND l.external_id=d.external_id`;
async function requireListing(db:Database,id:string){
 if(!publicId.safeParse(id).success)throw notFound();
 const exists=await db.pool.query('SELECT 1 FROM external_listings WHERE id=$1',[id.slice(4)]);if(!exists.rowCount)throw notFound();
}
/** Route authentication/vehicles:read is mandatory; this layer additionally binds every row to its vehicle identity. */
export async function listSourceDocuments(db:Database,id:string,query:{cursor?:string;limit:number}){
 await requireListing(db,id);
 if(!Number.isInteger(query.limit)||query.limit<1||query.limit>100)throw new ApiError(400,'INVALID_REQUEST','Invalid source history page size.');
 let cursor:z.infer<typeof Cursor>|undefined;
 if(query.cursor){try{if(query.cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new Error();cursor=Cursor.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));if(cursor.listingId!==id||!isCursorTime(cursor.time))throw new Error();}catch{throw new ApiError(400,'INVALID_REQUEST','Invalid source history cursor.');}}
 const rows=(await db.pool.query<Row>(`SELECT d.id,d.kind,d.locale,d.hash,d.first_observed_at,d.last_observed_at,d.source_updated_at,
 to_char(d.first_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time ${relation}
 WHERE l.id=$1 AND ($2::timestamptz IS NULL OR (d.first_observed_at,d.id)<($2::timestamptz,$3::uuid)) ORDER BY d.first_observed_at DESC,d.id DESC LIMIT $4`,[id.slice(4),cursor?.time??null,cursor?.id??null,query.limit+1])).rows;
 const page=rows.slice(0,query.limit),last=page.at(-1);
 return {items:page.map(summary),nextCursor:rows.length>query.limit&&last?Buffer.from(JSON.stringify({listingId:id,time:last.cursor_time,id:last.id})).toString('base64url'):null};
}
export async function getSourceDocument(db:Database,id:string,documentId:string){
 if(!publicId.safeParse(id).success||!z.uuid().safeParse(documentId).success)throw notFound();
 const row=(await db.pool.query<Row&{payload:unknown;raw_text:string|null;compressed:Buffer|null;raw_exact:boolean;response_hash:string|null}>(`SELECT d.*,b.payload,b.raw_text,b.compressed,b.raw_exact ${relation}
 JOIN external_source_blobs b ON b.hash=d.hash WHERE l.id=$1 AND d.id=$2`,[id.slice(4),documentId])).rows[0];
 if(!row)throw notFound();
 return {...summary(row),...decodeSourceBlob(row),response:row.response_hash?{hash:row.response_hash,shared:true as const}:null};
}
