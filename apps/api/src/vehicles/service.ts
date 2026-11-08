import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AdminVehicleSchema, type AdminVehicle, type VehicleDraftInput, type AdminHomeSections, type AvailabilityRequest } from '@hd/contracts/admin';
import { PublicVehicleSchema, type Locale, type PublicVehicle, type PublicVehicleQuery, type PublicMedia } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { locales, normalizeContent } from './content.js';

export type Actor = { id: string; requestId: string };
type Snapshot = Pick<VehicleDraftInput, 'source'|'facts'|'price'|'content'> & { images: PublicMedia[] };
type Row = {
  id: string; stock_number: string; version: number; publication_state: AdminVehicle['publicationState'];
  availability: AdminVehicle['availability']; availability_checked_at: Date|null; published_revision_id: string|null;
  published_at: Date|null; created_at: Date; updated_at: Date; data: VehicleDraftInput;
  publication_data?: Snapshot;
};
const iso = (date: Date|null) => date?.toISOString() ?? null;
const adminSelect = 'SELECT v.*,d.data FROM vehicles v JOIN vehicle_drafts d ON d.vehicle_id=v.id';
const publicSelect = 'SELECT v.*,p.data AS publication_data FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id';
export function toAdmin(row: Row): AdminVehicle {
  return AdminVehicleSchema.parse({ id:row.id, stockCode:`HD-${String(row.stock_number).padStart(6,'0')}`, version:row.version,
    publicationState:row.publication_state, availability:row.availability, availabilityCheckedAt:iso(row.availability_checked_at),
    draft:row.data, publishedRevisionId:row.published_revision_id, publishedAt:iso(row.published_at), createdAt:iso(row.created_at), updatedAt:iso(row.updated_at) });
}
function toPublic(row: Row, locale: Locale): PublicVehicle {
  const p = row.publication_data!;
  const text = (key: 'title'|'description') => {
    const field = p.content[key]; const item = field.translations[locale];
    if (!item || item.reviewStatus !== 'approved' || item.sourceVersion !== field.sourceVersion) return null;
    return {text:item.text, requestedLocale:locale, contentLocale:item.kind==='original'?field.sourceLanguage:locale, kind:item.kind,reviewed:true};
  };
  return PublicVehicleSchema.parse({id:row.id, stockCode:`HD-${String(row.stock_number).padStart(6,'0')}`,
    source:{kind:p.source.kind}, facts:p.facts, price:p.price, content:{title:text('title'),description:text('description')},
    images:p.images, availability:row.availability, availabilityCheckedAt:iso(row.availability_checked_at),
    sourceUpdatedAt:null, fetchedAt:null, publishedAt:iso(row.published_at), detailPath:`/${locale}/cars/${row.id}/`});
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export async function audit(tx: PoolClient, actor: Actor, operation: string, vehicleId: string|null, oldVersion: number|null, newVersion: number|null) {
  await tx.query('INSERT INTO audit_events(id,actor_id,operation,vehicle_id,old_version,new_version,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(),actor.id,operation,vehicleId,oldVersion,newVersion,actor.requestId]);
}
async function idempotent<T>(tx: PoolClient, actor: Actor, operation: string, key: string, input: unknown, work:()=>Promise<T>):Promise<T> {
  const hash = createHash('sha256').update(canonical(input)).digest('hex');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.id}:${operation}:${key}`]);
  const found = await tx.query('SELECT request_hash,response FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3 AND expires_at>now()', [actor.id,operation,key]);
  if (found.rows[0]) {
    if (found.rows[0].request_hash !== hash) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','The key was already used for different input.');
    return found.rows[0].response as T;
  }
  const result = await work();
  await tx.query(`INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours')
    ON CONFLICT(actor_id,operation,key) DO UPDATE SET request_hash=excluded.request_hash,response=excluded.response,expires_at=excluded.expires_at`, [actor.id,operation,key,hash,JSON.stringify(result)]);
  return result;
}
async function lockVehicle(tx: PoolClient, id: string, version?: number): Promise<Row> {
  const result = await tx.query<Row>(`${adminSelect} WHERE v.id=$1 FOR UPDATE OF v`,[id]);
  const row = result.rows[0]; if (!row) throw notFound();
  if (version !== undefined && row.version !== version) throw conflict();
  return row;
}
async function mediaOwnership(tx: PoolClient, id: string, draft: VehicleDraftInput) {
  if (!draft.media.length) return;
  const ids = draft.media.map(m=>m.id);
  const result = await tx.query('SELECT id FROM media_assets WHERE vehicle_id=$1 AND id=ANY($2::uuid[]) AND state<>\'deleted\'', [id,ids]);
  if (result.rowCount !== ids.length) throw new ApiError(422,'MEDIA_NOT_READY','Media must belong to this vehicle and be active.');
}
export class InventoryService {
  constructor(private db: Database) {}
  async getAdmin(id: string) {
    const result = await this.db.pool.query<Row>(`${adminSelect} WHERE v.id=$1`,[id]);
    if (!result.rows[0]) throw notFound(); return toAdmin(result.rows[0]);
  }
  async listAdmin(query: {page:number;pageSize:number;publicationState?:string;availability?:string}) {
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const params: unknown[] = []; const where: string[] = [];
      if (query.publicationState) {params.push(query.publicationState);where.push(`v.publication_state=$${params.length}`);}
      if (query.availability) {params.push(query.availability);where.push(`v.availability=$${params.length}`);}
      const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const count = await tx.query(`SELECT count(*)::int AS total FROM vehicles v${condition}`, params);
      const total:number = count.rows[0].total;
      const rows = await tx.query<Row>(`${adminSelect}${condition} ORDER BY v.created_at DESC,v.id LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params,query.pageSize,(query.page-1)*query.pageSize]);
      return {items:rows.rows.map(toAdmin),page:query.page,pageSize:query.pageSize,total,hasMore:query.page*query.pageSize<total};
    });
  }
  async create(draft: VehicleDraftInput, actor: Actor, key: string) {
    return this.db.transaction(tx=>idempotent(tx,actor,'vehicle.create',key,draft,async()=>{
      const id=randomUUID();
      if (draft.media.length) throw new ApiError(422,'MEDIA_NOT_READY','Create the vehicle before uploading images.');
      const normalized=normalizeContent(draft);
      await tx.query('INSERT INTO vehicles(id) VALUES($1)',[id]);
      await tx.query('INSERT INTO vehicle_drafts(vehicle_id,data) VALUES($1,$2)',[id,JSON.stringify(normalized)]);
      await audit(tx,actor,'vehicle.create',id,null,1);
      return toAdmin(await lockVehicle(tx,id));
    }));
  }
  async save(id:string,version:number,draft:VehicleDraftInput,actor:Actor) {
    return this.db.transaction(async tx=>{
      const row=await lockVehicle(tx,id,version); await mediaOwnership(tx,id,draft);
      const normalized=normalizeContent(draft,row.data);
      await tx.query('UPDATE vehicle_drafts SET data=$2 WHERE vehicle_id=$1',[id,JSON.stringify(normalized)]);
      await tx.query('UPDATE vehicles SET version=version+1,updated_at=now() WHERE id=$1',[id]);
      await audit(tx,actor,'vehicle.save',id,version,version+1);
      return toAdmin(await lockVehicle(tx,id));
    });
  }
  async publish(id:string,version:number,actor:Actor,key:string) {
    return this.db.transaction(tx=>idempotent(tx,actor,`vehicle.publish:${id}`,key,{id,version},async()=>{
      const row=await lockVehicle(tx,id,version);const draft=row.data;
      const fields:Array<{path:string;code:string;message:string}>=[];
      const missing=(path:string,message:string)=>fields.push({path,code:'REQUIRED_FOR_PUBLICATION',message});
      if (!draft.facts.make) missing('draft.facts.make','Make is required.');
      if (!draft.facts.model) missing('draft.facts.model','Model is required.');
      if (!draft.facts.location) missing('draft.facts.location','Location country is required.');
      if (!draft.content.title.sourceText?.trim()) missing('draft.content.title.sourceText','Original title is required.');
      if (row.availability==='unknown' || !row.availability_checked_at) missing('availability','Verify availability before publishing.');
      for (const locale of locales) for (const name of ['title','description'] as const) {
        const field=draft.content[name]; const translated=field.translations[locale];
        if (name==='description' && field.sourceText===null && locales.every(l=>field.translations[l]===null)) continue;
        if (!translated?.text.trim() || translated.reviewStatus!=='approved' || translated.sourceVersion!==field.sourceVersion)
          missing(`draft.content.${name}.translations.${locale}`,'A reviewed translation of the current source is required.');
      }
      if (draft.media.filter(m=>m.isCover).length!==1) missing('draft.media','One ready cover is required.');
      const media=await tx.query('SELECT * FROM media_assets WHERE vehicle_id=$1 AND state=\'ready\' AND id=ANY($2::uuid[]) FOR UPDATE',[id,draft.media.map(m=>m.id)]);
      if (media.rowCount!==draft.media.length) missing('draft.media','Every referenced image must be processed and ready.');
      if (fields.length) throw new ApiError(422,'PUBLISH_VALIDATION_FAILED','Vehicle is not ready to publish.',fields);
      const images=draft.media.map(m=>{
        const stored=media.rows.find(r=>r.id===m.id)!;
        return {id:m.id,url:`/api/v1/media/${m.id}`,alt:m.alt,sortOrder:m.sortOrder,isCover:m.isCover,width:stored.width,height:stored.height};
      }).sort((a,b)=>a.sortOrder-b.sortOrder);
      const snapshot:Snapshot={source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,images};
      const publicationId=randomUUID();
      await tx.query('INSERT INTO vehicle_publications(id,vehicle_id,data) VALUES($1,$2,$3)',[publicationId,id,JSON.stringify(snapshot)]);
      for (const m of images) await tx.query('INSERT INTO publication_media(publication_id,media_id) VALUES($1,$2)',[publicationId,m.id]);
      await tx.query(`UPDATE vehicles SET published_revision_id=$2,publication_state='published',published_at=now(),version=version+1,updated_at=now() WHERE id=$1`,[id,publicationId]);
      await audit(tx,actor,'vehicle.publish',id,version,version+1);
      return toAdmin(await lockVehicle(tx,id));
    }));
  }
  async availability(id:string,input:AvailabilityRequest,actor:Actor) {
    if (Date.parse(input.checkedAt)>Date.now()+60_000) throw new ApiError(400,'INVALID_REQUEST','Availability check cannot be in the future.');
    return this.db.transaction(async tx=>{
      await lockVehicle(tx,id,input.version);
      await tx.query('UPDATE vehicles SET availability=$2,availability_checked_at=$3,version=version+1,updated_at=now() WHERE id=$1',[id,input.availability,input.checkedAt]);
      await audit(tx,actor,'vehicle.availability',id,input.version,input.version+1);
      return toAdmin(await lockVehicle(tx,id));
    });
  }
  async archive(id:string,version:number,actor:Actor) {
    return this.db.transaction(async tx=>{
      await lockVehicle(tx,id,version);
      await tx.query(`UPDATE vehicles SET publication_state='archived',version=version+1,updated_at=now() WHERE id=$1`,[id]);
      await audit(tx,actor,'vehicle.archive',id,version,version+1);
      return toAdmin(await lockVehicle(tx,id));
    });
  }
  async getPublic(id:string,locale:Locale) {
    const result=await this.db.pool.query<Row>(`${publicSelect} WHERE v.id=$1 AND v.publication_state='published'`,[id]);
    if (!result.rows[0]) throw notFound();return toPublic(result.rows[0],locale);
  }
  async listPublic(query:PublicVehicleQuery,requestId:string) {
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const params:unknown[]=[];const conditions=["v.publication_state='published'","v.availability IN ('available','reserved')"];
      for(const [key,jsonPath] of [['make',"p.data->'facts'->'make'->>'id'"],['model',"p.data->'facts'->'model'->>'id'"],['powertrain',"p.data->'facts'->>'powertrain'"]] as const) {
        if(query[key]) {params.push(query[key]);conditions.push(`${jsonPath}=$${params.length}`);}
      }
      const where=` WHERE ${conditions.join(' AND ')}`;
      const count=await tx.query(`SELECT count(*)::int AS total FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id${where}`,params);
      const total:number=count.rows[0].total;
      const result=await tx.query<Row>(`${publicSelect}${where} ORDER BY v.published_at DESC,v.id LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,query.pageSize,(query.page-1)*query.pageSize]);
      return {data:{items:result.rows.map(r=>toPublic(r,query.locale)),page:query.page,pageSize:query.pageSize,hasMore:query.page*query.pageSize<total},
        meta:{requestId,catalog:'curated' as const,total,totalKind:'exact' as const,accessibleTotal:total,dataAsOf:new Date().toISOString(),freshness:'fresh' as const}};
    });
  }
  async filters() {
    const result=await this.db.pool.query(`SELECT p.data->'facts' AS facts FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id WHERE v.publication_state='published' AND v.availability IN ('available','reserved')`);
    const makes=new Map<string,{id:string;name:string;count:number}>();const models=new Map<string,{id:string;name:string;makeId:string;count:number}>();
    const powers=new Map<PublicVehicle['facts']['powertrain'],number>();
    for(const {facts} of result.rows) {
      const make=facts.make;const model=facts.model;
      if(make) makes.set(make.id,{id:make.id,name:make.name,count:(makes.get(make.id)?.count??0)+1});
      if(model&&make) {const key=`${make.id}:${model.id}`;models.set(key,{id:model.id,name:model.name,makeId:make.id,count:(models.get(key)?.count??0)+1});}
      powers.set(facts.powertrain,(powers.get(facts.powertrain)??0)+1);
    }
    return {catalog:'curated' as const,makes:[...makes.values()].sort((a,b)=>a.id.localeCompare(b.id)),models:[...models.values()].sort((a,b)=>a.id.localeCompare(b.id)),powertrains:[...powers].map(([id,count])=>({id,count})).sort((a,b)=>a.id.localeCompare(b.id))};
  }
  async getHome():Promise<AdminHomeSections> {
    return (await this.db.pool.query('SELECT version,sections FROM home_config WHERE id=1')).rows[0];
  }
  async saveHome(input:AdminHomeSections,actor:Actor) {
    return this.db.transaction(async tx=>{
      const current=(await tx.query('SELECT version FROM home_config WHERE id=1 FOR UPDATE')).rows[0];
      if(current.version!==input.version) throw conflict();
      const ids=[...new Set(input.sections.flatMap(s=>s.vehicleIds))].sort();
      const valid=await tx.query("SELECT id FROM vehicles WHERE id=ANY($1::uuid[]) AND publication_state='published' AND availability='available' ORDER BY id FOR UPDATE",[ids]);
      if(valid.rowCount!==ids.length) throw new ApiError(422,'PUBLISH_VALIDATION_FAILED','Home sections require published available vehicles.');
      await tx.query('UPDATE home_config SET sections=$1,version=version+1 WHERE id=1',[JSON.stringify(input.sections)]);
      await audit(tx,actor,'home.save',null,input.version,input.version+1);
      return {version:input.version+1,sections:input.sections};
    });
  }
  async publicHome(locale:Locale) {
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const config=(await tx.query('SELECT sections FROM home_config WHERE id=1')).rows[0] as Pick<AdminHomeSections,'sections'>;
      const ids=[...new Set(config.sections.flatMap(s=>s.vehicleIds))];
      const rows=await tx.query<Row>(`${publicSelect} WHERE v.id=ANY($1::uuid[]) AND v.publication_state='published' AND v.availability='available'`,[ids]);
      const map=new Map(rows.rows.map(r=>[r.id,toPublic(r,locale)]));
      return {sections:config.sections.map(s=>({id:s.id,title:s.title[locale],vehicles:s.vehicleIds.map(id=>map.get(id)).filter((v):v is PublicVehicle=>!!v)})).filter(s=>s.vehicles.length)};
    });
  }
}
