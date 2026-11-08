import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AdminVehicleSchema, VehicleDraftInputSchema, BulkVehicleMutationResponseSchema, type AdminVehicle, type AdminVehicleQuery, type VehicleDraftInput, type AdminHomeSections, type AvailabilityRequest,
  type BulkVehicleMutationRequest, type BulkVehicleMutationResult, type AdminVehicleFiltersQuery } from '@hd/contracts/admin';
import { PublicVehicleSchema, type Locale, type PublicVehicle, type PublicVehicleQuery, type PublicFilterQuery, type PublicMedia } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { locales, normalizeContent } from './content.js';

export type Actor = { id: string; requestId: string };
type Snapshot = Pick<VehicleDraftInput, 'source'|'facts'|'price'|'content'> & { images: PublicMedia[] };
type Row = {
  id: string; stock_number: string; version: number; publication_state: AdminVehicle['publicationState'];
  availability: AdminVehicle['availability']; availability_checked_at: Date|null; published_revision_id: string|null;
  published_at: Date|null; deleted_at: Date|null; created_at: Date; updated_at: Date; data: VehicleDraftInput;
  publication_data?: Snapshot;
};
const iso = (date: Date|null) => date?.toISOString() ?? null;
const adminSelect = 'SELECT v.*,d.data FROM vehicles v JOIN vehicle_drafts d ON d.vehicle_id=v.id';
const publicSelect = 'SELECT v.*,p.data AS publication_data FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id';
const unverifiedVisible = "(p.data->'source'->>'kind' IN ('demo','external') AND v.availability='unknown' AND v.availability_checked_at IS NULL)";
const catalogVisible = `v.deleted_at IS NULL AND v.publication_state='published' AND ((p.data->'source'->>'kind'='manual' AND v.availability IN ('available','reserved')) OR ${unverifiedVisible})`;
const homeVisible = `v.deleted_at IS NULL AND v.publication_state='published' AND ((p.data->'source'->>'kind'='manual' AND v.availability='available') OR ${unverifiedVisible})`;
export function toAdmin(row: Row): AdminVehicle {
  return AdminVehicleSchema.parse({ id:row.id, stockCode:`HD-${String(row.stock_number).padStart(6,'0')}`, version:row.version,
    publicationState:row.publication_state, availability:row.availability, availabilityCheckedAt:iso(row.availability_checked_at),
    deletedAt:iso(row.deleted_at), draft:row.data, publishedRevisionId:row.published_revision_id, publishedAt:iso(row.published_at), createdAt:iso(row.created_at), updatedAt:iso(row.updated_at) });
}
function toPublic(row: Row, locale: Locale): PublicVehicle {
  const p = row.publication_data!;
  const text = (key: 'title'|'description') => {
    const field = p.content[key]; const item = field.translations[locale];
    const curated=p.source.kind==='manual';
    if (!item || (curated?item.reviewStatus!=='approved':item.reviewStatus==='stale') || item.sourceVersion !== field.sourceVersion) return null;
    return {text:item.text, requestedLocale:locale, contentLocale:item.kind==='original'?field.sourceLanguage:locale, kind:item.kind,reviewed:curated};
  };
  return PublicVehicleSchema.parse({id:row.id, stockCode:`HD-${String(row.stock_number).padStart(6,'0')}`,
    source:p.source.kind==='external'?{kind:'external',platform:p.source.platform,listingUrl:p.source.listingUrl}:{kind:p.source.kind},
    facts:p.facts, price:p.price, content:{title:text('title'),description:text('description')},
    images:p.images, availability:row.availability, availabilityCheckedAt:iso(row.availability_checked_at),
    sourceUpdatedAt:p.source.kind==='external'?p.source.sourceUpdatedAt:null, fetchedAt:p.source.kind==='external'?p.source.collectedAt:null,
    publishedAt:iso(row.published_at), detailPath:`/${locale}/cars/${row.id}/`});
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
    // Historical receipts are immutable business results, not current records.
    // Parse old vehicle receipts so newly added optional/defaulted fields are supplied before serialization.
    if(operation==='vehicle.create' || ['vehicle.publish:','vehicle.delete:','vehicle.restore:'].some(prefix=>operation.startsWith(prefix)))
      return AdminVehicleSchema.parse(found.rows[0].response) as T;
    return found.rows[0].response as T;
  }
  const result = await work();
  await tx.query(`INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours')
    ON CONFLICT(actor_id,operation,key) DO UPDATE SET request_hash=excluded.request_hash,response=excluded.response,expires_at=excluded.expires_at`, [actor.id,operation,key,hash,JSON.stringify(result)]);
  return result;
}
async function lockVehicle(tx: PoolClient, id: string, version?: number, includeDeleted=false): Promise<Row> {
  const result = await tx.query<Row>(`${adminSelect} WHERE v.id=$1 FOR UPDATE OF v`,[id]);
  const row = result.rows[0]; if (!row || (row.deleted_at && !includeDeleted)) throw notFound();
  if (version !== undefined && row.version !== version) throw conflict();
  return row;
}
async function mediaOwnership(tx: PoolClient, id: string, draft: VehicleDraftInput) {
  if (!draft.media.length) return;
  const ids = draft.media.map(m=>m.id);
  const result = await tx.query('SELECT id FROM media_assets WHERE vehicle_id=$1 AND id=ANY($2::uuid[]) AND state<>\'deleted\'', [id,ids]);
  if (result.rowCount !== ids.length) throw new ApiError(422,'MEDIA_NOT_READY','Media must belong to this vehicle and be active.');
}
function requireInventory(row:Row) {
  if(row.data.source.kind==='demo') throw new ApiError(422,'DEMO_RESTRICTION','Display examples are not inventory and cannot be availability-verified.');
  if(row.data.source.kind!=='manual') throw new ApiError(422,'EXTERNAL_RESTRICTION','External listings are reference records and cannot be availability-verified as our inventory.');
}
async function updateAvailability(tx:PoolClient,row:Row,input:AvailabilityRequest,actor:Actor) {
  requireInventory(row);
  await tx.query('UPDATE vehicles SET availability=$2,availability_checked_at=$3,version=version+1,updated_at=now() WHERE id=$1',[row.id,input.availability,input.checkedAt]);
  await audit(tx,actor,'vehicle.availability',row.id,row.version,row.version+1);
  return lockVehicle(tx,row.id);
}
async function archiveVehicle(tx:PoolClient,row:Row,actor:Actor) {
  await tx.query("UPDATE vehicles SET publication_state='archived',version=version+1,updated_at=now() WHERE id=$1",[row.id]);
  await audit(tx,actor,'vehicle.archive',row.id,row.version,row.version+1);
  return lockVehicle(tx,row.id);
}
function vehicleOptions(factsRows:VehicleDraftInput['facts'][],selectedMake?:string) {
  const makes=new Map<string,{id:string;name:string;count:number}>();
  const models=new Map<string,{id:string;name:string;makeId:string;count:number}>();
  const powers=new Map<PublicVehicle['facts']['powertrain'],number>();
  // Rows arrive newest first; retain that display name when historical names differ.
  for(const facts of factsRows) {
    const make=facts.make;const model=facts.model;
    if(make) {const old=makes.get(make.id);makes.set(make.id,{id:make.id,name:old?.name??make.name,count:(old?.count??0)+1});}
    if(model&&make) {const key=`${make.id}:${model.id}`,old=models.get(key);models.set(key,{id:model.id,name:old?.name??model.name,makeId:make.id,count:(old?.count??0)+1});}
    powers.set(facts.powertrain,(powers.get(facts.powertrain)??0)+1);
  }
  return {makes:[...makes.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    models:[...models.values()].filter(m=>!selectedMake||m.makeId===selectedMake).sort((a,b)=>a.makeId.localeCompare(b.makeId)||a.id.localeCompare(b.id)),
    powertrains:[...powers].map(([id,count])=>({id,count})).sort((a,b)=>a.id.localeCompare(b.id))};
}
function publicSearch(query:Pick<PublicVehicleQuery,'q'|'locale'>,params:unknown[]):string|null {
  const keyword=query.q?.trim();if(!keyword) return null;
  params.push(query.locale);const localeParameter=`$${params.length}::text`;
  params.push(keyword);const searchParameter=`$${params.length}`;
  const fields=["'HD-' || lpad(v.stock_number::text,greatest(6,length(v.stock_number::text)),'0')",
    "p.data->'facts'->'make'->>'name'","p.data->'facts'->'model'->>'name'",
    `p.data->'content'->'title'->'translations'->${localeParameter}->>'text'`];
  return `(${fields.map(field=>`strpos(lower(coalesce(${field},'')),lower(${searchParameter}))>0`).join(' OR ')})`;
}
export class InventoryService {
  constructor(private db: Database) {}
  async getAdmin(id: string, includeDeleted=false) {
    const result = await this.db.pool.query<Row>(`${adminSelect} WHERE v.id=$1${includeDeleted ? '' : ' AND v.deleted_at IS NULL'}`,[id]);
    if (!result.rows[0]) throw notFound(); return toAdmin(result.rows[0]);
  }
  async listAdmin(query: AdminVehicleQuery) {
    return this.db.transaction(async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const params: unknown[] = []; const where: string[] = [query.deleted==='only' ? 'v.deleted_at IS NOT NULL' : 'v.deleted_at IS NULL'];
      if (query.publicationState) {params.push(query.publicationState);where.push(`v.publication_state=$${params.length}`);}
      if (query.availability) {params.push(query.availability);where.push(`v.availability=$${params.length}`);}
      for (const [key,jsonPath] of [['make',"d.data->'facts'->'make'->>'id'"],['model',"d.data->'facts'->'model'->>'id'"],['powertrain',"d.data->'facts'->>'powertrain'"]] as const) {
        if (query[key]) {params.push(query[key]);where.push(`${jsonPath}=$${params.length}`);}
      }
      const keyword=query.q?.trim();
      if (keyword) {
        params.push(keyword);
        const fields=["'HD-' || lpad(v.stock_number::text,greatest(6,length(v.stock_number::text)),'0')",
          "d.data->'facts'->'make'->>'name'","d.data->'facts'->'model'->>'name'","d.data->'content'->'title'->>'sourceText'"];
        // Literal substring search: user %, _ and backslashes are not SQL wildcards.
        where.push(`(${fields.map(field=>`strpos(lower(coalesce(${field},'')),lower($${params.length}))>0`).join(' OR ')})`);
      }
      const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const count = await tx.query(`SELECT count(*)::int AS total FROM vehicles v JOIN vehicle_drafts d ON d.vehicle_id=v.id${condition}`, params);
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
      if(row.data.source.kind!==draft.source.kind) throw new ApiError(422,
        row.data.source.kind==='external'||draft.source.kind==='external'?'EXTERNAL_RESTRICTION':'DEMO_RESTRICTION',
        'Source type cannot be changed after creation; create a separate record.');
      if(row.data.source.kind==='external' && draft.source.kind==='external' &&
        (row.data.source.platform.id!==draft.source.platform.id || row.data.source.externalId!==draft.source.externalId))
        throw new ApiError(422,'EXTERNAL_RESTRICTION','Platform identity cannot be changed after creation; update the existing listing metadata.');
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
      if (draft.source.kind==='manual' && !draft.facts.location) missing('draft.facts.location','Location country is required.');
      if (!draft.content.title.sourceText?.trim()) missing('draft.content.title.sourceText','Original title is required.');
      if(draft.source.kind!=='manual') {
        if(row.availability!=='unknown'||row.availability_checked_at!==null) missing('availability','Display examples must remain unverified, non-inventory records.');
        const valid=VehicleDraftInputSchema.safeParse(draft);
        if(!valid.success) for(const issue of valid.error.issues) missing(`draft.${issue.path.join('.')}`,'Source metadata or reference-record facts are invalid.');
      } else if (row.availability==='unknown' || !row.availability_checked_at) missing('availability','Verify availability before publishing.');
      for (const locale of locales) for (const name of ['title','description'] as const) {
        const field=draft.content[name]; const translated=field.translations[locale];
        if (name==='description' && field.sourceText===null && locales.every(l=>field.translations[l]===null)) continue;
        if (!translated?.text.trim() || (draft.source.kind==='manual'?translated.reviewStatus!=='approved':translated.reviewStatus==='stale') || translated.sourceVersion!==field.sourceVersion)
          missing(`draft.content.${name}.translations.${locale}`,draft.source.kind==='manual'?'A reviewed translation of the current source is required.':'Current, non-stale reference text is required.');
        if(translated?.kind==='original' && (locale!==field.sourceLanguage.split('-')[0] || translated.text!==field.sourceText))
          missing(`draft.content.${name}.translations.${locale}.kind`,'Original text must match the source text and base language.');
      }
      if (draft.media.filter(m=>m.isCover).length!==1) missing('draft.media','One ready cover is required.');
      const media=await tx.query('SELECT * FROM media_assets WHERE vehicle_id=$1 AND state=\'ready\' AND id=ANY($2::uuid[]) FOR UPDATE',[id,draft.media.map(m=>m.id)]);
      if (media.rowCount!==draft.media.length) missing('draft.media','Every referenced image must be processed and ready.');
      if(draft.source.kind==='external') for(const stored of media.rows) {
        if(!stored.rights?.source || stored.rights.source.listingUrl!==draft.source.listingUrl)
          missing(`draft.media.${stored.id}`,'External photos require provenance for this same listing.');
      }
      else if(media.rows.some(stored=>stored.rights?.basis==='unverified'))
        missing('draft.media','Manual inventory and display examples require declared image ownership or permission.');
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
      const row=await lockVehicle(tx,id,input.version);
      return toAdmin(await updateAvailability(tx,row,input,actor));
    });
  }
  async archive(id:string,version:number,actor:Actor) {
    return this.db.transaction(async tx=>{
      const row=await lockVehicle(tx,id,version);
      return toAdmin(await archiveVehicle(tx,row,actor));
    });
  }
  async remove(id:string,version:number,actor:Actor,key:string) {
    id=id.toLowerCase();
    return this.db.transaction(tx=>idempotent(tx,actor,`vehicle.delete:${id}`,key,{id,version},async()=>{
      // saveHome uses this same order: home row, then vehicle rows, then media rows.
      const home=(await tx.query<AdminHomeSections>('SELECT version,sections FROM home_config WHERE id=1 FOR UPDATE')).rows[0]!;
      const row=await lockVehicle(tx,id,version);
      const sections=home.sections.map(section=>({...section,vehicleIds:section.vehicleIds.filter(value=>value.toLowerCase()!==id)}));
      if(sections.some((section,index)=>section.vehicleIds.length!==home.sections[index]!.vehicleIds.length)) {
        await tx.query('UPDATE home_config SET sections=$1,version=version+1 WHERE id=1',[JSON.stringify(sections)]);
        await audit(tx,actor,'home.removeDeletedVehicle',null,home.version,home.version+1);
      }
      await tx.query('UPDATE vehicles SET deleted_at=now(),deleted_by=$2,version=version+1,updated_at=now() WHERE id=$1',[id,actor.id]);
      await audit(tx,actor,'vehicle.delete',id,row.version,row.version+1);
      return toAdmin(await lockVehicle(tx,id,undefined,true));
    }));
  }
  async restore(id:string,version:number,actor:Actor,key:string) {
    id=id.toLowerCase();
    return this.db.transaction(tx=>idempotent(tx,actor,`vehicle.restore:${id}`,key,{id,version},async()=>{
      const row=await lockVehicle(tx,id,version,true);
      if(!row.deleted_at) throw conflict();
      await tx.query(`UPDATE vehicles SET deleted_at=NULL,deleted_by=NULL,publication_state='draft',
        published_revision_id=NULL,published_at=NULL,availability='unknown',availability_checked_at=NULL,
        version=version+1,updated_at=now() WHERE id=$1`,[id]);
      await audit(tx,actor,'vehicle.restore',id,row.version,row.version+1);
      return toAdmin(await lockVehicle(tx,id));
    }));
  }
  async bulk(input:BulkVehicleMutationRequest,actor:Actor,key:string) {
    if(input.operation==='availability' && Date.parse(input.checkedAt)>Date.now()+60_000) throw new ApiError(400,'INVALID_REQUEST','Availability check cannot be in the future.');
    return this.db.transaction(tx=>idempotent(tx,actor,'vehicle.bulk',key,input,async()=>{
      const ids=input.items.map(item=>item.id.toLowerCase()).sort();
      const locked=await tx.query<Row>(`${adminSelect} WHERE v.id=ANY($1::uuid[]) ORDER BY v.id FOR UPDATE OF v`,[ids]);
      const rows=new Map(locked.rows.map(row=>[row.id,row]));
      const results:BulkVehicleMutationResult[]=[];
      for(const item of input.items) {
        let row:Row;
        try {
          const found=rows.get(item.id.toLowerCase());if(!found || found.deleted_at) throw notFound();row=found;
          if(row.version!==item.expectedVersion) throw conflict();
          if(input.operation==='availability') requireInventory(row);
        } catch(error) {
          // Only pre-mutation business failures are per-row; SQL/audit failures abort the whole transaction.
          if(error instanceof ApiError && (error.code==='NOT_FOUND'||error.code==='VERSION_CONFLICT'||error.code==='DEMO_RESTRICTION'||error.code==='EXTERNAL_RESTRICTION'))
            {results.push({id:item.id,status:'failed',error:{code:error.code,message:error.message,retryable:false}});continue;}
          else throw error;
        }
        const updated=input.operation==='archive'?await archiveVehicle(tx,row,actor):await updateAvailability(tx,row,{version:item.expectedVersion,availability:input.availability,checkedAt:input.checkedAt},actor);
        results.push({id:item.id,status:'succeeded',version:updated.version,publicationState:updated.publication_state,availability:updated.availability,availabilityCheckedAt:iso(updated.availability_checked_at)});
      }
      const succeeded=results.filter(r=>r.status==='succeeded').length;
      return BulkVehicleMutationResponseSchema.shape.data.parse({operation:input.operation,results,summary:{total:results.length,succeeded,failed:results.length-succeeded}});
    }));
  }
  async adminFilters(query:AdminVehicleFiltersQuery) {
    const result=await this.db.pool.query<{facts:VehicleDraftInput['facts']}>("SELECT d.data->'facts' AS facts FROM vehicles v JOIN vehicle_drafts d ON d.vehicle_id=v.id WHERE v.deleted_at IS NULL ORDER BY v.updated_at DESC,v.id");
    return {scope:'all_inventory' as const,...vehicleOptions(result.rows.map(row=>row.facts),query.make)};
  }
  async getPublic(id:string,locale:Locale) {
    const result=await this.db.pool.query<Row>(`${publicSelect} WHERE v.id=$1 AND v.deleted_at IS NULL AND v.publication_state='published'`,[id]);
    if (!result.rows[0]) throw notFound();return toPublic(result.rows[0],locale);
  }
  async listPublic(query:PublicVehicleQuery,requestId:string) {
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const params:unknown[]=[];const conditions=[catalogVisible];
      for(const [key,jsonPath] of [['make',"p.data->'facts'->'make'->>'id'"],['model',"p.data->'facts'->'model'->>'id'"],['powertrain',"p.data->'facts'->>'powertrain'"]] as const) {
        if(query[key]) {params.push(query[key]);conditions.push(`${jsonPath}=$${params.length}`);}
      }
      const search=publicSearch(query,params);if(search) conditions.push(search);
      const where=` WHERE ${conditions.join(' AND ')}`;
      const count=await tx.query(`SELECT count(*)::int AS total FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id${where}`,params);
      const total:number=count.rows[0].total;
      const result=await tx.query<Row>(`${publicSelect}${where} ORDER BY v.published_at DESC,v.id LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,query.pageSize,(query.page-1)*query.pageSize]);
      return {data:{items:result.rows.map(r=>toPublic(r,query.locale)),page:query.page,pageSize:query.pageSize,hasMore:query.page*query.pageSize<total},
        meta:{requestId,catalog:'curated' as const,total,totalKind:'exact' as const,accessibleTotal:total,dataAsOf:new Date().toISOString(),freshness:'fresh' as const}};
    });
  }
  async filters(query:PublicFilterQuery) {
    const params:unknown[]=[];const search=publicSearch(query,params);
    const result=await this.db.pool.query<{facts:VehicleDraftInput['facts']}>(`SELECT p.data->'facts' AS facts FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id WHERE ${catalogVisible}${search?` AND ${search}`:''} ORDER BY v.published_at DESC,v.id`,params);
    return {catalog:'curated' as const,...vehicleOptions(result.rows.map(row=>row.facts))};
  }
  async getHome():Promise<AdminHomeSections> {
    return (await this.db.pool.query('SELECT version,sections FROM home_config WHERE id=1')).rows[0];
  }
  async saveHome(input:AdminHomeSections,actor:Actor) {
    return this.db.transaction(async tx=>{
      const current=(await tx.query('SELECT version FROM home_config WHERE id=1 FOR UPDATE')).rows[0];
      if(current.version!==input.version) throw conflict();
      const sections=input.sections.map(section=>({...section,vehicleIds:section.vehicleIds.map(id=>id.toLowerCase())}));
      const ids=[...new Set(sections.flatMap(s=>s.vehicleIds))].sort();
      const valid=await tx.query(`SELECT v.id FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id WHERE v.id=ANY($1::uuid[]) AND ${homeVisible} ORDER BY v.id FOR UPDATE OF v`,[ids]);
      if(valid.rowCount!==ids.length) throw new ApiError(422,'PUBLISH_VALIDATION_FAILED','Home sections require published available vehicles.');
      await tx.query('UPDATE home_config SET sections=$1,version=version+1 WHERE id=1',[JSON.stringify(sections)]);
      await audit(tx,actor,'home.save',null,input.version,input.version+1);
      return {version:input.version+1,sections};
    });
  }
  async publicHome(locale:Locale) {
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const config=(await tx.query('SELECT sections FROM home_config WHERE id=1')).rows[0] as Pick<AdminHomeSections,'sections'>;
      const ids=[...new Set(config.sections.flatMap(s=>s.vehicleIds).map(id=>id.toLowerCase()))];
      const rows=await tx.query<Row>(`${publicSelect} WHERE v.id=ANY($1::uuid[]) AND ${homeVisible}`,[ids]);
      const map=new Map(rows.rows.map(r=>[r.id,toPublic(r,locale)]));
      return {sections:config.sections.map(s=>({id:s.id,title:s.title[locale],vehicles:s.vehicleIds.map(id=>map.get(id.toLowerCase())).filter((v):v is PublicVehicle=>!!v)})).filter(s=>s.vehicles.length)};
    });
  }
}
