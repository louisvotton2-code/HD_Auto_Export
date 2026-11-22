import type { PoolClient } from 'pg';
import {
  IdSchema, PublicVehicleSchema, PublicVehicleCardSchema, PublicInspectionSummarySchema,type PublicInspectionSummary,type PublicVehicleCard, type PublicVehicleQuery, type ExternalIssue, type Locale, type PublicFilterQuery, type PublicMedia, type PublicVehicle, type VehicleDisplay,
} from '@hd/contracts/public';
import type {FxQuote} from './fx.js';
import {projectUsdPrice,usdSourceRange} from '../vehicles/usd-price.js';
import type { Database } from '../db/index.js';
import { ApiError } from '../errors.js';
import { displayText, fallbackExternalTitle, isPublicText, publicText, safeExternalDisplayText, safeExternalInspectionSummary, type ExternalProjection } from './normalize.js';
import { externalInquiryCode, externalInquiryNumber } from './inquiry-code.js';
import { publicExternalDisplay, publicExternalSource } from './public-source.js';
import type { ReportSourceRow } from './report-evidence.js';
import { projectSourceReport } from './reports.js';
import { applyInspectionEnrichment } from './inspection-enrichment.js';
import {emptyInspectionSummary} from './sources/inspection-projection.js';
import { catalogOrder, catalogSeek, exactUsdSortValue, numericSort, type CatalogAnchor } from './cursor.js';
import { englishCatalogTitle, explicitEnglishDetailTitle } from '../vehicles/english-detail-title.js';
export type { CatalogAnchor } from './cursor.js';

export const publicListingId = (id: string) => `ext-${id}`;
export const listingUuid = (id: string) => id.slice(4);
export const publicMediaId = (id: string) => `ximg-${id}`;
type Queryable = Pick<Database['pool'] | PoolClient, 'query'>;
const catalogNameKeys = ['make', 'model', 'trim'] as const;
type CatalogName = typeof catalogNameKeys[number];
type CatalogNames = Partial<Pick<VehicleDisplay, CatalogName>>;
type CatalogRow = {
  pixel_enabled?: boolean;
  configuration_total?:number; overridden_names?:string[];
  extras?: Pick<PublicVehicleCard, 'identifiers'|'manufacture'|'exportStatus'|'vehicleClass'> & {powerHp?:number|null;names?:CatalogNames};
  english?: { title: unknown; display: CatalogNames; names: CatalogNames | null } | null;
  listing_id: string; inquiry_number: string; platform_id?: string;
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
function publicName(fact: CatalogRow['facts']['make'], text: string | null) {
  if (!fact) return null;
  if (text) return {...fact,name:text};
  return isPublicText(fact.name) ? fact : null;
}
const localizedFacts = (facts: CatalogRow['facts'], display: VehicleDisplay): CatalogRow['facts'] => ({
  ...facts,
  make: publicName(facts.make, display.make.text),
  model: publicName(facts.model, display.model.text),
  trim: publicName(facts.trim, display.trim.text),
  ...(facts.generation === undefined ? {} : {generation:publicName(facts.generation,display.generation.text)}),
  location: facts.location && { ...facts.location, city: display.city.text, displayName: display.location.text },
});

function catalogTitle(row: CatalogRow, locale: Locale) {
  const title = row.localized.title;
  return isPublicText(title.text) ? title : fallbackExternalTitle(locale);
}
function publicPhoto(photo: ImageRow, locale: Locale, isCover: boolean): PublicMedia {
  const alt = photo.alt && isPublicText(photo.alt.text) ? photo.alt : null;
  return {
    id: publicMediaId(photo.id), url: photo.url, alt: alt?.text ?? '', altText: displayText(locale,alt), width: photo.width, height: photo.height,
    sortOrder: photo.position, isCover,
    remote: { revision: photo.revision, refreshedAt: photo.refreshed_at.toISOString(), expiresAt: iso(photo.expires_at) },
  };
}
function toPublic(row: CatalogRow, photos: ImageRow[], locale: Locale, time: number,priceView?:'usd',quote:FxQuote|null=null): PublicVehicle {
  const issues = [...row.issues];
  const available = photos.filter(photo => !photo.expires_at || photo.expires_at.getTime() > time);
  if (available.length !== photos.length && !issues.some(issue => issue.field === 'images')) issues.push({ field: 'images', code: 'expired' });
  const images = available.slice(0,30).map((photo,i)=>publicPhoto(photo,locale,i===0));
  const { description } = row.localized;
  const display = { ...catalogDisplay(row, locale), mediaAlt: images.map(image=>({mediaId:image.id,value:image.altText!})) };
  const id = publicListingId(row.listing_id);
  const source: ReportSourceRow = { id: row.listing_id, provider: row.provider!, platform_id: row.platform_id!,
    external_id: row.external_id!, source_revision: row.source_revision!, source_hash: row.source_hash!, source_data: row.source_data ?? null,
    upstream_state: row.upstream_state! };
  const enriched = row.details ? applyInspectionEnrichment(source, row.details, row.inspection_binding
    ? { binding: row.inspection_binding, content: row.inspection_content } : null) : undefined;
  // Reports are paged only on the separate inspection endpoint, including legacy/enriched projections.
  const detail = enriched ? { ...enriched, inspection: null, relatedListingUrls: [],
    specifications: enriched.specifications.filter(entry=>isPublicText(entry.name.text)&&isPublicText(entry.value.text)) } : undefined;
  const report = detail ? projectSourceReport(source, row.inspection_binding
    ? { binding: row.inspection_binding, content: row.inspection_content } : null) : null;
  const parsedSummary=PublicInspectionSummarySchema.safeParse(row.inspection_summary);
  const summaryStatus=row.inspection_status??(report?.hasReport?'unavailable':'unknown');
  const inspectionSummary=detail?(parsedSummary.success&&summaryStatus==='available'
    ?safeExternalInspectionSummary(locale,{...parsedSummary.data,status:summaryStatus}):emptyInspectionSummary(summaryStatus)):undefined;
  const original = (field: keyof ExternalProjection['details']['original']) => {
    const value = detail?.original[field];
    return value && isPublicText(value.text) ? publicText(locale, value) : null;
  };
  const price:PublicVehicle['price']=row.price_cny===null?{kind:'on_request',money:null,includes:[]}:{kind:'reference',money:{amount:row.price_cny,currency:'CNY'},includes:[]};
  return PublicVehicleSchema.parse({
    id, stockCode: externalInquiryCode(row.inquiry_number), detailPath: `/${locale}/cars/${id}/`,
    source: publicExternalSource(),
    facts: { ...localizedFacts(row.facts, display), ...(row.extras?.powerHp !== undefined ? {powerHp:row.extras.powerHp} : {}) }, display,
    ...publicExtras(row,locale),
    price,...(priceView==='usd'?{displayPrice:projectUsdPrice(price,quote)}:{}),
    content: { title:catalogTitle(row,locale), description:description && isPublicText(description.text) ? description : null },
    images, mediaTotal:available.length, ...(row.configuration_total!==undefined?{configurationTotal:row.configuration_total}:{}),
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

function catalogDisplay(row: CatalogRow, locale: Locale): VehicleDisplay {
  const display = publicExternalDisplay(row.localized.display, locale);
  for (const key of catalogNameKeys) display[key] = catalogName(row, key, display[key], row.extras?.names?.[key]) ?? display[key];
  for (const key of [...catalogNameKeys,'generation','city','location'] as const)
    display[key] = safeExternalDisplayText(locale,display[key]);
  return display;
}
function catalogName(row: CatalogRow, key: CatalogName, localized: CatalogNames[CatalogName], extra: CatalogNames[CatalogName]) {
  // Current employee edits and disputed/missing identities retain precedence over source names.
  return row.facts[key] && extra?.status === 'ready' && localized?.provenance !== 'human' && !row.overridden_names?.includes(key)
    ? extra : localized;
}
// Stored evidence still carries the supplier reference for internal use.
function publicExtras(row: CatalogRow, locale: Locale) {
  const manufacture=row.overridden_names?.includes('manufacturedAt')
    ? {date:row.facts.manufacturedAt,range:null,source:'staff',basis:null}
    : row.extras?.manufacture;
  return { identifiers: { sourceId: null, source: null, inquiryCode: externalInquiryCode(row.inquiry_number), vin: row.extras?.identifiers?.vin ?? null },
    ...(manufacture ? { manufacture } : {}),
    ...(row.extras?.vehicleClass !== undefined ? { vehicleClass: row.extras.vehicleClass && safeExternalDisplayText(locale,row.extras.vehicleClass) } : {}),
    exportStatus: row.extras?.exportStatus ?? 'unknown' };
}
function toCard(row: CatalogRow, photos: ImageRow[], locale: Locale, priceView?: 'usd', quote: FxQuote|null=null): PublicVehicleCard {
  const images = photos.map(photo=>publicPhoto(photo,locale,true));
  const display={...catalogDisplay(row, locale),mediaAlt:images.map(photo=>({mediaId:photo.id,value:photo.altText!}))};
  const price:PublicVehicle['price']=row.price_cny===null?{kind:'on_request',money:null,includes:[]}:{kind:'reference',money:{amount:row.price_cny,currency:'CNY'},includes:[]};
  const id=publicListingId(row.listing_id);
  return PublicVehicleCardSchema.parse({ id,stockCode:externalInquiryCode(row.inquiry_number),detailPath:`/${locale}/cars/${id}/`,
    source:publicExternalSource(),
    facts:{...localizedFacts(row.facts,display),...(row.extras?.powerHp!==undefined?{powerHp:row.extras.powerHp}:{})},display,...publicExtras(row,locale),
    price,...(priceView==='usd'?{displayPrice:projectUsdPrice(price,quote)}:{}),content:{title:catalogTitle(row,locale)},images,
    availability:'unknown',availabilityCheckedAt:null,sourceUpdatedAt:iso(row.source_updated_at),fetchedAt:row.fetched_at.toISOString(),publishedAt:row.published_at.toISOString() });
}

/** Escape LIKE metacharacters; query text always means a literal substring. */
export const literalPattern = (text: string) => `%${text.replace(/[\\%_]/g, value => `\\${value}`)}%`;
type CatalogMatchQuery = Omit<PublicFilterQuery,'projection'>;
function matches(query: CatalogMatchQuery,quote:FxQuote|null=null) {
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
  const inquiryNumber = query.q && externalInquiryNumber(query.q);
  if (inquiryNumber) {
    where.push(`f.listing_id=(SELECT id FROM external_listings WHERE inquiry_number=${param(inquiryNumber)}::bigint)`);
  } else if (query.q) {
    const pattern = param(literalPattern(query.q));
    where.push(`s.search_document LIKE lower(${pattern}) ESCAPE E'\\\\'`);
    // The indexed document separates fields with newlines. Only a literal
    // containing that separator can match across two different fields.
    if(query.q.includes('\n'))
      where.push(`(${['stock_text','make_text','model_text','title_text'].map(field => `lower(s.${field}) LIKE lower(${pattern}) ESCAPE E'\\\\'`).join(' OR ')})`);
  }
  return { where: where.length ? ` AND ${where.join(' AND ')}` : '', values };
}

// Fixed-width inverse microseconds and UUID preserve newest-first/id-ascending order.
// 18 digits cover the API's complete year 0001..9999 timestamp domain.
export const facetLabelOrder = (timestamp:string,id:string) => `lpad((253402300799999999-floor(extract(epoch from ${timestamp})*1000000))::text,18,'0')||${id}::text`;
export type CatalogFacetRow = {kind:string;id:string|null;name:string|null;make_id:string|null;model_id:string|null;count:number};
export type CatalogModelPair = { makeId: string; modelId: string };

export function catalogModelScope(params: unknown[], pairs: readonly CatalogModelPair[], make: string, model: string) {
  const makes = `$${params.push(pairs.map(pair => pair.makeId))}::text[]`;
  const models = `$${params.push(pairs.map(pair => pair.modelId))}::text[]`;
  // The make predicate permits an indexed scan. Match exact pairs because model IDs can repeat across brands.
  return `${make}=ANY(${makes}) AND (${make},${model}) IN (SELECT * FROM unnest(${makes},${models}))`;
}

type FacetProjection = PublicFilterQuery['projection'];
const fullFacetKinds = ['make','model','trim','generation','powertrain','drivetrain','year','currency'] as const;
const overviewFacetKinds = ['make','powertrain','drivetrain','year'] as const;
const projectedFacetKinds = {
  overview: overviewFacetKinds,
  'overview-models': [...overviewFacetKinds,'model'],
  'home-models': ['model'],
  models: ['model'],
  variants: ['trim','generation'],
} as const;
const isFacetOverview = (projection: FacetProjection) => projection==='overview'||projection==='overview-models';
const staffFacetValues = {
  make: "('make',m.make_id,m.make_name,NULL::text,NULL::text)",
  model: "('model',m.model_id,m.model_name,m.make_id,NULL::text)",
  trim: "('trim',m.trim_id,m.trim_name,m.make_id,m.model_id)",
  generation: "('generation',m.generation_id,m.generation_name,m.make_id,m.model_id)",
  powertrain: "('powertrain',m.powertrain,NULL::text,NULL::text,NULL::text)",
  drivetrain: "('drivetrain',m.drivetrain,NULL::text,NULL::text,NULL::text)",
  year: "('year',m.model_year::text,NULL::text,NULL::text,NULL::text)",
  currency: "('currency',m.currency,NULL::text,NULL::text,NULL::text)",
};
const facetAvailability = `bool_or(make_id IS NOT NULL AND model_id IS NOT NULL AND trim_id IS NOT NULL) AS has_trims,
      bool_or(make_id IS NOT NULL AND model_id IS NOT NULL AND generation_id IS NOT NULL) AS has_generations`;
const facetOverviewRows = `UNION ALL SELECT 'hasTrims',NULL,NULL,NULL,coalesce(has_trims,false)::int,NULL FROM summary
    UNION ALL SELECT 'hasGenerations',NULL,NULL,NULL,coalesce(has_generations,false)::int,NULL FROM summary`;
/** Only grouped dictionaries leave PostgreSQL, regardless of matched catalogue size. */
export async function aggregateCatalogFacets(tx: Queryable, selection: string, values: unknown[], projection?: FacetProjection): Promise<CatalogFacetRow[]> {
  const kinds = projection ? projectedFacetKinds[projection] : fullFacetKinds;
  const overview = isFacetOverview(projection);
  const includeTotal = overview || projection===undefined;
  const result = await tx.query<CatalogFacetRow>(`WITH matched AS MATERIALIZED (${selection})
    ${includeTotal?`, summary AS (SELECT count(*)::int AS total${overview?`,${facetAvailability}`:''} FROM matched)`:''}, groups AS (
    SELECT d.kind,d.id,d.make_id,d.model_id,count(*)::int AS count,substring(min((m.label_order||d.name) COLLATE "C") FROM 55) AS name
    FROM matched m CROSS JOIN LATERAL (VALUES
      ${kinds.map(kind => staffFacetValues[kind]).join(',\n      ')}
    ) d(kind,id,name,make_id,model_id)
    WHERE d.id IS NOT NULL AND (d.kind NOT IN ('model','trim','generation') OR d.make_id IS NOT NULL)
      AND (d.kind NOT IN ('trim','generation') OR d.model_id IS NOT NULL)
    GROUP BY d.kind,d.id,d.make_id,d.model_id
  ) SELECT * FROM groups
    ${includeTotal?"UNION ALL SELECT 'total',NULL,NULL,NULL,total,NULL FROM summary":''}
    ${overview?facetOverviewRows:''}`, values);
  return result.rows;
}
const columns = `c.listing_id,c.published_at,c.facts,c.price_cny,c.issues,
  c.localized->$1::text AS localized,l.inquiry_number::text AS inquiry_number,l.fetched_at,l.source_updated_at,x.data AS extras,ARRAY(SELECT jsonb_object_keys(coalesce(o.data->'facts','{}'::jsonb))) AS overridden_names`;
const cardColumns = `c.listing_id,c.published_at,c.facts,c.price_cny,
  jsonb_build_object('title',c.localized->$1::text->'title','display',c.localized->$1::text->'display') AS localized,
  l.inquiry_number::text AS inquiry_number,l.fetched_at,l.source_updated_at,x.data AS extras,ARRAY(SELECT jsonb_object_keys(coalesce(o.data->'facts','{}'::jsonb))) AS overridden_names`;
const overridesJoin = ' LEFT JOIN external_listing_overrides o ON o.listing_id=c.listing_id';
const extrasJoin = ' LEFT JOIN external_vehicle_extras x ON x.listing_id=c.listing_id AND x.locale=$1::text' + overridesJoin;
const localizedCatalogFrom = 'FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale=$1::text';
const from = localizedCatalogFrom + extrasJoin;
// Catalogue rows only exist for visible listings. This second predicate is also useful when repairing projections.
const visible = "WHERE l.upstream_state='active'";
const ordered = 'ORDER BY c.published_at DESC,c.listing_id';
// Homepage checks combine this with a published projection and its locale index.
const homeExternalVisible = "l.upstream_state='active' AND l.formal_primary AND (o.data->'hidden') IS DISTINCT FROM 'true'::jsonb";

export async function eligibleExternalHomeIds(tx: PoolClient, ids: string[]) {
  if (!ids.length) return [];
  // Serialize with supplier publication, hide, withdrawal and representative changes.
  await tx.query('SELECT pg_advisory_xact_lock(78291332)');
  const result = await tx.query<{id:string}>(`SELECT l.id FROM external_listings l
    JOIN external_catalog c ON c.listing_id=l.id LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
    WHERE l.id=ANY($1::uuid[]) AND ${homeExternalVisible}
      AND EXISTS (SELECT 1 FROM external_catalog_search s WHERE s.listing_id=l.id)`, [ids]);
  return result.rows.map(({id}) => publicListingId(id));
}

function firstActiveCover(listing: string, asOf: string) {
  return `FROM external_media WHERE active AND listing_id=${listing} AND (expires_at IS NULL OR expires_at>${asOf}::timestamptz)
    ORDER BY position,id LIMIT 1`;
}
async function coverPhotos(tx: Queryable, ids: string[], time: number) {
  const result = await tx.query<ImageRow>(`SELECT m.* FROM unnest($1::uuid[]) AS picked(listing_id) CROSS JOIN LATERAL (
    SELECT id,listing_id,url,alt,width,height,position,revision,refreshed_at,expires_at
    ${firstActiveCover('picked.listing_id','$2')}) m`, [ids, new Date(time).toISOString()]);
  return new Map(result.rows.map(photo => [photo.listing_id, [photo]]));
}

export async function readExternalHomeVehicles(tx: PoolClient, ids: string[], locale: Locale, time: number,
  priceView?: 'usd', quote: FxQuote | null = null): Promise<PublicVehicle[]> {
  if (!ids.length) return [];
  const result = await tx.query<CatalogRow>(`SELECT ${cardColumns},c.issues ${from}
    WHERE c.listing_id=ANY($2::uuid[]) AND ${homeExternalVisible}`, [locale, ids]);
  if (!result.rows.length) return [];
  const covers = await coverPhotos(tx, result.rows.map(row => row.listing_id), time);
  return result.rows.map(row => {
    const card = toCard(row, covers.get(row.listing_id) ?? [], locale, priceView, quote);
    return PublicVehicleSchema.parse({ ...card, content: { ...card.content, description: null }, external: { issues: row.issues } });
  });
}

export async function readExternalHomeModelPairs(tx: PoolClient, ids: string[], locale: Locale, time: number) {
  if (!ids.length) return [];
  const result = await tx.query<{makeId:unknown;modelId:unknown;expiresAt:Date|null}>(`SELECT
      c.facts->'make'->'id' AS "makeId",c.facts->'model'->'id' AS "modelId",cover.expires_at AS "expiresAt"
    ${localizedCatalogFrom}${overridesJoin}
    CROSS JOIN LATERAL (SELECT expires_at ${firstActiveCover('c.listing_id','$3')}) cover
    WHERE c.listing_id=ANY($2::uuid[]) AND ${homeExternalVisible}`,
  [locale,ids,new Date(time).toISOString()]);
  return result.rows.flatMap(({makeId,modelId,expiresAt})=>{
    // Keep JSON types until validation. Text extraction can turn a malformed
    // numeric ID into a valid-looking string.
    const make=IdSchema.safeParse(makeId),model=IdSchema.safeParse(modelId);
    return make.success&&model.success?[{makeId:make.data,modelId:model.data,expiresAt}]:[];
  });
}

async function materialize(tx: Queryable, rows: CatalogRow[], locale: Locale, time: number,priceView?:'usd',quote:FxQuote|null=null,card=false):Promise<Array<PublicVehicle|PublicVehicleCard>> {
  if (!rows.length) return [];
  const ids=rows.map(row=>row.listing_id);
  // One indexed cover probe per picked listing; no full gallery travels to Node for card requests.
  if(card) {
    const covers=await coverPhotos(tx,ids,time);
    return rows.map(row=>toCard(row,covers.get(row.listing_id)??[],locale,priceView,quote));
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

export async function getExternalPublic(tx: Queryable, id: string, locale: Locale, time = Date.now(),priceView?:'usd',quote:FxQuote|null=null,titleView?:'english',includePixel=false) {
  const needsOtherLocale = titleView !== undefined && locale !== 'en';
  // Point lookups bind English to the same listing/version and eligibility as a standalone English detail.
  const englishColumns = needsOtherLocale ? `,CASE WHEN en.listing_id IS NOT NULL THEN jsonb_build_object(
    'title',c.localized#>'{en,title}','display',jsonb_build_object('make',c.localized#>'{en,display,make}',
    'model',c.localized#>'{en,display,model}','trim',c.localized#>'{en,display,trim}'),'names',xe.data->'names') END AS english` : '';
  const englishJoins = needsOtherLocale ? `LEFT JOIN external_catalog_search en ON en.listing_id=c.listing_id AND en.locale='en'
    LEFT JOIN external_vehicle_extras xe ON xe.listing_id=en.listing_id AND xe.locale='en'` : '';
  const pixelColumn = includePixel ? ',coalesce(pixel.pixel_enabled,false) AS pixel_enabled' : '';
  const pixelJoin = includePixel ? 'LEFT JOIN external_listing_pixel_settings pixel ON pixel.listing_id=l.id' : '';
  const result = await tx.query<CatalogRow>(`SELECT ${columns},jsonb_set(c.details,'{inspection}','null'::jsonb) AS details,l.provider,l.platform_id,l.external_id,l.source_revision::text,l.source_hash,
    CASE WHEN l.source_data IS NULL THEN NULL ELSE jsonb_build_object('platformId',l.source_data->'platformId','externalId',l.source_data->'externalId','disputes',coalesce(l.source_data->'disputes','[]'::jsonb),'inspection',jsonb_build_object('hasReport',l.source_data->'inspection'->'hasReport','reportUrl',l.source_data->'inspection'->'reportUrl')) END AS source_data,l.upstream_state,
    i.binding AS inspection_binding,jsonb_set(i.content,'{inspection}','null'::jsonb) AS inspection_content,ev.status AS inspection_status,ev.overview->'summary' AS inspection_summary
    ${englishColumns}${pixelColumn} ${from} LEFT JOIN external_inspection_enrichment i ON i.listing_id=l.id
    LEFT JOIN external_vehicle_evidence_sets ev ON ev.listing_id=l.id AND ev.locale=$1 AND ev.kind='inspection'
    ${englishJoins} ${pixelJoin} ${visible} AND c.listing_id=$2`, [locale, id]);
  const row = result.rows[0];
  if (!row) return null;
  const publicVehicle = (await materialize(tx, result.rows, locale, time,priceView,quote))[0] as PublicVehicle;
  const vehicle = includePixel ? { ...publicVehicle, pixelEnabled: row.pixel_enabled===true } : publicVehicle;
  if (!titleView) return vehicle;
  const english = needsOtherLocale ? row.english : { title: vehicle.content.title, display: vehicle.display, names: null };
  if (!english) return vehicle;
  const explicit = explicitEnglishDetailTitle(english.title);
  if (explicit) return { ...vehicle, englishTitle: explicit };
  const display: CatalogNames = {};
  for (const key of catalogNameKeys) {
    if (!row.facts[key]) continue;
    const name = catalogName(row, key, english.display?.[key], english.names?.[key]);
    if (name) display[key] = safeExternalDisplayText('en',name);
  }
  const englishTitle = englishCatalogTitle(display, row.facts.modelYear);
  return englishTitle && isPublicText(englishTitle.text) ? { ...vehicle, englishTitle } : vehicle;
}
// A transactionally maintained read model carries only visibility and filter scalars.
// Text eligibility joins the search projection only when a literal search is requested.
const filterFrom = (query: CatalogMatchQuery) => 'FROM external_catalog_filter f' +
  (query.q && !externalInquiryNumber(query.q) ? ' JOIN external_catalog_search s ON s.listing_id=f.listing_id AND s.locale=$1::text' : '') +
  (query.exportStatus && query.exportStatus!=='all' ? ' LEFT JOIN external_vehicle_extras x ON x.listing_id=f.listing_id AND x.locale=$1::text' : '');
const visibleLocaleMasks = `(CASE $1::text WHEN 'zh' THEN ARRAY[1,3,5,7] WHEN 'en' THEN ARRAY[2,3,6,7]
  WHEN 'ru' THEN ARRAY[4,5,6,7] ELSE ARRAY[]::integer[] END)::smallint[]`;
const filterVisible = `WHERE f.active AND f.locale_mask<>0 AND f.locale_mask=ANY(${visibleLocaleMasks})`;
const groupVisible = `WHERE f.locale_mask=ANY(${visibleLocaleMasks})`;
const filterOrdered = 'ORDER BY f.published_at DESC,f.listing_id';
const maxCombinedSearchMatches = 8_192;

function canUseExternalPowerYearGroups(query:CatalogMatchQuery) {
  // Known powertrain and a year bound exclude every row omitted by the groups.
  return Boolean(query.powertrain) && query.powertrain!=='unknown'
    && (query.yearMin!==undefined||query.yearMax!==undefined)
    && !query.q && !query.model && !query.trim && !query.generation
    && query.mileageMin===undefined && query.mileageMax===undefined
    && query.priceMin===undefined && query.priceMax===undefined
    && (!query.exportStatus||query.exportStatus==='all');
}

export function canCountExternalSearchPage(query:PublicVehicleQuery) {
  // Keep the direct ordered scan for deep pages, cursors and short searches.
  return query.projection==='card' && query.page===1 && !query.cursor && !query.pagination && (query.sort??'newest')==='newest'
    && Boolean(query.q && !externalInquiryNumber(query.q) && /[\p{L}\p{N}]{3}/u.test(query.q));
}

export async function countExternal(tx: Queryable, query: CatalogMatchQuery,quote:FxQuote|null=null): Promise<number> {
  const { where, values } = matches(query,quote);
  if (!where) {
    // Count the same active locale masks in the caller's catalog snapshot.
    const result = await tx.query<{total:number|null}>(`SELECT sum(s.locale_counts[visible.mask])::int AS total
      FROM external_catalog_state s CROSS JOIN unnest(${visibleLocaleMasks}) AS visible(mask) WHERE s.id=1`, values);
    const total = result.rows[0]?.total;
    if (total == null) throw new ApiError(503,'SERVICE_UNAVAILABLE','Public catalog is temporarily unavailable.',undefined,true);
    return total;
  }
  if(canUseExternalPowerYearGroups(query)) {
    const result=await tx.query<{total:number}>(`SELECT coalesce(sum(f.row_count),0)::int AS total
      FROM external_catalog_overview_groups f ${groupVisible}${where}`,values);
    return result.rows[0]!.total;
  }
  const result = await tx.query<{ total: number }>(`SELECT count(*)::int AS total ${filterFrom(query)} ${filterVisible}${where}`, values);
  return result.rows[0]!.total;
}
function externalUsdSort(quote:FxQuote|null, values:unknown[]) {
  const rate = quote?.rates.CNY;
  const range = usdSourceRange('CNY',quote);
  if (!rate || !range) return 'NULL::numeric';
  const last = values.push(range.minimum,range.maximum,rate);
  // The inverse price range is exact in source cents. Convert only supported CNY prices.
  return `CASE WHEN f.price_cny BETWEEN $${last-2}::numeric AND $${last-1}::numeric
    THEN ${exactUsdSortValue('f.price_cny',`$${last}::numeric`)} END`;
}

export async function listExternalPage(tx: Queryable, query: PublicVehicleQuery, limit: number, offset: number, time: number, after?: CatalogAnchor,quote:FxQuote|null=null, countMatches=false):
Promise<{items:Array<PublicVehicle|PublicVehicleCard>;anchors:CatalogAnchor[];total?:number}> {
  const { where, values } = matches(query,quote);
  const sort=query.sort??'newest',numeric=numericSort(sort);
  let column=sort==='mileage_asc'?'f.mileage_km':sort==='year_desc'?'f.model_year':'f.price_cny';
  if(sort.startsWith('price_')&&query.priceView==='usd')column=externalUsdSort(quote,values);
  const sortSelect=numeric?`,(${column}) AS sort_value`:',f.published_at';
  const matched=`SELECT f.listing_id${sortSelect} ${filterFrom(query)} ${filterVisible}${where}`;
  const includeTotal=countMatches&&!after&&canCountExternalSearchPage(query);
  // A newest search can reuse exact matches for both the total and the page.
  // Keep the wide public projection out of the match set.
  const selection=includeTotal?`SELECT f.* FROM matching f WHERE (SELECT total FROM totals)<=${maxCombinedSearchMatches}`:matched;
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
  const page=`SELECT ${query.projection==='card'?cardColumns:columns},to_char(c.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_published_at
      ${numeric?',picked.sort_value::text AS cursor_sort_value':''}
    FROM picked JOIN external_catalog c ON c.listing_id=picked.listing_id
    JOIN external_listings l ON l.id=c.listing_id
    JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale=$1::text ${extrasJoin}
    ${visible}`;
  const result=await tx.query<CatalogRow & {cursor_published_at:string;cursor_sort_value?:string|null;total?:number}>(includeTotal
    ? `WITH matching AS MATERIALIZED (${matched} LIMIT ${maxCombinedSearchMatches+1}),
      totals AS MATERIALIZED (SELECT count(*)::int AS total FROM matching), picked AS MATERIALIZED (${picked})
      SELECT page.*, totals.total FROM totals
      LEFT JOIN (${page}) page ON true ORDER BY page.published_at DESC,page.listing_id`
    : `WITH picked AS MATERIALIZED (${picked}) ${page}
      ${numeric?`ORDER BY ${catalogOrder('picked.sort_value','c.listing_id',sort)}`:ordered}`,values);
  const total=result.rows[0]?.total;
  // Common terms may match most of the catalog. In that case keep the usual
  // ordered page plan and let the caller compute the exact total separately.
  if(total!==undefined&&total>maxCombinedSearchMatches) return listExternalPage(tx,query,limit,offset,time,after,quote);
  // An out-of-range offset still returns the exact total, with no vehicle row.
  const rows=result.rows.filter(row=>row.listing_id!==null);
  return {items:await materialize(tx,rows,query.locale,time,query.priceView,quote,query.projection==='card'),
    anchors:rows.map(row=>({id:row.listing_id,publishedAt:row.cursor_published_at,...(numeric?{sortValue:row.cursor_sort_value??null}:{})})),
    total};
}
const externalFacetGroups = {
  make: ['make_id'], model: ['model_id','make_id'], trim: ['trim_id','make_id','model_id'],
  generation: ['generation_id','make_id','model_id'], powertrain: ['powertrain'],
  drivetrain: ['drivetrain'], year: ['model_year'], currency: ['price_available'],
} as const;
const facetLabelKinds = ['make','model','trim','generation'] as const;
const namedFacetKinds: ReadonlySet<string> = new Set(facetLabelKinds);
type FacetLabelKind = typeof facetLabelKinds[number];

function externalFacetLabel(kind:FacetLabelKind) {
  const label=`label.${kind}_label`;
  if(kind==='generation')return label;
  return `CASE WHEN coalesce(overrides.data->'facts' ? '${kind}',false)
    OR labels.localized->$1::text->'display'->'${kind}'->>'provenance'='human' THEN ${label}
    ELSE coalesce(extra.data->'names'->'${kind}'->>'text',${label}) END`;
}

const facetLabelJoins = `JOIN external_catalog labels ON labels.listing_id=label.listing_id
  LEFT JOIN external_listing_overrides overrides ON overrides.listing_id=label.listing_id
  LEFT JOIN external_vehicle_extras extra ON extra.listing_id=label.listing_id AND extra.locale=label.locale`;

type OverviewFacetRow = CatalogFacetRow & {pending_make_winner?:string|null};
export type SupplierFacetPhase = 'supplier_overview_rollup'|'supplier_pending_labels'|'supplier_label_fallback';

async function resolvePendingOverviewLabels(tx:Queryable,rows:OverviewFacetRow[],locale:Locale,observe?: (phase:SupplierFacetPhase)=>void,
  beforeSupplement?:()=>Promise<void>) {
  const pending=rows.flatMap(row=>row.pending_make_winner?[row.pending_make_winner]:[]);
  if(pending.length) {
    observe?.('supplier_pending_labels');
    await beforeSupplement?.();
    // Older groups can still be pending during a staged backfill. Read exactly
    // those winners from the authoritative rows in the same snapshot.
    const result=await tx.query<{listing_id:string;name:string|null}>(`SELECT pending.listing_id,(
      SELECT ${externalFacetLabel('make')} FROM external_catalog_search label ${facetLabelJoins}
      WHERE label.listing_id=pending.listing_id AND label.locale=$1::text
    ) AS name FROM unnest($2::uuid[]) AS pending(listing_id)`,[locale,[...new Set(pending)]]);
    const names=new Map(result.rows.map(row=>[row.listing_id,row.name]));
    for(const row of rows)if(row.pending_make_winner)row.name=names.get(row.pending_make_winner)??null;
  }
  return rows.map(({pending_make_winner:_pending,...row})=>row);
}

function externalFacetGroup(kind: keyof typeof externalFacetGroups, currency:'CNY'|'USD') {
  const columns = externalFacetGroups[kind];
  const [id, make, model] = columns;
  const label = namedFacetKinds.has(kind) ? 'min(label_order COLLATE "C")' : 'NULL::text';
  const valid = kind==='currency' ? 'price_available'
    : columns.map(column=>`${column} IS NOT NULL`).concat(kind==='powertrain'?["powertrain<>'unknown'"]:[]).join(' AND ');
  return `SELECT '${kind}' AS kind,${kind==='currency'?`'${currency}'`:id+'::text'} AS id,
    ${make??'NULL::text'} AS make_id,${model??'NULL::text'} AS model_id,sum(row_count)::int AS count,${label} AS label_order
    FROM atoms WHERE ${valid} GROUP BY ${columns.join(',')}`;
}
const fullFacetDimensions = ['make_id','model_id','trim_id','generation_id','powertrain','drivetrain','model_year','price_available'];
const projectedFacetDimensions = {
  overview: ['make_id','powertrain','drivetrain','model_year'],
  'overview-models': ['make_id','model_id','powertrain','drivetrain','model_year'],
  'home-models': ['make_id','model_id'],
  models: ['make_id','model_id'],
  variants: ['make_id','model_id','trim_id','generation_id'],
};

function externalOverviewGroups(withModels:boolean) {
  // Model groups include make_id too, so check the model key before make.
  const kinds=withModels?['model',...overviewFacetKinds] as const:overviewFacetKinds;
  const groupSets=kinds.map(kind=>`(${externalFacetGroups[kind].join(',')})`);
  const axis=kinds.map(kind=>`WHEN GROUPING(${externalFacetGroups[kind][0]})=0 THEN '${kind}'`);
  const facetIds=kinds.map(kind=>`WHEN '${kind}' THEN ${externalFacetGroups[kind][0]}::text`);
  return `, rollups AS MATERIALIZED (
    SELECT CASE ${axis.join(' ')} ELSE 'total' END AS kind,
      ${projectedFacetDimensions[withModels?'overview-models':'overview'].join(',')},
      coalesce(sum(row_count),0)::int AS total,min(label_order COLLATE "C") AS label_order,
      bool_or(has_trims) AS has_trims,bool_or(has_generations) AS has_generations
    FROM atoms GROUP BY GROUPING SETS (${groupSets.join(',')},())
  ), facets AS (
    SELECT kind,id,make_id,NULL::text AS model_id,count,label_order FROM (
      SELECT kind,CASE kind ${facetIds.join(' ')} END AS id,
        CASE WHEN kind='model' THEN make_id END AS make_id,total AS count,
        CASE WHEN kind IN ('make','model') THEN label_order END AS label_order
      FROM rollups
    ) grouped WHERE kind='total' OR (id IS NOT NULL AND (kind<>'model' OR make_id IS NOT NULL)
      AND (kind<>'powertrain' OR id<>'unknown'))
    UNION ALL SELECT 'hasTrims',NULL,NULL,NULL,coalesce(has_trims,false)::int,NULL FROM rollups WHERE kind='total'
    UNION ALL SELECT 'hasGenerations',NULL,NULL,NULL,coalesce(has_generations,false)::int,NULL FROM rollups WHERE kind='total'
  )`;
}

export async function externalFacets(tx: Queryable, query: PublicFilterQuery,quote:FxQuote|null=null, pairs?: readonly CatalogModelPair[],
  observe?: (phase:SupplierFacetPhase)=>void, beforeSupplement?:()=>Promise<void>) {
  const { where: filters, values } = matches(query,quote);
  const where = pairs ? `${filters} AND ${catalogModelScope(values,pairs,'f.make_id','f.model_id')}` : filters;
  const matchingValues=[...values];
  const {projection}=query;
  const kinds=projection?projectedFacetKinds[projection]:fullFacetKinds;
  const dimensions=projection?projectedFacetDimensions[projection]:fullFacetDimensions;
  const overview=isFacetOverview(projection);
  const full=projection===undefined;
  const currency=query.priceView==='usd'?'USD':'CNY';
  let priceAvailable='f.price_cny IS NOT NULL';
  if(full && query.priceView==='usd') {
    const range=usdSourceRange('CNY',quote);priceAvailable='false';
    if(range){values.push(range.minimum,range.maximum);priceAvailable=`coalesce(f.price_cny>=$${values.length-1}::numeric AND f.price_cny<=$${values.length}::numeric,false)`;}
  }
  const inputColumns=overview?[...new Set([...dimensions,'model_id','trim_id','generation_id'])]:dimensions;
  const matchedDimensions=inputColumns.map(column=>column==='price_available'?`${priceAvailable} AS price_available`:`f.${column}`);
  const groupBy=dimensions.join(',');
  const groups=overview?externalOverviewGroups(projection==='overview-models'):
    `${full?', summary AS (SELECT coalesce(sum(row_count),0)::int AS total FROM atoms)':''}, facets AS (
      ${kinds.map(kind=>externalFacetGroup(kind,currency)).join('\n      UNION ALL ')}
      ${full?"UNION ALL SELECT 'total',NULL,NULL,NULL,total,NULL FROM summary":''}
    )`;
  const needed=facetLabelKinds.filter(kind=>kinds.some(value=>value===kind));
  // First coalesce identical complete facet tuples. Counts and minimum winner
  // keys are distributive, so grouping these atoms by each dimension preserves
  // exact counts. Overview keeps only overview dimensions in the grouping; variant
  // IDs contribute to availability without producing per-variant dictionaries.
  const useRollup=!pairs&&projection==='overview'&&canUseExternalPowerYearGroups(query);
  const atoms=useRollup?`atoms AS MATERIALIZED (
    SELECT f.make_id,f.powertrain,f.drivetrain,f.model_year,f.trim_count>0 AS has_trims,
      f.generation_count>0 AS has_generations,f.label_order,f.row_count,
      f.make_winner_labels[array_position(ARRAY['zh','en','ru']::text[],$1::text)] AS make_name,
      f.make_winner_labels IS NULL AS label_pending
    FROM external_catalog_overview_groups f ${groupVisible}${where}
  )`:`matched AS NOT MATERIALIZED (
    SELECT ${matchedDimensions.join(',')},f.label_order
    ${filterFrom(query)} ${filterVisible}${where}
  ), atoms AS MATERIALIZED (
    SELECT ${groupBy},${overview?`${facetAvailability},`:''}
      min(label_order COLLATE "C") FILTER (WHERE make_id IS NOT NULL) AS label_order,count(*)::int AS row_count
    FROM matched GROUP BY ${groupBy}
  )`;
  if(useRollup)observe?.('supplier_overview_rollup');
  // Select the name from the same atom that supplies the ordered winning ID.
  // Tied keys identify the same vehicle, so a filled copy of that name is safe.
  const statement=useRollup?`WITH ${atoms}${groups}, winner_labels AS (
    SELECT DISTINCT ON (make_id) make_id,make_name,
      CASE WHEN label_pending THEN substring(label_order FROM 19 FOR 36)::uuid END AS pending_make_winner
    FROM atoms WHERE make_id IS NOT NULL
    ORDER BY make_id,label_order COLLATE "C",label_pending
  ) SELECT g.kind,g.id,g.make_id,g.model_id,g.count,winner.make_name AS name,winner.pending_make_winner
  FROM facets g LEFT JOIN winner_labels winner ON g.kind='make' AND winner.make_id=g.id`
    :`WITH ${atoms}${groups}, winner_ids AS (
    SELECT DISTINCT substring(label_order FROM 19 FOR 36)::uuid AS listing_id FROM facets WHERE label_order IS NOT NULL
  ), winner_labels AS MATERIALIZED (
    SELECT label.listing_id,${needed.map(kind=>`${externalFacetLabel(kind)} AS ${kind}`).join(',\n      ')}
    FROM winner_ids JOIN external_catalog_search label ON label.listing_id=winner_ids.listing_id AND label.locale=$1::text
    ${facetLabelJoins}
  ) SELECT g.kind,g.id,g.make_id,g.model_id,g.count,
    CASE g.kind ${needed.map(kind=>`WHEN '${kind}' THEN winner.${kind}`).join(' ')} END AS name
  FROM facets g LEFT JOIN winner_labels winner ON winner.listing_id=substring(g.label_order FROM 19 FOR 36)::uuid`;
  const result=await tx.query<OverviewFacetRow>(statement,values);
  // Historical projections may contain a null label despite a present ID. The
  // previous min(order || name) ignored those rows; preserve that rare fallback
  // without probing labels for every normal matched vehicle.
  const rows=useRollup?await resolvePendingOverviewLabels(tx,result.rows,query.locale,observe,beforeSupplement):result.rows;
  const missing=rows.filter(row=>namedFacetKinds.has(row.kind)&&row.name===null);
  if(missing.length) {
    observe?.('supplier_label_fallback');
    await beforeSupplement?.();
    const name=`CASE missing.kind ${facetLabelKinds.map(kind=>`WHEN '${kind}' THEN ${externalFacetLabel(kind)}`).join(' ')} END`;
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
  return rows.map(row=>namedFacetKinds.has(row.kind) && (!row.name || !isPublicText(row.name))
    ? {...row,name:fallbackExternalTitle(query.locale).text}:row);
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
