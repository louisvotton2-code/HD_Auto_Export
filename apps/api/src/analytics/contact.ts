import type {FastifyRequest} from 'fastify';
import type {AnalyticsContactCountRequest} from '@hd/contracts/analytics';
import type {Config} from '../config.js';
import type {Database} from '../db/index.js';

/** Same public eligibility as analytics receipts, but no event identity or request metadata. */
const trim = "U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'";
const countSql = `
 WITH counted AS (
   INSERT INTO analytics_contact_hourly AS a(hour,vehicle_id,supplier,channel,clicks)
   SELECT date_trunc('hour',statement_timestamp(),'UTC'),$1,$2,$3,1
   WHERE CASE WHEN $2::boolean THEN $4::boolean AND EXISTS (
     SELECT 1 FROM external_listings l JOIN external_catalog c ON c.listing_id=l.id
     JOIN external_catalog_search s ON s.listing_id=l.id
     LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
     WHERE l.id=$1 AND l.upstream_state='active' AND l.formal_primary
       AND (o.data->'hidden') IS DISTINCT FROM 'true'::jsonb
       AND s.locale IN ('zh','en','ru')
   ) ELSE EXISTS (
     SELECT 1 FROM vehicles v JOIN vehicle_publications p ON p.id=v.published_revision_id
     WHERE v.id=$1 AND v.deleted_at IS NULL AND v.publication_state='published'
       AND EXISTS (SELECT 1 FROM unnest(ARRAY['zh','en','ru']) AS locales(locale)
         WHERE nullif(btrim(p.data->'content'->'title'->'translations'->locales.locale->>'text',${trim}),'') IS NOT NULL)
   ) END
   ON CONFLICT(hour,vehicle_id,supplier,channel) DO UPDATE SET clicks=a.clicks+1
   RETURNING 1
 ), first_count AS (
   INSERT INTO analytics_contact_collection(id,started_at)
   SELECT 1,statement_timestamp() FROM counted ON CONFLICT DO NOTHING
 )
 SELECT EXISTS(SELECT 1 FROM counted) AS counted`;

export function canCountContact(request:FastifyRequest,config:Config,trustedCountry:string|undefined) {
  if(config.analyticsContactLocalEnabled) {
    const peer=request.raw.socket.remoteAddress;
    const origin=new URL(request.headers.origin!);
    if((peer==='127.0.0.1'||peer==='::ffff:127.0.0.1'||peer==='::1') &&
       ['127.0.0.1','localhost','[::1]'].includes(origin.hostname))return true;
  }
  return trustedCountry!==undefined&&config.analyticsContactCountries.includes(trustedCountry);
}

export function countContact(db:Database,input:AnalyticsContactCountRequest,allowExternal:boolean) {
  const supplier=input.vehicleId.startsWith('ext-');
  const id=supplier?input.vehicleId.slice(4):input.vehicleId;
  return db.transaction(async tx=>{
    await tx.query("SET LOCAL statement_timeout='400ms'; SET LOCAL lock_timeout='100ms'");
    const {rows:[result]}=await tx.query<{counted:boolean}>(countSql,[id,supplier,input.channel,allowExternal]);
    return result?.counted===true;
  });
}
