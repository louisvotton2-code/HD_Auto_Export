import type { PoolClient } from 'pg';
import {
  PublicVehicleSchema, type ExternalIssue, type Locale, type PublicFilterQuery, type PublicMedia, type PublicVehicle, type VehicleDisplay,
} from '@hd/contracts/public';
import type {FxQuote} from './fx.js';
import {projectUsdPrice,usdSourceRange} from '../vehicles/usd-price.js';
import type { Database } from '../db/index.js';
import { displayText, publicText, type ExternalProjection } from './normalize.js';
import type { ReportSourceRow } from './report-evidence.js';
import { projectSourceReport } from './reports.js';
import { applyInspectionEnrichment } from './inspection-enrichment.js';

export const publicListingId = (id: string) => `ext-${id}`;
export const listingUuid = (id: string) => id.slice(4);
export const publicMediaId = (id: string) => `ximg-${id}`;
const stockCode = (id: string) => `EXT-${id.toUpperCase()}`;
type Queryable = Pick<Database['pool'] | PoolClient, 'query'>;
type CatalogRow = {
  listing_id: string; platform_id: string; platform_name: string; listing_url: string;
  facts: ExternalProjection['facts']; price_cny: string | null; issues: ExternalIssue[];
  localized: ExternalProjection['localized'][Locale]; details?: ExternalProjection['details'];
  fetched_at: Date; source_updated_at: Date | null; published_at: Date;
  provider?: string; external_id?: string; source_revision?: string; source_hash?: string;
  source_data?: ReportSourceRow['source_data']; upstream_state?: string;
  inspection_binding?: unknown; inspection_content?: unknown;
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
  const images: PublicMedia[] = available.map((photo, i) => ({
    id: publicMediaId(photo.id), url: photo.url, alt: photo.alt?.text ?? '', width: photo.width, height: photo.height,
    sortOrder: photo.position, isCover: i === 0,
    remote: { revision: photo.revision, refreshedAt: photo.refreshed_at.toISOString(), expiresAt: iso(photo.expires_at) },
  }));
  const { title, description } = row.localized;
  const display = { ...row.localized.display, mediaAlt: available.map(photo => ({ mediaId: publicMediaId(photo.id), value: displayText(locale, photo.alt) })) };
  const id = publicListingId(row.listing_id);
  const source: ReportSourceRow = { id: row.listing_id, provider: row.provider!, platform_id: row.platform_id,
    external_id: row.external_id!, source_revision: row.source_revision!, source_hash: row.source_hash!, source_data: row.source_data ?? null,
    upstream_state: row.upstream_state! };
  const enriched = row.details ? applyInspectionEnrichment(source, row.details, row.inspection_binding
    ? { binding: row.inspection_binding, content: row.inspection_content } : null) : undefined;
  // Strip legacy persisted links and verification metadata on every public read, including old projections.
  const detail = enriched ? { ...enriched, inspection: enriched.inspection
    ? { ...enriched.inspection, reportUrl: null, reportAccess: { status: 'unknown' as const, url: null, checkedAt: null, expiresAt: null } } : null } : undefined;
  const report = detail ? projectSourceReport(source, row.inspection_binding
    ? { binding: row.inspection_binding, content: row.inspection_content } : null) : null;
  const original = (field: keyof ExternalProjection['details']['original']) => {
    const value = detail?.original[field];
    return value ? publicText(locale, value) : null;
  };
  const price:PublicVehicle['price']=row.price_cny===null?{kind:'on_request',money:null,includes:[]}:{kind:'reference',money:{amount:row.price_cny,currency:'CNY'},includes:[]};
  return PublicVehicleSchema.parse({
    id, stockCode: stockCode(row.listing_id), detailPath: `/${locale}/cars/${id}/`,
    source: { kind: 'external', platform: { id: row.platform_id, name: row.platform_name }, listingUrl: row.listing_url },
    facts: localizedFacts(row.facts, display), display,
    price,...(priceView==='usd'?{displayPrice:projectUsdPrice(price,quote)}:{}),
    content: { title, description }, images,
    ...(report ? { report: { hasReport: report.hasReport } } : {}),
    availability: 'unknown', availabilityCheckedAt: null, sourceUpdatedAt: iso(row.source_updated_at),
    fetchedAt: row.fetched_at.toISOString(), publishedAt: row.published_at.toISOString(),
    external: {
      issues,
      ...(detail ? { detail: { ...detail, original: { title: original('title'), model: original('model'), description: original('description') } } } : {}),
    },
  });
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
export type CatalogAnchor = {publishedAt:string;id:string};
const columns = `c.listing_id,c.published_at,c.platform_name,c.listing_url,c.facts,c.price_cny,c.issues,
  c.localized->$1::text AS localized,l.platform_id,l.fetched_at,l.source_updated_at`;
const from = 'FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale=$1::text';
// Catalogue rows only exist for visible listings. This second predicate is also useful when repairing projections.
const visible = "WHERE l.upstream_state='active'";
const ordered = 'ORDER BY c.published_at DESC,c.listing_id';

async function materialize(tx: Queryable, rows: CatalogRow[], locale: Locale, time: number,priceView?:'usd',quote:FxQuote|null=null) {
  if (!rows.length) return [];
  const photos = await tx.query<ImageRow>(`SELECT id,listing_id,url,alt,width,height,position,revision,refreshed_at,expires_at
    FROM external_media WHERE active AND listing_id=ANY($1::uuid[]) ORDER BY listing_id,position,id`, [rows.map(row => row.listing_id)]);
  const images = new Map<string, ImageRow[]>();
  for (const photo of photos.rows) {
    const listingImages = images.get(photo.listing_id) ?? [];
    listingImages.push(photo);
    images.set(photo.listing_id, listingImages);
  }
  return rows.map(row => toPublic(row, images.get(row.listing_id) ?? [], locale, time,priceView,quote));
}

export async function getExternalPublic(tx: Queryable, id: string, locale: Locale, time = Date.now(),priceView?:'usd',quote:FxQuote|null=null) {
  const result = await tx.query<CatalogRow>(`SELECT ${columns},c.details,l.provider,l.external_id,l.source_revision::text,l.source_hash,l.source_data,l.upstream_state,
    i.binding AS inspection_binding,i.content AS inspection_content
    ${from} LEFT JOIN external_inspection_enrichment i ON i.listing_id=l.id ${visible} AND c.listing_id=$2`, [locale, id]);
  return (await materialize(tx, result.rows, locale, time,priceView,quote))[0] ?? null;
}
// A transactionally maintained read model carries only visibility and filter scalars.
// Text eligibility joins the search projection only when a literal search is requested.
const filterFrom = (query: PublicFilterQuery) => 'FROM external_catalog_filter f' +
  (query.q ? ' JOIN external_catalog_search s ON s.listing_id=f.listing_id AND s.locale=$1::text' : '');
const filterVisible = `WHERE f.active AND f.locale_mask<>0 AND (f.locale_mask & CASE $1::text WHEN 'zh' THEN 1 WHEN 'en' THEN 2 WHEN 'ru' THEN 4 ELSE 0 END)<>0`;
const filterOrdered = 'ORDER BY f.published_at DESC,f.listing_id';

export async function countExternal(tx: Queryable, query: PublicFilterQuery,quote:FxQuote|null=null): Promise<number> {
  const { where, values } = matches(query,quote);
  const result = await tx.query<{ total: number }>(`SELECT count(*)::int AS total ${filterFrom(query)} ${filterVisible}${where}`, values);
  return result.rows[0]!.total;
}
export async function listExternalPage(tx: Queryable, query: PublicFilterQuery, limit: number, offset: number, time: number, after?: CatalogAnchor,quote:FxQuote|null=null) {
  const { where, values } = matches(query,quote);
  const selection=`SELECT f.listing_id,f.published_at ${filterFrom(query)} ${filterVisible}${where}`;
  let picked:string;
  if(after) {
    values.push(after.publishedAt,after.id);
    const time=`$${values.length-1}::timestamptz`,id=`$${values.length}::uuid`,size=`$${values.length+1}`;
    // Both seeks are bounded before any wide JSON or localized rows are fetched.
    picked=`SELECT * FROM (
      (${selection} AND f.published_at=${time} AND f.listing_id>${id} ${filterOrdered} LIMIT ${size})
      UNION ALL (${selection} AND f.published_at<${time} ${filterOrdered} LIMIT ${size})
    ) seeked ORDER BY published_at DESC,listing_id LIMIT ${size}`;
    values.push(limit);
  } else {
    picked=`${selection} ${filterOrdered} LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    values.push(limit,offset);
  }
  const result=await tx.query<CatalogRow & {cursor_published_at:string}>(`WITH picked AS MATERIALIZED (${picked})
    SELECT ${columns},to_char(c.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_published_at
    FROM picked JOIN external_catalog c ON c.listing_id=picked.listing_id
    JOIN external_listings l ON l.id=c.listing_id
    JOIN external_catalog_search s ON s.listing_id=c.listing_id AND s.locale=$1::text
    ${visible} ${ordered}`,values);
  return {items:await materialize(tx,result.rows,query.locale,time,query.priceView,quote),anchors:result.rows.map(row=>({id:row.listing_id,publishedAt:row.cursor_published_at}))};
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
      SELECT make_label,model_label,trim_label,generation_label FROM external_catalog_search
      WHERE listing_id=substring(g.label_order FROM 19 FOR 36)::uuid AND locale=$1::text
        AND g.kind IN ('make','model','trim','generation') LIMIT 1
    ) winner ON true`,values);
  // Historical projections may contain a null label despite a present ID. The
  // previous min(order || name) ignored those rows; preserve that rare fallback
  // without probing labels for every normal matched vehicle.
  const missing=result.rows.filter(row=>['make','model','trim','generation'].includes(row.kind)&&row.name===null);
  if(missing.length) {
    const name=`CASE missing.kind WHEN 'make' THEN label.make_label WHEN 'model' THEN label.model_label
      WHEN 'trim' THEN label.trim_label WHEN 'generation' THEN label.generation_label END`;
    const fallback=await tx.query<Pick<CatalogFacetRow,'kind'|'id'|'name'|'make_id'|'model_id'>>(`SELECT missing.*,selected.name
      FROM jsonb_to_recordset($${matchingValues.length+1}::jsonb) AS missing(kind text,id text,make_id text,model_id text)
      CROSS JOIN LATERAL (
        SELECT ${name} AS name ${filterFrom(query)}
        JOIN external_catalog_search label ON label.listing_id=f.listing_id AND label.locale=$1::text
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
