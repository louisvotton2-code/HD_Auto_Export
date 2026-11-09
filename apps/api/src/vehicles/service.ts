import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AdminVehicleSchema, VehicleDraftInputSchema, VehicleTranslationSuggestionsSchema, BulkVehicleMutationResponseSchema, type AdminVehicle, type AdminVehicleQuery, type VehicleDraftInput, type AdminHomeSections, type AvailabilityRequest,
  type BulkVehicleMutationRequest, type BulkVehicleMutationResult, type AdminVehicleFiltersQuery,
  VehicleLocalizationSchema, DisplayTranslationSuggestionsSchema, BRAND_CATALOG, normalizeBrandAlias, type LocalizationData, type VehicleLocalization, type SaveVehicleLocalization, type GenerateDisplayTranslations } from '@hd/contracts/admin';
import { PublicVehicleSchema, type Locale, type PublicVehicle, type PublicVehicleQuery, type PublicFilterQuery, type PublicMedia } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { locales, normalizeContent } from './content.js';
import type { VehicleTranslator } from './translation.js';
import {emptyLocalization,syncLocalization,applyLocalizationInput,validateLocalizationPublication,projectDisplay,type StoredLocalization,type PublishedLocalization,type DisplayProjection} from './localization.js';
import { countExternal, externalFacetRows, getExternalPublic, listExternal, listingUuid } from '../external/catalog.js';

export type Actor = { id: string; requestId: string };
type Snapshot = Pick<VehicleDraftInput, 'source'|'facts'|'price'|'content'> & { images: PublicMedia[] };
type Row = {
  id: string; stock_number: string; version: number; publication_state: AdminVehicle['publicationState'];
  availability: AdminVehicle['availability']; availability_checked_at: Date|null; published_revision_id: string|null;
  published_at: Date|null; deleted_at: Date|null; created_at: Date; updated_at: Date; data: VehicleDraftInput;
  publication_data?: Snapshot;
  localization_revision?:number;localization_data?:LocalizationData;localization_bindings?:Record<string,string>;retired_fields?:StoredLocalization['retiredFields'];
  published_localization?:LocalizationData;published_bindings?:Record<string,string>;projections?:Record<Locale,DisplayProjection>;
};
const iso = (date: Date|null) => date?.toISOString() ?? null;
const adminSelect = 'SELECT v.*,d.data,p.data AS publication_data,l.revision AS localization_revision,l.data AS localization_data,l.bindings AS localization_bindings,l.retired_fields,pl.data AS published_localization FROM vehicles v JOIN vehicle_drafts d ON d.vehicle_id=v.id LEFT JOIN vehicle_publications p ON p.id=v.published_revision_id LEFT JOIN vehicle_localizations l ON l.vehicle_id=v.id LEFT JOIN publication_localizations pl ON pl.publication_id=p.id';
const publicFrom='FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id LEFT JOIN publication_localizations pl ON pl.publication_id=p.id';
const publicSelect = `SELECT v.*,p.data AS publication_data,pl.data AS published_localization,pl.bindings AS published_bindings,pl.projections ${publicFrom}`;
const unverifiedVisible = "(p.data->'source'->>'kind' IN ('demo','external') AND v.availability='unknown' AND v.availability_checked_at IS NULL)";
const catalogVisible = `v.deleted_at IS NULL AND v.publication_state='published' AND ((p.data->'source'->>'kind'='manual' AND v.availability IN ('available','reserved')) OR ${unverifiedVisible})`;
const homeVisible = `v.deleted_at IS NULL AND v.publication_state='published' AND ((p.data->'source'->>'kind'='manual' AND v.availability='available') OR ${unverifiedVisible})`;
export function toAdmin(row: Row): AdminVehicle {
  return AdminVehicleSchema.parse({ id:row.id, stockCode:`HD-${String(row.stock_number).padStart(6,'0')}`, version:row.version,
    publicationState:row.publication_state, availability:row.availability, availabilityCheckedAt:iso(row.availability_checked_at),
    deletedAt:iso(row.deleted_at), hasUnpublishedChanges:hasUnpublishedChanges(row.data,row.publication_data,row.localization_data,row.published_localization), draft:row.data, publishedRevisionId:row.published_revision_id, publishedAt:iso(row.published_at), createdAt:iso(row.created_at), updatedAt:iso(row.updated_at) });
}
function toPublic(row: Row, locale: Locale,view?:'legacy'|'localized'): PublicVehicle {
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
    publishedAt:iso(row.published_at), detailPath:`/${locale}/cars/${row.id}/`,
    ...(view==='localized'?(row.projections?.[locale]??projectDisplay(row.id,p,locale)):{}),
  });
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
/** Compare only publication content. Availability is live state, internal data never enters a snapshot. */
export function hasUnpublishedChanges(draft:VehicleDraftInput,snapshot?:Snapshot,localization?:LocalizationData,publishedLocalization?:LocalizationData):boolean {
  if(!snapshot) return true;
  if(canonical(localization??null)!==canonical(publishedLocalization??null))return true;
  const media=(items:VehicleDraftInput['media'])=>items.map(({id,alt,sortOrder,isCover})=>({id,alt,sortOrder,isCover})).sort((a,b)=>a.sortOrder-b.sortOrder);
  return canonical({source:draft.source,facts:draft.facts,price:draft.price,content:draft.content,media:media(draft.media)}) !==
    canonical({source:snapshot.source,facts:snapshot.facts,price:snapshot.price,content:snapshot.content,media:media(snapshot.images)});
}
export async function audit(tx: PoolClient, actor: Actor, operation: string, vehicleId: string|null, oldVersion: number|null, newVersion: number|null) {
  await tx.query('INSERT INTO audit_events(id,actor_id,operation,vehicle_id,old_version,new_version,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(),actor.id,operation,vehicleId,oldVersion,newVersion,actor.requestId]);
}
export async function idempotent<T>(tx: PoolClient, actor: Actor, operation: string, key: string, input: unknown, work:()=>Promise<T>):Promise<T> {
  const hash = createHash('sha256').update(canonical(input)).digest('hex');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.id}:${operation}:${key}`]);
  const found = await tx.query('SELECT k.request_hash,k.response,m.has_unpublished_changes FROM idempotency_keys k LEFT JOIN idempotency_vehicle_metadata m ON m.actor_id=k.actor_id AND m.operation=k.operation AND m.key=k.key AND m.receipt_hash=md5(k.response::text) WHERE k.actor_id=$1 AND k.operation=$2 AND k.key=$3 AND k.expires_at>now()', [actor.id,operation,key]);
  if (found.rows[0]) {
    if (found.rows[0].request_hash !== hash) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','The key was already used for different input.');
    // Historical receipts are immutable business results, not current records.
    // Parse old vehicle receipts so newly added optional/defaulted fields are supplied before serialization.
    if(operation==='vehicle.create' || ['vehicle.publish:','vehicle.delete:','vehicle.restore:'].some(prefix=>operation.startsWith(prefix)))
      return AdminVehicleSchema.parse({...found.rows[0].response,hasUnpublishedChanges:found.rows[0].has_unpublished_changes??found.rows[0].response.hasUnpublishedChanges??null}) as T;
    return found.rows[0].response as T;
  }
  const result = await work();
  const vehicleReceipt=operation==='vehicle.create'||['vehicle.publish:','vehicle.delete:','vehicle.restore:'].some(prefix=>operation.startsWith(prefix));
  const persisted=vehicleReceipt?(({hasUnpublishedChanges,...historical})=>historical)(result as AdminVehicle):result;
  await tx.query(`INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours')
    ON CONFLICT(actor_id,operation,key) DO UPDATE SET request_hash=excluded.request_hash,response=excluded.response,expires_at=excluded.expires_at`, [actor.id,operation,key,hash,JSON.stringify(persisted)]);
  if(vehicleReceipt)await tx.query(`INSERT INTO idempotency_vehicle_metadata(actor_id,operation,key,has_unpublished_changes,receipt_hash)
    SELECT actor_id,operation,key,$4,md5(response::text) FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3
    ON CONFLICT(actor_id,operation,key) DO UPDATE SET has_unpublished_changes=excluded.has_unpublished_changes,receipt_hash=excluded.receipt_hash`,[actor.id,operation,key,(result as AdminVehicle).hasUnpublishedChanges]);
  return result;
}
async function lockVehicle(tx: PoolClient, id: string, version?: number, includeDeleted=false): Promise<Row> {
  const result = await tx.query<Row>(`${adminSelect} WHERE v.id=$1 FOR UPDATE OF v`,[id]);
  const row = result.rows[0]; if (!row || (row.deleted_at && !includeDeleted)) throw notFound();
  if (version !== undefined && row.version !== version) throw conflict();
  return row;
}
function storedLocalization(row:Row):StoredLocalization {
  return row.localization_data?{revision:row.localization_revision!,data:row.localization_data,bindings:row.localization_bindings!,retiredFields:row.retired_fields??[]}:emptyLocalization();
}
async function persistLocalization(tx:PoolClient,id:string,state:StoredLocalization,revision:number){
  await tx.query(`INSERT INTO vehicle_localizations(vehicle_id,revision,data,bindings,retired_fields) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(vehicle_id) DO UPDATE SET revision=excluded.revision,data=excluded.data,bindings=excluded.bindings,retired_fields=excluded.retired_fields`,
    [id,revision,JSON.stringify(state.data),JSON.stringify(state.bindings),JSON.stringify(state.retiredFields)]);
}
function localizationResponse(row:Row):VehicleLocalization {
  const state=syncLocalization(row.id,row.data,storedLocalization(row));
  return VehicleLocalizationSchema.parse({vehicleId:row.id,vehicleVersion:row.version,revision:state.revision,data:state.data,retiredFieldCount:state.retiredFields.length});
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
function vehicleOptions(factsRows:VehicleDraftInput['facts'][],selectedMake?:string,staffCount=factsRows.length) {
  const makes=new Map<string,{id:string;name:string;count:number}>();
  const models=new Map<string,{id:string;name:string;makeId:string;count:number}>();
  const powers=new Map<PublicVehicle['facts']['powertrain'],number>();
  // Rows arrive newest first; retain that display name when historical names differ.
  for(const [index,facts] of factsRows.entries()) {
    const make=facts.make;const model=facts.model;
    if(make) {const old=makes.get(make.id);makes.set(make.id,{id:make.id,name:old?.name??make.name,count:(old?.count??0)+1});}
    if(model&&make) {const key=`${make.id}:${model.id}`,old=models.get(key);models.set(key,{id:model.id,name:old?.name??model.name,makeId:make.id,count:(old?.count??0)+1});}
    if(index<staffCount || facts.powertrain!=='unknown') powers.set(facts.powertrain,(powers.get(facts.powertrain)??0)+1);
  }
  return {makes:[...makes.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    models:[...models.values()].filter(m=>!selectedMake||m.makeId===selectedMake).sort((a,b)=>a.makeId.localeCompare(b.makeId)||a.id.localeCompare(b.id)),
    powertrains:[...powers].map(([id,count])=>({id,count})).sort((a,b)=>a.id.localeCompare(b.id))};
}
const brandLabels={ids:Object.fromEntries(BRAND_CATALOG.map(brand=>[brand.catalogId,brand.labels])),aliases:Object.fromEntries(BRAND_CATALOG.flatMap(brand=>brand.aliases.map(alias=>[normalizeBrandAlias(alias),brand.labels])))};
function publicSearch(query:Pick<PublicVehicleQuery,'q'|'locale'|'view'>,params:unknown[]):string|null {
  const keyword=query.q?.trim();if(!keyword) return null;
  params.push(query.locale);const localeParameter=`$${params.length}::text`;
  params.push(keyword);const searchParameter=`$${params.length}`;
  let make="p.data->'facts'->'make'->>'name'",model="p.data->'facts'->'model'->>'name'";
  if(query.view==='localized'){
    params.push(JSON.stringify(brandLabels));const dictionary=`$${params.length}::jsonb`;
    const labels=`coalesce(${dictionary}->'ids'->lower(p.data->'facts'->'make'->>'id'),${dictionary}->'aliases'->lower(btrim(regexp_replace(normalize(p.data->'facts'->'make'->>'name',NFKC),'[\\s﻿]+',' ','g'))))`;
    make=`CASE WHEN pl.publication_id IS NOT NULL THEN pl.projections->${localeParameter}->'display'->'make'->>'text' ELSE ${labels}->>${localeParameter} END`;
    model=`pl.projections->${localeParameter}->'display'->'model'->>'text'`;
  }
  const fields=["'HD-' || lpad(v.stock_number::text,greatest(6,length(v.stock_number::text)),'0')",make,model,
    `p.data->'content'->'title'->'translations'->${localeParameter}->>'text'`];
  return `(${fields.map(field=>`strpos(lower(coalesce(${field},'')),lower(${searchParameter}))>0`).join(' OR ')})`;
}
function localeVisible(locale:Locale,params:unknown[]):string {
  params.push(locale);const field="p.data->'content'->'title'";const text=`${field}->'translations'->$${params.length}::text`;
  return `(${text} IS NOT NULL AND ${text}->>'text' IS NOT NULL AND ${text}->>'sourceVersion'=${field}->>'sourceVersion' AND
    CASE WHEN p.data->'source'->>'kind'='manual' THEN ${text}->>'reviewStatus'='approved' ELSE ${text}->>'reviewStatus'<>'stale' END)`;
}
function publicConditions(query:PublicFilterQuery,params:unknown[]):string {
  const where=[catalogVisible,localeVisible(query.locale,params)];
  for(const [key,jsonPath] of [['make',"p.data->'facts'->'make'->>'id'"],['model',"p.data->'facts'->'model'->>'id'"],['trim',"p.data->'facts'->'trim'->>'id'"],['powertrain',"p.data->'facts'->>'powertrain'"],['generation',"pl.data->'facts'->'generation'->>'id'"],['drivetrain',"pl.data->'facts'->>'drivetrain'"]] as const){
    if(query[key]){params.push(query[key]);where.push(`${jsonPath}=$${params.length}`);}
  }
  for(const [min,max,column] of [['mileageMin','mileageMax',"(p.data->'facts'->>'mileageKm')::numeric"],['yearMin','yearMax',"(p.data->'facts'->>'modelYear')::numeric"],['priceMin','priceMax',"(p.data->'price'->'money'->>'amount')::numeric"]] as const){
    if(query[min]!==undefined){params.push(query[min]);where.push(`${column}>=$${params.length}::numeric`);}
    if(query[max]!==undefined){params.push(query[max]);where.push(`${column}<=$${params.length}::numeric`);}
  }
  if(query.priceMin!==undefined||query.priceMax!==undefined){params.push(query.priceCurrency);where.push(`p.data->'price'->'money'->>'currency'=$${params.length}`);}
  const search=publicSearch(query,params);if(search)where.push(search);
  return where.join(' AND ');
}
function extraOptions(vehicles:Array<{facts:PublicVehicle['facts'];price:{money:Pick<NonNullable<PublicVehicle['price']['money']>,'currency'>|null}}>){
  const trims=new Map<string,{id:string;name:string;makeId:string;modelId:string;count:number}>(),generations=new Map<string,{id:string;name:string;makeId:string;modelId:string;count:number}>();
  const years=new Map<number,number>(),drives=new Map<NonNullable<PublicVehicle['facts']['drivetrain']>,number>(),currencies=new Map<NonNullable<PublicVehicle['price']['money']>['currency'],number>();
  for(const vehicle of vehicles){
    const facts=vehicle.facts;
    for(const [value,target] of [[facts.trim,trims],[facts.generation,generations]] as const)if(value&&facts.make&&facts.model){
      const key=JSON.stringify([facts.make.id,facts.model.id,value.id]);const old=target.get(key);
      target.set(key,{id:value.id,name:old?.name??value.name,makeId:facts.make.id,modelId:facts.model.id,count:(old?.count??0)+1});
    }
    if(facts.modelYear!==null)years.set(facts.modelYear,(years.get(facts.modelYear)??0)+1);
    if(facts.drivetrain)drives.set(facts.drivetrain,(drives.get(facts.drivetrain)??0)+1);
    if(vehicle.price.money)currencies.set(vehicle.price.money.currency,(currencies.get(vehicle.price.money.currency)??0)+1);
  }
  const order=(a:{makeId:string;modelId:string;id:string},b:{makeId:string;modelId:string;id:string})=>a.makeId.localeCompare(b.makeId)||a.modelId.localeCompare(b.modelId)||a.id.localeCompare(b.id);
  return {trims:[...trims.values()].sort(order),generations:[...generations.values()].sort(order),
    modelYears:[...years].map(([year,count])=>({year,count})).sort((a,b)=>b.year-a.year),
    drivetrains:[...drives].map(([id,count])=>({id,count})).sort((a,b)=>a.id.localeCompare(b.id)),
    priceCurrencies:[...currencies].map(([id,count])=>({id,count})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export class InventoryService {
  constructor(private db: Database, private externalCatalog=false) {}
  async getLocalization(id:string){
    const result=await this.db.pool.query<Row>(`${adminSelect} WHERE v.id=$1 AND v.deleted_at IS NULL`,[id]);
    if(!result.rows[0])throw notFound();return localizationResponse(result.rows[0]);
  }
  async saveLocalization(id:string,input:SaveVehicleLocalization,actor:Actor){
    return this.db.transaction(async tx=>{
      const row=await lockVehicle(tx,id,input.vehicleVersion);
      const current=syncLocalization(id,row.data,storedLocalization(row));
      if(current.revision!==input.revision)throw conflict();
      const next=applyLocalizationInput(id,row.data,current,input.data);
      await persistLocalization(tx,id,next,current.revision+1);
      await tx.query('UPDATE vehicles SET version=version+1,updated_at=now() WHERE id=$1',[id]);
      await audit(tx,actor,'vehicle.localization.save',id,row.version,row.version+1);
      return localizationResponse(await lockVehicle(tx,id));
    });
  }
  async displayTranslationSuggestions(id:string,input:GenerateDisplayTranslations,actor:Actor,key:string,translator:VehicleTranslator){
    id=id.toLowerCase();const operation=`vehicle.displayTranslationSuggestions:${id}`;
    const request={id,...input};const hash=createHash('sha256').update(canonical(request)).digest('hex');
    const receipt=(await this.db.pool.query('SELECT request_hash,response FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3 AND expires_at>now()',[actor.id,operation,key])).rows[0];
    if(receipt){if(receipt.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','The key was already used for different input.');return DisplayTranslationSuggestionsSchema.parse(receipt.response);}
    const current=await this.getLocalization(id);
    if(current.vehicleVersion!==input.vehicleVersion||current.revision!==input.revision)throw conflict();
    const fields=input.refs.map(ref=>{const field=current.data.fields.find(item=>item.ref===ref);if(!field)throw new ApiError(400,'INVALID_REQUEST','Unknown public display field.');return field;});
    const translated=await translator.generateDisplay(fields);
    return this.db.transaction(tx=>idempotent(tx,actor,operation,key,request,async()=>{
      const row=await lockVehicle(tx,id,input.vehicleVersion);
      if((row.localization_revision??0)!==input.revision)throw conflict();
      await audit(tx,actor,'vehicle.localization.suggestions',id,row.version,row.version);
      return DisplayTranslationSuggestionsSchema.parse({vehicleId:id,vehicleVersion:row.version,revision:input.revision,fields:translated});
    }));
  }
  async translationSuggestions(id:string,version:number,actor:Actor,key:string,translator:VehicleTranslator) {
    id=id.toLowerCase();const operation=`vehicle.translationSuggestions:${id}`;const input={id,version};
    // Historical receipts must replay even if the vehicle was later edited or the provider disabled.
    const receipt=(await this.db.pool.query('SELECT request_hash,response FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3 AND expires_at>now()',[actor.id,operation,key])).rows[0];
    if(receipt) {
      if(receipt.request_hash!==createHash('sha256').update(canonical(input)).digest('hex'))throw new ApiError(409,'IDEMPOTENCY_CONFLICT','The key was already used for different input.');
      return VehicleTranslationSuggestionsSchema.parse(receipt.response);
    }
    const saved=await this.getAdmin(id);if(saved.version!==version)throw conflict();
    // No database transaction or row lock is held while waiting for the external service.
    const suggestion=await translator.generate(saved);
    return this.db.transaction(tx=>idempotent(tx,actor,operation,key,input,async()=>{
      await lockVehicle(tx,id,version); // Reject edits/deletion that happened while the provider was running.
      await audit(tx,actor,'vehicle.translationSuggestions',id,version,version);
      return suggestion;
    }));
  }
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
      if(row.localization_data)await persistLocalization(tx,id,syncLocalization(id,normalized,storedLocalization(row)),(row.localization_revision??0)+1);
      await tx.query('UPDATE vehicles SET version=version+1,updated_at=now() WHERE id=$1',[id]);
      await audit(tx,actor,'vehicle.save',id,version,version+1);
      return toAdmin(await lockVehicle(tx,id));
    });
  }
  async publish(id:string,version:number,actor:Actor,key:string) {
    return this.db.transaction(tx=>idempotent(tx,actor,`vehicle.publish:${id}`,key,{id,version},async()=>{
      const row=await lockVehicle(tx,id,version);const draft=row.data;
      // No publication mutation or audit is needed for an already current snapshot.
      if(row.publication_state==='published' && !hasUnpublishedChanges(draft,row.publication_data,row.localization_data,row.published_localization)) return toAdmin(row);
      const localization=row.localization_data?syncLocalization(id,draft,storedLocalization(row)):undefined;
      if(localization)validateLocalizationPublication(localization.data,draft.source.kind==='manual');
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
      if(localization){
        const projections=Object.fromEntries(locales.map(locale=>[locale,projectDisplay(id,snapshot,locale,localization)]));
        await tx.query('INSERT INTO publication_localizations(publication_id,data,bindings,projections) VALUES($1,$2,$3,$4)',[publicationId,JSON.stringify(localization.data),JSON.stringify(localization.bindings),JSON.stringify(projections)]);
      }
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
  async getPublic(id:string,locale:Locale,view?:'legacy'|'localized') {
    if(id.startsWith('ext-')) {
      if(!this.externalCatalog || view!=='localized') throw notFound();
      return this.db.transaction(async tx=>{
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const item=await getExternalPublic(tx,listingUuid(id),locale);
        if(!item) throw notFound();
        return item;
      });
    }
    const params:unknown[]=[id];const visible=localeVisible(locale,params);
    const result=await this.db.pool.query<Row>(`${publicSelect} WHERE v.id=$1 AND v.deleted_at IS NULL AND v.publication_state='published' AND ${visible}`,params);
    if (!result.rows[0]) throw notFound();return toPublic(result.rows[0],locale,view);
  }
  async listPublic(query:PublicVehicleQuery,requestId:string) {
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const params:unknown[]=[];const where=` WHERE ${publicConditions(query,params)}`;
      const count=await tx.query(`SELECT count(*)::int AS total ${publicFrom}${where}`,params);
      const staffTotal:number=count.rows[0].total;
      const includeExternal=this.externalCatalog&&query.view==='localized';
      const total=staffTotal+(includeExternal?await countExternal(tx,query):0);
      const offset=(query.page-1)*query.pageSize;
      const time=Date.now();
      const staff=offset<staffTotal ? await tx.query<Row>(`${publicSelect}${where} ORDER BY v.published_at DESC,v.id LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params,query.pageSize,offset]) : null;
      const items=staff?.rows.map(r=>toPublic(r,query.locale,query.view))??[];
      if(includeExternal && items.length<query.pageSize && offset+items.length<total) {
        items.push(...await listExternal(tx,query,query.pageSize-items.length,Math.max(0,offset-staffTotal),time));
      }
      return {data:{items,page:query.page,pageSize:query.pageSize,hasMore:query.page*query.pageSize<total},
        meta:{requestId,catalog:'curated' as const,total,totalKind:'exact' as const,accessibleTotal:total,dataAsOf:new Date(time).toISOString(),freshness:'fresh' as const}};
    });
  }
  async filters(query:PublicFilterQuery) {
    const params:unknown[]=[];const where=publicConditions(query,params);
    if(this.externalCatalog&&query.view==='localized') return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const staff=await tx.query<Row>(`${publicSelect} WHERE ${where} ORDER BY v.published_at DESC,v.id`,params);
      const staffRows=staff.rows.map(row=>toPublic(row,query.locale,query.view));
      const vehicles=[...staffRows,...await externalFacetRows(tx,query)];
      return {catalog:'curated' as const,total:vehicles.length,...vehicleOptions(vehicles.map(row=>row.facts),undefined,staffRows.length),...extraOptions(vehicles)};
    });
    const result=await this.db.pool.query<Row>(`${publicSelect} WHERE ${where} ORDER BY v.published_at DESC,v.id`,params);
    const vehicles=result.rows.map(row=>toPublic(row,query.locale,query.view));
    return {catalog:'curated' as const,...vehicleOptions(vehicles.map(vehicle=>vehicle.facts)),...(query.view==='localized'?extraOptions(vehicles):{})};
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
  async publicHome(locale:Locale,view?:'legacy'|'localized') {
    return this.db.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const config=(await tx.query('SELECT sections FROM home_config WHERE id=1')).rows[0] as Pick<AdminHomeSections,'sections'>;
      const ids=[...new Set(config.sections.flatMap(s=>s.vehicleIds).map(id=>id.toLowerCase()))];
      const params:unknown[]=[ids];const visible=localeVisible(locale,params);
      const rows=await tx.query<Row>(`${publicSelect} WHERE v.id=ANY($1::uuid[]) AND ${homeVisible} AND ${visible}`,params);
      const map=new Map(rows.rows.map(r=>[r.id,toPublic(r,locale,view)]));
      return {sections:config.sections.map(s=>({id:s.id,title:s.title[locale],vehicles:s.vehicleIds.map(id=>map.get(id.toLowerCase())).filter((v):v is PublicVehicle=>!!v)})).filter(s=>s.vehicles.length)};
    });
  }
}
