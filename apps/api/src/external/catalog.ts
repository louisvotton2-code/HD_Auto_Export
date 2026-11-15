import type { PoolClient } from 'pg';
import {
  PublicVehicleSchema, PublicVehicleCardSchema, PublicInspectionSummarySchema,type PublicInspectionSummary,type PublicVehicleCard, type PublicVehicleQuery, type ExternalIssue, type Locale, type PublicFilterQuery, type PublicMedia, type PublicVehicle, type VehicleDisplay,
} from '@hd/contracts/public';
import type {FxQuote} from './fx.js';
import {projectUsdPrice,usdSourceRange} from '../vehicles/usd-price.js';
import type { Database } from '../db/index.js';
import { displayText, publicText, type ExternalProjection } from './normalize.js';
import type { ReportSourceRow } from './report-evidence.js';
import { projectSourceReport } from './reports.js';
import { applyInspectionEnrichment } from './inspection-enrichment.js';
import {emptyInspectionSummary} from './sources/inspection-projection.js';
import { catalogOrder, catalogSeek, numericSort, usdSortAmount, type CatalogAnchor } from './cursor.js';
export type { CatalogAnchor } from './cursor.js';

export const publicListingId = (id: string) => `ext-${id}`;
export const listingUuid = (id: string) => id.slice(4);
export const publicMediaId = (id: string) => `ximg-${id}`;
const stockCode = (id: string) => `EXT-${id.toUpperCase()}`;
type Queryable = Pick<Database['pool'] | PoolClient, 'query'>;
type CatalogRow = {
  configuration_total?:number; overridden_names?:string[];
  extras?: Pick<PublicVehicleCard, 'identifiers'|'manufacture'|'exportStatus'|'vehicleClass'> & {powerHp?:number|null;names?:Partial<Pick<VehicleDisplay,'make'|'model'|'trim'>>};
  listing_id: string; platform_id: string; platform_name: string; listing_url: string;
  facts: ExternalProjection['facts']; price_cny: string | null; issues: ExternalIssue[];
  localized: ExternalProjection['localized'][Locale]; details?: ExternalProjection['details'];
  fetched_at: Date; source_updated_at: Date | null; published_at: Date;
  provider?: string; external_id?: string; source_revision?: string; source_hash?: string;
  source_data?: ReportSourceRow['source_data']; upstream_state?: string;
  inspection_binding?: unknown; inspection_content?: unknown;
  inspection_summary?:unknown;inspection_status?:PublicInspectionSummary['status'];
};
type ImageRow = {
  id: string; listing_id: string; url: string; alt: ExternalProjection['images'][number]['alt'];
  width: number | null; height: number | null; position: number; revision: number; refreshed_at: Date; expires_at: Date | null;
};
const iso = (value: Date | null) => value?.toISOString() ?? null;
const localizedFacts = (facts: CatalogRow['facts'], display: VehicleDisplay): CatalogRow['facts'] => ({
  ...facts,
  make: facts.make && { ...facts.make, name: display.make.text ?? facts.make.name },
  model: facts.model && { ...facts.model, name: display.model.text ?? facts.model.name },
  trim: facts.trim && { ...facts.trim, name: display.trim.text ?? facts.trim.name },
  generation: facts.generation && { ...facts.generation, name: display.generation.text ?? facts.generation.name },
  location: facts.location && { ...facts.location, city: display.city.text, displayName: display.location.text },
});

function toPublic(row: CatalogRow, photos: ImageRow[], locale: Locale, time: number,priceView?:'usd',quote:FxQuote|null=null): PublicVehicle {
  const issues = [...row.issues];
  const available = photos.filter(photo => !photo.expires_at || photo.expires_at.getTime() > time);
  if (available.length !== photos.length && !issues.some(issue => issue.field === 'images')) issues.push({ field: 'images', code: 'expired' });
  const images: PublicMedia[] = available.slice(0,30).map((photo, i) => ({
    id: publicMediaId(photo.id), url: photo.url, alt: photo.alt?.text ?? '', altText:displayText(locale,photo.alt), width: photo.width, height: photo.height,
    sortOrder: photo.position, isCover: i === 0,
    remote: { revision: photo.revision, refreshedAt: photo.refreshed_at.toISOString(), expiresAt: iso(photo.expires_at) },
  }));
  const { title, description } = row.localized;
  const display = { ...catalogDisplay(row), mediaAlt: available.slice(0,30).map(photo => ({ mediaId: publicMediaId(photo.id), value: displayText(locale, photo.alt) })) };
  const id = publicListingId(row.listing_id);
  const source: ReportSourceRow = { id: row.listing_id, provider: row.provider!, platform_id: row.platform_id,
    external_id: row.external_id!, source_revision: row.source_revision!, source_hash: row.source_hash!, source_data: row.source_data ?? null,
    upstream_state: row.upstream_state! };
  const enriched = row.details ? applyInspectionEnrichment(source, row.details, row.inspection_binding
    ? { binding: row.inspection_binding, content: row.inspection_content } : null) : undefined;
  // Reports are paged only on the separate inspection endpoint, including legacy/enriched projections.
  const detail = enriched ? { ...enriched, inspection:null } : undefined;
  const report = detail ? projectSourceReport(source, row.inspection_binding
    ? { binding: row.inspection_binding, content: row.inspection_content } : null) : null;
  const parsedSummary=PublicInspectionSummarySchema.safeParse(row.inspection_summary);
  const summaryStatus=row.inspection_status??(report?.hasReport?'unavailable':'unknown');
  const inspectionSummary=detail?(parsedSummary.success&&summaryStatus==='available'?{...parsedSummary.data,status:summaryStatus}:emptyInspectionSummary(summaryStatus)):undefined;
  const original = (field: keyof ExternalProjection['details']['original']) => {
    const value = detail?.original[field];
    return value ? publicText(locale, value) : null;
  };
  const price:PublicVehicle['price']=row.price_cny===null?{kind:'on_request',money:null,includes:[]}:{kind:'reference',money:{amount:row.price_cny,currency:'CNY'},includes:[]};
  return PublicVehicleSchema.parse({
    id, stockCode: stockCode(row.listing_id), detailPath: `/${locale}/cars/${id}/`,
    source: { kind: 'external', platform: { id: row.platform_id, name: row.platform_name }, listingUrl: row.listing_url },
    facts: { ...localizedFacts(row.facts, display), ...(row.extras?.powerHp !== undefined ? {powerHp:row.extras.powerHp} : {}) }, display,
    ...publicExtras(row),
    price,...(priceView==='usd'?{displayPrice:projectUsdPrice(price,quote)}:{}),
    content: { title, description }, images, mediaTotal:available.length, ...(row.configuration_total!==undefined?{configurationTotal:row.configuration_total}:{}),
    ...(report ? { report: { hasReport: inspectionSummary?.status==='available'||inspectionSummary?.status!=='no_report'&&report.hasReport } } : {}),
    ...(inspectionSummary?{inspectionSummary}:{}),
    availability: 'unknown', availabilityCheckedAt: null, sourceUpdatedAt: iso(row.source_updated_at),
    fetchedAt: row.fetched_at.toISOString(), publishedAt: row.published_at.toISOString(),
    external: {
      issues,
      ...(detail ? { detail: { ...detail, original: { title: original('title'), model: original('model'), description: original('description') } } } : {}),
    },
  });
}

function catalogDisplay(row:CatalogRow):VehicleDisplay {
  const display={...row.localized.display};
  for(const key of ['make','model','trim'] as const) {
    const extra=row.extras?.names?.[key];
    // Current employee edits and disputed/missing identities retain precedence over source names.
    if(row.facts[key] && extra?.status==='ready' && display[key].provenance!=='human' && !row.overridden_names?.includes(key))display[key]=extra;
  }
  return display;
}
// The extras table is a small public whitelist, never the provider response or report payload.
function publicExtras(row: CatalogRow) {
  const manufacture=row.overridden_names?.includes('manufacturedAt')
    ? {date:row.facts.manufacturedAt,range:null,source:'staff',basis:null}
    : row.extras?.manufacture;
  return { ...(row.extras?.identifiers ? { identifiers: row.extras.identifiers } : {}),
    ...(manufacture ? { manufacture } : {}),
    ...(row.extras?.vehicleClass !== undefined ? { vehicleClass: row.extras.vehicleClass } : {}),
    exportStatus: row.extras?.exportStatus ?? 'unknown' };
}
function toCard(row: CatalogRow, photos: ImageRow[], locale: Locale, priceView?: 'usd', quote: FxQuote|null=null): PublicVehicleCard {
  const images: PublicMedia[] = photos.map(photo => ({ id:publicMediaId(photo.id),url:photo.url,alt:photo.alt?.text??'',altText:displayText(locale,photo.alt),
    width:photo.width,height:photo.height,sortOrder:photo.position,isCover:true,
    remote:{revision:photo.revision,refreshedAt:photo.refreshed_at.toISOString(),expiresAt:iso(photo.expires_at)} }));
  const display={...catalogDisplay(row),mediaAlt:images.map(photo=>({mediaId:photo.id,value:photo.altText!}))};
  const price:PublicVehicle['price']=row.price_cny===null?{kind:'on_request',money:null,includes:[]}:{kind:'reference',money:{amount:row.price_cny,currency:'CNY'},includes:[]};
  const id=publicListingId(row.listing_id);
  return PublicVehicleCardSchema.parse({ id,stockCode:stockCode(row.listing_id),detailPath:`/${locale}/cars/${id}/`,
    source:{kind:'external',platform:{id:row.platform_id,name:row.platform_name},listingUrl:row.listing_url},
    facts:{...localizedFacts(row.facts,display),...(row.extras?.powerHp!==undefined?{powerHp:row.extras.powerHp}:{})},display,...publicExtras(row),
    price,...(priceView==='usd'?{displayPrice:projectUsdPrice(price,quote)}:{}),content:{title:row.localized.title},images,
    availability:'unknown',availabilityCheckedAt:null,sourceUpdatedAt:iso(row.source_updated_at),fetchedAt:row.fetched_at.toISOString(),publishedAt:row.published_at.toISOString() });
}

/** Escape LIKE metacharacters; query text always means a literal substring. */
export const literalPattern = (text: string) => `%${text.replace(/[\\%_]/g, value => `\\${value}`)}%`;
function matches(query: PublicFilterQuery,quote:FxQuote|null=null) {
  const values: unknown[] = [query.locale];
  const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const where: string[] = [];
  for (const key of ['make', 'model', 'trim', 'generation'] as const) if (query[key]) where.push(`f.${key}_id=${param(query[key])}`);
  if (query.drivetrain) where.push(`f.drivetrain=${param(query.drivetrain)}`);
  if (query.powertrain === 'unknown') where.push('false');
  else if (query.powertrain) where.push(`f.powertrain=${param(query.powertrain)}`);
  for (const [min, max, column] of [
    ['yearMin', 'yearMax', 'f.model_year'],
    ['mileageMin', 'mileageMax', 'f.mileage_km'],
  ] as const) {
    if (query[min] !== undefined) where.push(`${column}>=${param(query[min])}`);
    if (query[max] !== undefined) where.push(`${column}<=${param(query[max])}`);
  }
  if(query.priceMin!==undefined||query.priceMax!==undefined) {
    if(query.priceView==='usd'){const range=usdSourceRange('CNY',quote,query.priceMin,query.priceMax);
      where.push(range?`f.price_cny>=${param(range.minimum)}::numeric AND f.price_cny<=${param(range.maximum)}::numeric`:'false');
    }else if(query.priceCurrency!=='CNY')where.push('false');
    else {if(query.priceMin!==undefined)where.push(`f.price_cny>=${param(query.priceMin)}::numeric`);if(query.priceMax!==undefined)where.push(`f.price_cny<=${param(query.priceMax)}::numeric`);}
  }
  if (query.exportStatus && query.exportStatus !== 'all') where.push(`coalesce(x.export_status,'unknown')=${param(query.exportStatus)}`);
  if (query.q) {
    const pattern = param(literalPattern(query.q));
    // The combined GIN candidate may cross field separators; the second predicate cannot.
    where.push(`s.search_document LIKE lower(${pattern}) ESCAPE E'\\\\'`);
    where.push(`(${['stock_text','make_text','model_text','title_text'].map(field => `lower(s.${field}) LIKE lower(${pattern}) ESCAPE E'\\\\'`).join(' OR ')})`);
  }
  return { where: where.length ? ` AND ${where.join(' AND ')}` : '', values };
}

// Fixed-width inverse microseconds and UUID preserve newest-first/id-ascending order.
// 18 digits cover the API's complete year 0001..9999 timestamp domain.
export const facetLabelOrder = (timestamp:string,id:string) => `lpad((253402300799999999-floor(extract(epoch from ${timestamp})*1000000))::text,18,'0')||${id}::text`;
export type CatalogFacetRow = {kind:string;id:string|null;name:string|null;make_id:string|null;model_id:string|null;count:number};
/** Only grouped dictionaries leave PostgreSQL, regardless of matched catalogue size. */
export async function aggregateCatalogFacets(tx: Queryable, selection: string, values: unknown[]): Promise<CatalogFacetRow[]> {
  const result = await tx.query<CatalogFacetRow>(`WITH matched AS MATERIALIZED (${selection}), groups AS (
    SELECT d.kind,d.id,d.make_id,d.model_id,substring(min((m.label_order||d.name) COLLATE "C") FROM 55) AS name,count(*)::int AS count
    FROM matched m CROSS JOIN LATERAL (VALUES
      ('make',m.make_id,m.make_name,NULL::text,NULL::text),
      ('model',m.model_id,m.model_name,m.make_id,NULL::text),
      ('trim',m.trim_id,m.trim_name,m.make_id,m.model_id),
      ('generation',m.generation_id,m.generation_name,m.make_id,m.model_id),
      ('powertrain',m.powertrain,NULL::text,NULL::text,NULL::text),
      ('drivetrain',m.drivetrain,NULL::text,NULL::text,NULL::text),
      ('year',m.model_year::text,NULL::text,NULL::text,NULL::text),
      ('currency',m.currency,NULL::text,NULL::text,NULL::text)
    ) d(kind,id,name,make_id,model_id)
    WHERE d.id IS NOT NULL AND (d.kind NOT IN ('model','trim','generation') OR d.make_id IS NOT NULL)
      AND (d.kind NOT IN ('trim','generation') OR d.model_id IS NOT NULL)
    GROUP BY d.kind,d.id,d.make_id,d.model_id
  ) SELECT * FROM groups UNION ALL SELECT 'total',NULL,NULL,NULL,NULL,count(*)::int FROM matched`, values);
  return result.rows;
}
const columns = `c.listing_id,c.published_at,c.platform_name,c.listing_url,c.facts,c.price_cny,c.issues,
  c.localized->$1::text AS localized,l.platform_id,l.fetched_at,l.source_updated_at,x.data AS extras,ARRAY(SELECT jsonb_object_keys(coalesce(o.data->'facts','{}'::jsonb))) AS overridden_names`;
const cardColumns = `c.listing_id,c.published_at,c.platform_name,c.listing_url,c.facts,c.price_cny,
  jsonb_build_object('title',c.localized->$1::text->'title','display',c.localized->$1::text->'display') AS localized,
  l.platform_id,l.fetched_at,l.source_updated_at,x.data AS extras,ARRAY(SELECT jsonb_object_keys(coalesce(o.data->'facts','{}'::jsonb))) AS overridden_names`;
const extrasJoin = ' LEFT JOIN external_vehicle_extras x ON x.listing_id=c.listing_id AND x.locale=$1::text LEFT JOIN external_listing_overrides o ON o.listing_id=c.listing_id';
const from = 'FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale=$1::text' + extrasJoin;
// Catalogue rows only exist for visible listings. This second predicate is also useful when repairing projections.
const visible = "WHERE l.upstream_state='active'";
const ordered = 'ORDER BY c.published_at DESC,c.listing_id';

async function materialize(tx: Queryable, rows: CatalogRow[], locale: Locale, time: number,priceView?:'usd',quote:FxQuote|null=null,card=false):Promise<Array<PublicVehicle|PublicVehicleCard>> {
  if (!rows.length) return [];
  const ids=rows.map(row=>row.listing_id);
  // One indexed cover probe per picked listing; no full gallery travels to Node for card requests.
  if(card) {
    const photos=await tx.query<ImageRow>(`SELECT m.* FROM unnest($1::uuid[]) AS picked(listing_id) CROSS JOIN LATERAL (
      SELECT id,listing_id,url,alt,width,height,position,revision,refreshed_at,expires_at FROM external_media
      WHERE active AND listing_id=picked.listing_id AND (expires_at IS NULL OR expires_at>$2::timestamptz)
      ORDER BY position,id LIMIT 1) m`,[ids,new Date(time).toISOString()]);
    const covers=new Map(photos.rows.map(photo=>[photo.listing_id,photo]));
    return rows.map(row=>toCard(row,covers.has(row.listing_id)?[covers.get(row.listing_id)!]:[],locale,priceView,quote));
  }
  const photos = await tx.query<ImageRow>(`SELECT id,listing_id,url,alt,width,height,position,revision,refreshed_at,expires_at
    FROM external_media WHERE active AND listing_id=ANY($1::uuid[]) ORDER BY listing_id,position,id`, [ids]);
  const totals=await tx.query<{listing_id:string;total:number}>("SELECT listing_id,total FROM external_source_segment_sets WHERE listing_id=ANY($1::uuid[]) AND locale=$2 AND kind='configuration'",[rows.map(row=>row.listing_id),locale]);
  const configurationTotals=new Map(totals.rows.map(row=>[row.listing_id,row.total]));
  const images = new Map<string, ImageRow[]>();
  for (const photo of photos.rows) {
    const listingImages = images.get(photo.listing_id) ?? [];
    listingImages.push(photo);
    images.set(photo.listing_id, listingImages);
  }
  return rows.map(row => toPublic({...row,configuration_total:configurationTotals.get(row.listing_id)}, images.get(row.listing_id) ?? [], locale, time,priceView,quote));
}

export async function getExternalPublic(tx: Queryable, id: string, locale: Locale, time = Date.now(),priceView?:'usd',quote:FxQuote|null=null) {
  const result = await tx.query<CatalogRow>(`SELECT ${columns},jsonb_set(c.details,'{inspection}','null'::jsonb) AS details,l.provider,l.external_id,l.source_revision::text,l.source_hash,
    CASE WHEN l.source_data IS NULL THEN NULL ELSE jsonb_build_object('platformId',l.source_data->'platformId','externalId',l.source_data->'externalId','disputes',coalesce(l.source_data->'disputes','[]'::jsonb),'inspection',jsonb_build_object('hasReport',l.source_data->'inspection'->'hasReport','reportUrl',l.source_data->'inspection'->'reportUrl')) END AS source_data,l.upstream_state,
    i.binding AS inspection_binding,jsonb_set(i.content,'{inspection}','null'::jsonb) AS inspection_content,ev.status AS inspection_status,ev.overview->'summary' AS inspection_summary
    ${from} LEFT JOIN external_inspection_enrichment i ON i.listing_id=l.id
    LEFT JOIN external_vehicle_evidence_sets ev ON ev.listing_id=l.id AND ev.locale=$1 AND ev.kind='inspection'
    ${visible} AND c.listing_id=$2`, [locale, id]);
  return ((await materialize(tx, result.rows, locale, time,priceView,quote))[0] as PublicVehicle | undefined) ?? null;
}
// A transactionally maintained read model carries only visibility and filter scalars.
// Text eligibility joins the search projection only when a literal search is requested.
const filterFrom = (query: PublicFilterQuery) => 'FROM external_catalog_filter f' +
  (query.q ? ' JOIN external_catalog_search s ON s.listing_id=f.listing_id AND s.locale=$1::text' : '') +
  (query.exportStatus && query.exportStatus!=='all' ? ' LEFT JOIN external_vehicle_extras x ON x.listing_id=f.listing_id AND x.locale=$1::text' : '');
const filterVisible = `WHERE f.active AND f.locale_mask<>0 AND (f.locale_mask & CASE $1::text WHEN 'zh' THEN 1 WHEN 'en' THEN 2 WHEN 'ru' THEN 4 ELSE 0 END)<>0`;
const filterOrdered = 'ORDER BY f.published_at DESC,f.listing_id';

export async function countExternal(tx: Queryable, query: PublicFilterQuery,quote:FxQuote|null=null): Promise<number> {
  const { where, values } = matches(query,quote);
  const result = await tx.query<{ total: number }>(`SELECT count(*)::int AS total ${filterFrom(query)} ${filterVisible}${where}`, values);
  return result.rows[0]!.total;
}
export async function listExternalPage(tx: Queryable, query: PublicVehicleQuery, limit: number, offset: number, time: number, after?: CatalogAnchor,quote:FxQuote|null=null) {
  const { where, values } = matches(query,quote);
  const sort=query.sort??'newest',numeric=numericSort(sort);
  let column=sort==='mileage_asc'?'f.mileage_km':sort==='year_desc'?'f.model_year':'f.price_cny';
  if(sort.startsWith('price_')&&query.priceView==='usd')column=usdSortAmount(column,"'CNY'",quote,values);
  const sortSelect=numeric?`,(${column}) AS sort_value`:'';
  const selection=`SELECT f.listing_id,f.published_at${sortSelect} ${filterFrom(query)} ${filterVisible}${where}`;
  const order=numeric?`ORDER BY ${catalogOrder(column,'f.listing_id',sort)}`:filterOrdered;
  let picked:string;
  if(after && !numeric) {
    values.push(after.publishedAt,after.id);
    const time=`$${values.length-1}::timestamptz`,id=`$${values.length}::uuid`,size=`$${values.length+1}`;
    picked=`SELECT * FROM (
      (${selection} AND f.published_at=${time} AND f.listing_id>${id} ${order} LIMIT ${size})
      UNION ALL (${selection} AND f.published_at<${time} ${order} LIMIT ${size})
    ) seeked ORDER BY published_at DESC,listing_id LIMIT ${size}`;
    values.push(limit);
  } else {
    const seek=after?` AND ${catalogSeek(column,'f.listing_id',after,sort,values)}`:'';
    picked=`${selection}${seek} ${order} LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    values.push(limit,after?0:offset);
  }
  const result=await tx.query<CatalogRow & {cursor_published_at:string;cursor_sort_value?:string|null}>(`WITH picked AS MATERIALIZED (${picked})
    SELECT ${query.projection==='card'?cardColumns:columns},to_char(c.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_published_at
      ${numeric?',picked.sort_value::text AS cursor_sort_value':''}
    FROM picked JOIN external_catalog c ON c.listing_id=picked.listing_id
    JOIN external_listings l ON l.id=c.listing_id
    JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale=$1::text ${extrasJoin}
    ${visible} ${numeric?`ORDER BY ${catalogOrder('picked.sort_value','c.listing_id',sort)}`:ordered}`,values);
  return {items:await materialize(tx,result.rows,query.locale,time,query.priceView,quote,query.projection==='card'),
    anchors:result.rows.map(row=>({id:row.listing_id,publishedAt:row.cursor_published_at,...(numeric?{sortValue:row.cursor_sort_value??null}:{})}))};
}
export async function externalFacets(tx: Queryable, query: PublicFilterQuery,quote:FxQuote|null=null) {
  const { where, values } = matches(query,quote);
  const matchingValues=[...values];
  const currency=query.priceView==='usd'?'USD':'CNY';
  let priceAvailable='f.price_cny IS NOT NULL';
  if(query.priceView==='usd') {
    const range=usdSourceRange('CNY',quote);priceAvailable='false';
    if(range){values.push(range.minimum,range.maximum);priceAvailable=`coalesce(f.price_cny>=$${values.length-1}::numeric AND f.price_cny<=$${values.length}::numeric,false)`;}
  }
  // First coalesce identical complete facet tuples. Counts and minimum winner
  // keys are distributive, so expanding these atoms preserves exact per-facet
  // counts while avoiding repeated sorts of the entire matching vehicle set.
  // Only atoms are materialized; no localized/wide JSON is read. Raw enum values
  // and a boolean price flag retain low-cardinality keys for planner estimates.
  const result=await tx.query<CatalogFacetRow>(`WITH matched AS NOT MATERIALIZED (
    SELECT f.make_id,f.model_id,f.trim_id,f.generation_id,f.powertrain,
      f.drivetrain,f.model_year,${priceAvailable} AS price_available,f.label_order
    ${filterFrom(query)} ${filterVisible}${where}
  ), atoms AS MATERIALIZED (
    SELECT make_id,model_id,trim_id,generation_id,powertrain,drivetrain,model_year,price_available,
      min(label_order COLLATE "C") FILTER (WHERE make_id IS NOT NULL) AS label_order,count(*)::int AS row_count
    FROM matched GROUP BY make_id,model_id,trim_id,generation_id,powertrain,drivetrain,model_year,price_available
  ), facets AS (
    SELECT d.kind,d.id,d.make_id,d.model_id,sum(a.row_count)::int AS count,
      min(a.label_order COLLATE "C") FILTER (WHERE d.kind IN ('make','model','trim','generation')) AS label_order
    FROM atoms a CROSS JOIN LATERAL (VALUES
      ('make',a.make_id,NULL::text,NULL::text),
      ('model',a.model_id,a.make_id,NULL::text),
      ('trim',a.trim_id,a.make_id,a.model_id),
      ('generation',a.generation_id,a.make_id,a.model_id),
      ('powertrain',nullif(a.powertrain,'unknown'),NULL::text,NULL::text),
      ('drivetrain',a.drivetrain,NULL::text,NULL::text),
      ('year',a.model_year::text,NULL::text,NULL::text),
      ('currency',CASE WHEN a.price_available THEN '${currency}'::text END,NULL::text,NULL::text)
    ) d(kind,id,make_id,model_id)
    WHERE d.id IS NOT NULL AND (d.kind NOT IN ('model','trim','generation') OR d.make_id IS NOT NULL)
      AND (d.kind NOT IN ('trim','generation') OR d.model_id IS NOT NULL)
    GROUP BY d.kind,d.id,d.make_id,d.model_id
    UNION ALL SELECT 'total',NULL,NULL,NULL,coalesce(sum(row_count),0)::int,NULL FROM atoms
  ) SELECT g.kind,g.id,
      CASE g.kind WHEN 'make' THEN winner.make_label WHEN 'model' THEN winner.model_label
        WHEN 'trim' THEN winner.trim_label WHEN 'generation' THEN winner.generation_label END AS name,
      g.make_id,g.model_id,g.count
    FROM facets g LEFT JOIN LATERAL (
      SELECT CASE WHEN coalesce(overrides.data->'facts' ? 'make',false) OR labels.localized->$1::text->'display'->'make'->>'provenance'='human' THEN label.make_label ELSE coalesce(extra.data->'names'->'make'->>'text',label.make_label) END AS make_label,
        CASE WHEN coalesce(overrides.data->'facts' ? 'model',false) OR labels.localized->$1::text->'display'->'model'->>'provenance'='human' THEN label.model_label ELSE coalesce(extra.data->'names'->'model'->>'text',label.model_label) END AS model_label,
        CASE WHEN coalesce(overrides.data->'facts' ? 'trim',false) OR labels.localized->$1::text->'display'->'trim'->>'provenance'='human' THEN label.trim_label ELSE coalesce(extra.data->'names'->'trim'->>'text',label.trim_label) END AS trim_label,label.generation_label
      FROM external_catalog_search label JOIN external_catalog labels ON labels.listing_id=label.listing_id
      LEFT JOIN external_listing_overrides overrides ON overrides.listing_id=label.listing_id
      LEFT JOIN external_vehicle_extras extra ON extra.listing_id=label.listing_id AND extra.locale=label.locale
      WHERE label.listing_id=substring(g.label_order FROM 19 FOR 36)::uuid AND label.locale=$1::text
        AND g.kind IN ('make','model','trim','generation') LIMIT 1
    ) winner ON true`,values);
  // Historical projections may contain a null label despite a present ID. The
  // previous min(order || name) ignored those rows; preserve that rare fallback
  // without probing labels for every normal matched vehicle.
  const missing=result.rows.filter(row=>['make','model','trim','generation'].includes(row.kind)&&row.name===null);
  if(missing.length) {
    const name=`CASE missing.kind WHEN 'make' THEN CASE WHEN coalesce(overrides.data->'facts' ? 'make',false) OR labels.localized->$1::text->'display'->'make'->>'provenance'='human' THEN label.make_label ELSE coalesce(extra.data->'names'->'make'->>'text',label.make_label) END
      WHEN 'model' THEN CASE WHEN coalesce(overrides.data->'facts' ? 'model',false) OR labels.localized->$1::text->'display'->'model'->>'provenance'='human' THEN label.model_label ELSE coalesce(extra.data->'names'->'model'->>'text',label.model_label) END
      WHEN 'trim' THEN CASE WHEN coalesce(overrides.data->'facts' ? 'trim',false) OR labels.localized->$1::text->'display'->'trim'->>'provenance'='human' THEN label.trim_label ELSE coalesce(extra.data->'names'->'trim'->>'text',label.trim_label) END WHEN 'generation' THEN label.generation_label END`;
    const fallback=await tx.query<Pick<CatalogFacetRow,'kind'|'id'|'name'|'make_id'|'model_id'>>(`SELECT missing.*,selected.name
      FROM jsonb_to_recordset($${matchingValues.length+1}::jsonb) AS missing(kind text,id text,make_id text,model_id text)
      CROSS JOIN LATERAL (
        SELECT ${name} AS name ${filterFrom(query)}
        JOIN external_catalog_search label ON label.listing_id=f.listing_id AND label.locale=$1::text
        JOIN external_catalog labels ON labels.listing_id=f.listing_id
        LEFT JOIN external_listing_overrides overrides ON overrides.listing_id=f.listing_id
        LEFT JOIN external_vehicle_extras extra ON extra.listing_id=f.listing_id AND extra.locale=$1::text
        ${filterVisible}${where} AND ${name} IS NOT NULL AND CASE missing.kind
          WHEN 'make' THEN f.make_id=missing.id
          WHEN 'model' THEN f.make_id=missing.make_id AND f.model_id=missing.id
          WHEN 'trim' THEN f.make_id=missing.make_id AND f.model_id=missing.model_id AND f.trim_id=missing.id
          WHEN 'generation' THEN f.make_id=missing.make_id AND f.model_id=missing.model_id AND f.generation_id=missing.id
          ELSE false END
        ${filterOrdered} LIMIT 1
      ) selected`,[...matchingValues,JSON.stringify(missing.map(({kind,id,make_id,model_id})=>({kind,id,make_id,model_id})))]);
    const key=(row:Pick<CatalogFacetRow,'kind'|'id'|'make_id'|'model_id'>)=>JSON.stringify([row.kind,row.id,row.make_id,row.model_id]);
    const names=new Map(fallback.rows.map(row=>[key(row),row.name]));
    for(const row of missing)row.name=names.get(key(row))??null;
  }
  return result.rows;
}

export async function reportMediaFailure(db: Database, mediaId: string, revision: number) {
  const result = await db.pool.query<{ found: boolean; queued: boolean }>(`WITH eligible AS (
    SELECT m.id,m.revision FROM external_media m JOIN external_catalog c ON c.listing_id=m.listing_id
    WHERE m.id=$1 AND m.active AND m.revision=$2
  ), queued AS (
    INSERT INTO external_media_refresh_requests(media_id,media_revision) SELECT id,revision FROM eligible
    ON CONFLICT DO NOTHING RETURNING media_id
  ) SELECT EXISTS(SELECT FROM eligible) AS found, EXISTS(SELECT FROM queued) AS queued`, [mediaId, revision]);
  return result.rows[0]!;
}
