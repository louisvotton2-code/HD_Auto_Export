import { AnalyticsVehicleIdSchema, type AnalyticsDays, type AnalyticsEvent, type AnalyticsOverview } from '@hd/contracts/analytics';
import type { PoolClient } from 'pg';
import type { Database } from '../db/index.js';
import {addAnalyticsActivity, beijingDay, markAnalyticsHeartbeat, pruneAnalyticsActivity, type AnalyticsContext, type IngestQuality} from './activity.js';

export interface AnalyticsStorage {
  ingest(events: readonly AnalyticsEvent[], allowExternal: boolean, context?: AnalyticsContext): Promise<IngestQuality>;
  overview(days: AnalyticsDays): Promise<AnalyticsOverview>;
  prune(heartbeat?:boolean): Promise<boolean>;
}

const receiptRetention = "INTERVAL '168 hours'";
const aggregateRetention = 90;
const maxTopVehicles = 20;
const pruneLimit = 10_000;
// Match the full whitespace trim used for published titles in vehicles/service.ts.
const trimCharacters = "U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'";

const ingestSql = `
  WITH batch AS (
    SELECT DISTINCT ON (event_id) event_id, event_type, page_type, locale, vehicle_id, supplier, batch_index, occurred_at
    FROM jsonb_to_recordset($1::jsonb) AS incoming(
      event_id uuid, event_type text, page_type text, locale text, vehicle_id uuid, supplier boolean, batch_index integer, occurred_at timestamptz
    )
    ORDER BY event_id, batch_index
  ), eligible AS (
    SELECT * FROM batch b
    WHERE b.vehicle_id IS NULL OR CASE WHEN b.supplier THEN $2::boolean AND EXISTS (
      SELECT 1 FROM external_listings l
      JOIN external_catalog c ON c.listing_id=l.id
      JOIN external_catalog_search s ON s.listing_id=l.id AND s.locale=b.locale
      LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
      WHERE l.id=b.vehicle_id AND l.upstream_state='active' AND l.formal_primary
        AND (o.data->'hidden') IS DISTINCT FROM 'true'::jsonb
    ) ELSE EXISTS (
      SELECT 1 FROM vehicles v
      JOIN vehicle_publications p ON p.id=v.published_revision_id
      WHERE v.id=b.vehicle_id AND v.deleted_at IS NULL AND v.publication_state='published'
        AND nullif(btrim(p.data->'content'->'title'->'translations'->b.locale->>'text', ${trimCharacters}), '') IS NOT NULL
    ) END
  ), received AS (
    INSERT INTO analytics_event_receipts AS r (event_id, received_at)
    SELECT event_id, statement_timestamp() FROM eligible ORDER BY event_id
    ON CONFLICT (event_id) DO UPDATE SET received_at=EXCLUDED.received_at
      WHERE r.received_at <= EXCLUDED.received_at - ${receiptRetention}
    RETURNING event_id
  ), occurrence AS (
    SELECT e.*, CASE WHEN $3::boolean AND e.occurred_at BETWEEN statement_timestamp()-interval '30 minutes' AND statement_timestamp()
      THEN e.occurred_at ELSE statement_timestamp() END AS counted_at FROM eligible e JOIN received r USING (event_id)
  ), counted AS (
    SELECT e.vehicle_id, e.supplier, e.batch_index,e.counted_at,(e.counted_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
      (e.event_type='page_view')::int AS page_views,
      (e.event_type='page_view' AND e.page_type='vehicle')::int AS detail_views,
      (e.event_type='vehicle_click')::int AS vehicle_clicks,
      (e.event_type='contact_click')::int AS contact_clicks
    FROM occurrence e
  ), site AS (
    INSERT INTO analytics_daily AS d (day, page_views, detail_views, vehicle_clicks, contact_clicks)
    SELECT day, sum(page_views), sum(detail_views), sum(vehicle_clicks), sum(contact_clicks)
    FROM counted GROUP BY day ORDER BY day
    ON CONFLICT (day) DO UPDATE SET
      page_views=d.page_views+EXCLUDED.page_views, detail_views=d.detail_views+EXCLUDED.detail_views,
      vehicle_clicks=d.vehicle_clicks+EXCLUDED.vehicle_clicks, contact_clicks=d.contact_clicks+EXCLUDED.contact_clicks
    RETURNING 1
  ), collection AS (
    INSERT INTO analytics_collection_state (id, started_at)
    SELECT 1, statement_timestamp() FROM site
    ON CONFLICT (id) DO NOTHING
  ), vehicles AS (
  INSERT INTO analytics_vehicle_daily AS d (day, vehicle_id, supplier, detail_views, vehicle_clicks, contact_clicks)
  SELECT day, vehicle_id, supplier, sum(detail_views), sum(vehicle_clicks), sum(contact_clicks)
  FROM counted WHERE vehicle_id IS NOT NULL
  GROUP BY day, vehicle_id, supplier
  HAVING sum(detail_views+vehicle_clicks+contact_clicks) > 0
  ORDER BY day, vehicle_id, supplier
  ON CONFLICT (day, vehicle_id, supplier) DO UPDATE SET
    detail_views=d.detail_views+EXCLUDED.detail_views, vehicle_clicks=d.vehicle_clicks+EXCLUDED.vehicle_clicks,
    contact_clicks=d.contact_clicks+EXCLUDED.contact_clicks
  )
  SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('index',batch_index,'at',counted_at) ORDER BY batch_index) FROM counted),'[]'::jsonb) AS accepted,
    (SELECT count(*)::int FROM eligible) AS eligible,(SELECT count(*)::int FROM batch) AS unique_count`;

const overviewSql = `
  WITH date_range AS (
    SELECT ${beijingDay} AS last_day, ${beijingDay} - ($1::int - 1) AS first_day
  ), dates AS (
    SELECT first_day + offset_day AS day
    FROM date_range, generate_series(0, $1::int - 1) AS days(offset_day)
  ), trend AS (
    SELECT to_char(dates.day, 'YYYY-MM-DD') AS date,
      coalesce(d.page_views, 0) AS "pageViews", coalesce(d.detail_views, 0) AS "detailViews",
      coalesce(d.vehicle_clicks, 0) AS "vehicleClicks", coalesce(d.contact_clicks, 0) AS "contactClicks"
    FROM dates LEFT JOIN analytics_daily d USING (day)
  ), top_vehicles AS (
    SELECT (CASE WHEN supplier THEN 'ext-' ELSE '' END) || vehicle_id::text AS "vehicleId",
      sum(detail_views) AS "detailViews", sum(vehicle_clicks) AS "vehicleClicks", sum(contact_clicks) AS "contactClicks",
      sum(detail_views + vehicle_clicks + contact_clicks) AS score
    FROM analytics_vehicle_daily, date_range
    WHERE day BETWEEN first_day AND last_day
    GROUP BY vehicle_id, supplier
    ORDER BY score DESC, "vehicleId"
    LIMIT ${maxTopVehicles}
  ), totals AS (
    SELECT sum("pageViews") AS "pageViews", sum("detailViews") AS "detailViews",
      sum("vehicleClicks") AS "vehicleClicks", sum("contactClicks") AS "contactClicks"
    FROM trend
  )
  SELECT jsonb_build_object(
    'days', $1::int,
    'timeZone', 'Asia/Shanghai',
    'collectionStartedAt', to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startDate', to_char(first_day, 'YYYY-MM-DD'),
    'endDate', to_char(last_day, 'YYYY-MM-DD'),
    'hasData', "pageViews"+"vehicleClicks"+"contactClicks" > 0,
    'totals', to_jsonb(totals),
    'trend', CASE WHEN "pageViews"+"vehicleClicks"+"contactClicks" > 0
      THEN (SELECT jsonb_agg(to_jsonb(t) ORDER BY date) FROM trend t) ELSE '[]'::jsonb END,
    'topVehicles', CASE WHEN "pageViews"+"vehicleClicks"+"contactClicks" > 0
      THEN coalesce((SELECT jsonb_agg(to_jsonb(v)-'score' ORDER BY score DESC, "vehicleId") FROM top_vehicles v), '[]'::jsonb)
      ELSE '[]'::jsonb END
  ) AS overview FROM totals CROSS JOIN date_range LEFT JOIN analytics_collection_state s ON s.id=1`;

// The indexed selection and tuple lookup touch at most one bounded batch per table.
const pruneSql = `
  WITH receipts AS (
    DELETE FROM analytics_event_receipts WHERE ctid = ANY(ARRAY(
      SELECT ctid FROM analytics_event_receipts
      WHERE received_at <= statement_timestamp() - ${receiptRetention}
      ORDER BY received_at, event_id LIMIT ${pruneLimit} FOR UPDATE SKIP LOCKED
    ))
  ), site AS (
    DELETE FROM analytics_daily WHERE ctid = ANY(ARRAY(
      SELECT ctid FROM analytics_daily WHERE day < ${beijingDay} - ${aggregateRetention - 1}
      ORDER BY day LIMIT ${aggregateRetention} FOR UPDATE SKIP LOCKED
    ))
  )
  DELETE FROM analytics_vehicle_daily WHERE ctid = ANY(ARRAY(
    SELECT ctid FROM analytics_vehicle_daily WHERE day < ${beijingDay} - ${aggregateRetention - 1}
    ORDER BY day, vehicle_id, supplier LIMIT ${pruneLimit} FOR UPDATE SKIP LOCKED
  ))`;

export function createAnalyticsStorage(db: Database): AnalyticsStorage {
  const run = <T>(work: (client: PoolClient) => Promise<T>) => db.transaction(async client => {
    await client.query("SET LOCAL statement_timeout = '1500ms'; SET LOCAL lock_timeout = '250ms'");
    return work(client);
  });
  return {
    async ingest(events, allowExternal, context) {
      const batch = events.flatMap((event, batchIndex) => {
        const {eventId,type,pageType,locale}=event;
        const vehicleId='vehicleId' in event?event.vehicleId:undefined;
        if(!context && ['filter_submit','search_zero_results','calculator_complete'].includes(type))return [];
        if (vehicleId !== undefined && !AnalyticsVehicleIdSchema.safeParse(vehicleId).success) return [];
        const supplier = vehicleId?.startsWith('ext-') ?? false;
        const uuid = supplier ? vehicleId?.slice(4) : vehicleId;
        return [{ event_id: eventId, event_type: type, page_type: pageType, locale, vehicle_id: uuid ?? null, supplier,
          batch_index: batchIndex,occurred_at:event.occurredAt }];
      });
      if (!batch.length) return {received:events.length,accepted:0,duplicates:0,dropped:events.length};
      return run(async client=>{
        const {rows:[decision]}=await client.query<{accepted:{index:number;at:string}[];eligible:number;unique_count:number}>(ingestSql,
          [JSON.stringify(batch),allowExternal,Boolean(context)]);
        const accepted=decision!.accepted.map(({index,at})=>({...events[index]!,occurredAt:at}));
        const duplicates=batch.length-decision!.unique_count+decision!.eligible-accepted.length;
        const quality={received:events.length,accepted:accepted.length,duplicates,dropped:events.length-accepted.length-duplicates};
        if(context)await addAnalyticsActivity(client,accepted,context,quality);
        return quality;
      });
    },
    async overview(days) {
      return run(async client => {
        const result = await client.query<{ overview: AnalyticsOverview }>(overviewSql, [days]);
        return result.rows[0]!.overview;
      });
    },
    async prune(heartbeat=false) {
      return run(async client=>{
        await client.query(pruneSql);
        const backlog=await pruneAnalyticsActivity(client);
        if(heartbeat)await markAnalyticsHeartbeat(client);
        return backlog;
      });
    },
  };
}
