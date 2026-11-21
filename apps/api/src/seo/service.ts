import { z } from 'zod';
import type { PoolClient } from 'pg';
import { SeoVehicleIdSchema, type Locale, type PublicSeoManifest, type PublicSeoQuery, type PublicVehicleSeo } from '@hd/contracts/public';
import type { Database } from '../db/index.js';
import { jsonHash } from '../external/normalize.js';
import { ApiError } from '../errors.js';
import { eligibleSeoLocales, SEO_EXTERNAL_LIMIT, type SeoRecord } from './eligibility.js';
type Queryable = Pick<PoolClient, 'query'>;
// Return only qualification fields; never transfer configuration/report payloads into the generation lane.
const localeProjection = (column: string, manualDisplay = false) => `jsonb_build_object(${['zh','en','ru'].map(locale => {
 const value = `${column}->'${locale}'`;
 const display = `jsonb_build_object('make',${value}->'display'->'make','model',${value}->'display'->'model')`;
 return `'${locale}',jsonb_build_object(${manualDisplay ? '' : `'title',${value}->'title','description',${value}->'description',`}'display',${display})`;
}).join(',')})`;
const external = `SELECT 'ext-'||l.id::text AS id,'external' AS kind,c.facts,${localeProjection('c.localized')} AS localized,NULL::jsonb AS content,
 c.price_cny::text AS price,(l.upstream_state='active' AND l.formal_primary AND coalesce(o.data->>'hidden','false')='false') AS visible,
 EXISTS(SELECT FROM external_media m WHERE m.listing_id=l.id AND m.active AND (m.expires_at IS NULL OR m.expires_at>$1)) AS has_image,
 (SELECT CASE WHEN bool_or(m.expires_at IS NULL) THEN NULL ELSE max(m.expires_at) END FROM external_media m
   WHERE m.listing_id=l.id AND m.active AND (m.expires_at IS NULL OR m.expires_at>$1)) AS image_until,
 greatest(c.published_at,l.source_updated_at,l.fetched_at) AS last_modified,NULL::jsonb AS display
 FROM external_catalog c JOIN external_listings l ON l.id=c.listing_id LEFT JOIN external_listing_overrides o ON o.listing_id=l.id`;
const manual = `SELECT v.id::text AS id,'manual' AS kind,p.data->'facts' AS facts,'{}'::jsonb AS localized,p.data->'content' AS content,
 p.data->'price'->'money'->>'amount' AS price,
 (v.publication_state='published' AND v.deleted_at IS NULL AND v.availability='available' AND p.data->'source'->>'kind'='manual') AS visible,
 EXISTS(SELECT FROM publication_media pm JOIN media_assets m ON m.id=pm.media_id
   WHERE pm.publication_id=p.id AND m.state='ready' AND m.vehicle_id=v.id AND v.published_at<=$1::timestamptz) AS has_image,
 NULL::timestamptz AS image_until,greatest(v.published_at,v.availability_checked_at) AS last_modified,${localeProjection('pl.projections',true)} AS display
 FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id
 LEFT JOIN publication_localizations pl ON pl.publication_id=p.id`;
const allSelected = `(${manual} WHERE v.publication_state='published' AND v.deleted_at IS NULL AND v.availability='available' AND p.data->'source'->>'kind'='manual') UNION ALL (${external} JOIN seo_external_selection chosen ON chosen.listing_id=l.id)`;
const cursorSchema = z.strictObject({ v: z.literal(1), revision: z.string().min(1).max(100), after: SeoVehicleIdSchema });
const disabled = (): PublicVehicleSeo => ({ indexable: false, locales: [], lastModified: null });
async function version(tx: Queryable) {
 const row = (await tx.query<{epoch:string;revision:string}>('SELECT epoch::text,revision::text FROM public_catalog_state WHERE id=1')).rows[0];
 if (!row) throw new ApiError(503,'SERVICE_UNAVAILABLE','SEO catalog is temporarily unavailable.');
 return row.epoch;
}
export async function vehicleSeo(tx: Queryable, id: string, locale: Locale, enabled: boolean, now = new Date()): Promise<PublicVehicleSeo> {
 if (!enabled) return disabled();
 if (!SeoVehicleIdSchema.safeParse(id).success) return disabled();
 const sql=id.startsWith('ext-') ? `${external} JOIN seo_external_selection chosen ON chosen.listing_id=l.id WHERE l.id=$2::uuid`
  : `${manual} WHERE v.id=$2::uuid`;
 const row=(await tx.query<SeoRecord>(sql,[now,id.replace(/^ext-/, '')])).rows[0];
 if(!row)return disabled();
 const locales=eligibleSeoLocales(row);
 return {indexable:locales.includes(locale),locales,lastModified:locales.length?row.last_modified.toISOString():null};
}
export async function seoManifest(db: Database, query: PublicSeoQuery, enabled: boolean, now = new Date(), externalEnabled=true): Promise<PublicSeoManifest> {
 if (!enabled) return {enabled:false,validUntil:null,revision:'disabled',items:[],nextCursor:null};
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await tx.query("SET LOCAL statement_timeout='3s'; SET LOCAL transaction_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
  // Only the actual indexable scope participates. Unselected supplier traffic must not starve sitemap generation.
  // Fail instead of silently truncating an unexpectedly large first-wave manifest.
  const rows=(await tx.query<SeoRecord>(`SELECT * FROM (${externalEnabled?allSelected:manual}) selected WHERE kind='external' OR visible ORDER BY id COLLATE "C" LIMIT 10001`,[now])).rows;
  if(rows.length>10000)throw new ApiError(503,'SERVICE_UNAVAILABLE','SEO scope exceeds the first-wave manifest limit.');
  const qualified=rows.flatMap(row=>{const locales=eligibleSeoLocales(row);return locales.length?[{row,locales}]:[];});
  const expiries=qualified.flatMap(({row})=>row.image_until?[row.image_until.getTime()]:[]);
  const validUntil=expiries.length?new Date(Math.min(...expiries)).toISOString():null;
  const revision=jsonHash({policy:1,epoch:await version(tx),externalEnabled,validUntil,
    entries:qualified.map(({row,locales})=>({id:row.id,lastModified:row.last_modified.toISOString(),imageUntil:row.image_until?.toISOString()??null,locales}))});
  let after='';
  if(query.cursor) {
   let cursor:z.infer<typeof cursorSchema>;
   try {const decoded=Buffer.from(query.cursor,'base64url');if(decoded.toString('base64url')!==query.cursor)throw new Error();cursor=cursorSchema.parse(JSON.parse(decoded.toString('utf8')));}
   catch {throw new ApiError(400,'INVALID_REQUEST','Invalid SEO cursor.');}
   if(cursor.revision!==revision)throw new ApiError(409,'VERSION_CONFLICT','SEO catalog changed; restart the complete generation.');
   after=cursor.after;
  }
  const remaining=qualified.filter(({row})=>row.id>after),page=remaining.slice(0,query.limit);
  return {enabled:true,revision,validUntil,items:page.map(({row,locales})=>({id:row.id,locales,lastModified:row.last_modified.toISOString()})),
   nextCursor:remaining.length>query.limit?Buffer.from(JSON.stringify({v:1,revision,after:page.at(-1)!.row.id})).toString('base64url'):null};
 });
}
/** Explicit operator action only. A bounded identity set is replaced atomically; no public request triggers selection or provider I/O. */
export async function refreshSeoSelection(db: Database, now = new Date()) {
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await tx.query('SELECT pg_advisory_xact_lock(86147,40)');
  const selected:string[]=[];let after='';let scanned=0;
  while(selected.length<SEO_EXTERNAL_LIMIT) {
   const rows=(await tx.query<SeoRecord>(`${external} WHERE l.id>$2::uuid ORDER BY l.id LIMIT 500`,[now,after||'00000000-0000-0000-0000-000000000000'])).rows;
   if(!rows.length)break;
   for(const row of rows){scanned++;if(eligibleSeoLocales(row).length)selected.push(row.id.slice(4));if(selected.length===SEO_EXTERNAL_LIMIT)break;}
   after=rows.at(-1)!.id.slice(4);
  }
  const prior=(await tx.query<{listing_id:string}>('SELECT listing_id FROM seo_external_selection ORDER BY slot')).rows.map(row=>row.listing_id);
  if(JSON.stringify(prior)!==JSON.stringify(selected)) {
   await tx.query('DELETE FROM seo_external_selection');
   await tx.query('INSERT INTO seo_external_selection(listing_id,slot) SELECT id,ordinality::int FROM unnest($1::uuid[]) WITH ORDINALITY t(id,ordinality)',[selected]);
  }
  return {selected:selected.length,scanned,changed:JSON.stringify(prior)!==JSON.stringify(selected)};
 });
}
