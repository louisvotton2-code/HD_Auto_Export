import {
  AnalyticsReportSchema, type AnalyticsReport, type AnalyticsReportQuery, type AnalyticsRuntimeQualitySchema,
} from '@hd/contracts/analytics';
import type { z } from 'zod';
import type { Database } from '../db/index.js';

const timeZone = "'Asia/Shanghai'";
const heartbeatWidth = "interval '5 minutes'";
const heartbeatOrigin = "timestamptz '2000-01-01 00:00:00+00'";
const timestamp = (value: string) => `to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const unfiltered = '$6::text IS NULL AND $11::text IS NULL AND $12::text IS NULL AND $13::text IS NULL AND $14::text IS NULL';
const selected = (alias: string) => [
  ['source',6],['locale',11],['country',12],['device',13],['entry',14],
].map(([column,param]) => `($${param}::text IS NULL OR ${alias}.${column}=$${param})`).join(' AND ');
const metrics = {
  pageViews: "event_type='page_view'",
  detailViews: "event_type='page_view' AND page_type='vehicle'",
  vehicleClicks: "event_type='vehicle_click'",
  contactClicks: "event_type='contact_click'",
  filterSubmits: "event_type='filter_submit'",
  searchZeroResults: "event_type='search_zero_results'",
  calculatorCompletions: "event_type='calculator_complete'",
} as const;
const measured = Object.entries(metrics).map(([name, predicate]) =>
  `coalesce(sum(total) FILTER (WHERE ${predicate}),0) AS "${name}"`).join(',');
const zeroMetrics = Object.keys(metrics).map(name => `0 AS "${name}"`).join(',');
const sumMetrics = Object.keys(metrics).map(name => `sum("${name}") AS "${name}"`).join(',');
const responseMetrics = (alias: string) => Object.keys(metrics).map(name => `'${name}',coalesce(${alias}."${name}",0)`).join(',');
const legacyMetrics = (condition: string) => `
  CASE WHEN ${condition} THEN coalesce(l.page_views,0) ELSE coalesce(a."pageViews",0) END AS "pageViews",
  CASE WHEN ${condition} THEN coalesce(l.detail_views,0) ELSE coalesce(a."detailViews",0) END AS "detailViews",
  CASE WHEN ${condition} THEN coalesce(l.vehicle_clicks,0) ELSE coalesce(a."vehicleClicks",0) END AS "vehicleClicks",
  CASE WHEN ${condition} THEN coalesce(l.contact_clicks,0) ELSE coalesce(a."contactClicks",0) END AS "contactClicks",
  coalesce(a."filterSubmits",0) AS "filterSubmits",
  coalesce(a."searchZeroResults",0) AS "searchZeroResults",
  coalesce(a."calculatorCompletions",0) AS "calculatorCompletions"`;

const marketKeys = {
  countries:'country', languages:'locale', devices:'device', entries:'entry',
  sources:'source', campaigns:'campaign', channels:'channel',
} as const;
const marketRecord = Object.entries(marketKeys).map(([group, key]) =>
  `'${group}',coalesce((SELECT items FROM market_payload WHERE kind='${key}'),'[]'::jsonb)`).join(',');
const localizedTitle = (titleByLocale: string, path: string) =>
  `coalesce(${["coalesce($11::text,'zh')","'zh'","'en'","'ru'"].map(locale =>
    `nullif(btrim(${titleByLocale}->${locale}${path}),'')`).join(',')})`;

// Each snapshot covers the same time bounds for event totals and session cohorts.
// Hour rows are aligned at the hour and day rows are aligned at Shanghai midnight.
const reportSql = `
  WITH clock AS (
    SELECT coalesce($7::timestamptz, statement_timestamp()) AS at
  ), calendar AS (
    SELECT at, date_trunc('day',at,${timeZone}) AS today,
      date_trunc('minute',at,'UTC') AS completed_minutes,
      CASE WHEN $2::text='hour' THEN interval '1 hour' ELSE interval '24 hours' END AS stride
    FROM clock
  ), requested_window AS (
    SELECT *,
      CASE WHEN $9::date IS NOT NULL THEN $9::date::timestamp AT TIME ZONE ${timeZone}
        WHEN $8::text='yesterday' THEN today-interval '24 hours'
        ELSE today-make_interval(hours=>24*($1::int-1)) END AS first,
      CASE WHEN $10::date IS NOT NULL THEN least(at,($10::date+1)::timestamp AT TIME ZONE ${timeZone})
        WHEN $8::text='yesterday' THEN today ELSE at END AS until
    FROM calendar
  ), bounded_window AS (
    SELECT at,today,completed_minutes,stride,first,greatest(first,until) AS until FROM requested_window
  ), bounds AS (
    SELECT *, (first AT TIME ZONE ${timeZone})::date AS first_day,
      ((CASE WHEN until=at THEN at ELSE until-interval '1 microsecond' END) AT TIME ZONE ${timeZone})::date AS last_day
    FROM bounded_window
  ), state AS (
    SELECT (SELECT started_at FROM analytics_v2_collection WHERE id=1) AS started_at,
      (SELECT started_at FROM analytics_collection_state WHERE id=1) AS legacy_started_at
  ), buckets AS (
    SELECT bucket AS start, least(bucket+stride,until) AS finish
    FROM bounds, generate_series(first,CASE WHEN until=at THEN at ELSE until-interval '1 microsecond' END,stride) AS series(bucket)
  ), ranges AS (
    SELECT 'report' AS kind,first AS start,until AS finish FROM bounds
    UNION ALL SELECT 'today',today,completed_minutes FROM bounds
    UNION ALL SELECT 'yesterday',today-interval '24 hours',completed_minutes-interval '24 hours' FROM bounds
    UNION ALL SELECT 'trend',start,finish FROM buckets
  ), covered AS (
    SELECT r.*, CASE
      WHEN r.finish<=b.today-89*interval '24 hours' OR state.started_at IS NULL THEN 'not_collected'
      WHEN r.finish<=state.started_at THEN CASE WHEN
        (r.kind IN ('today','yesterday') AND EXISTS(SELECT 1 FROM analytics_activity_minutes a WHERE a.minute>=r.start AND a.minute<r.finish))
        OR (r.kind NOT IN ('today','yesterday') AND EXISTS(SELECT 1 FROM analytics_activity_hourly a WHERE a.hour>=r.start AND a.hour<r.finish))
        THEN 'partial' ELSE 'not_collected' END
      WHEN r.finish<=r.start THEN 'partial'
      WHEN observed.slots=0 AND r.finish-r.start>=${heartbeatWidth} THEN 'gap'
      WHEN r.start<state.started_at OR observed.slots<expected.slots OR expected.slots=0 THEN 'partial'
      ELSE 'complete' END AS coverage
    FROM ranges r CROSS JOIN state CROSS JOIN bounds b
    CROSS JOIN LATERAL (
      SELECT extract(epoch FROM (date_bin(${heartbeatWidth},r.finish,${heartbeatOrigin})-r.start))/300 AS slots
    ) expected
    CROSS JOIN LATERAL (
      SELECT count(*) AS slots FROM analytics_v2_heartbeats
      WHERE slot>=r.start AND slot<date_bin(${heartbeatWidth},r.finish,${heartbeatOrigin})
    ) observed
  ), legacy AS MATERIALIZED (
    SELECT day,page_views,detail_views,vehicle_clicks,contact_clicks
    FROM analytics_daily d,bounds b
    WHERE ${unfiltered} AND d.day BETWEEN b.first_day AND b.last_day
  ), activity AS MATERIALIZED (
    SELECT a.* FROM analytics_activity_hourly a,bounds b
    WHERE a.hour>=b.first AND a.hour<b.until AND ${selected('a')}
  ), activity_totals AS (
    SELECT ${measured} FROM activity
  ), totals AS (
    SELECT ${legacyMetrics(unfiltered)} FROM activity_totals a
    CROSS JOIN (SELECT sum(page_views) AS page_views,sum(detail_views) AS detail_views,
      sum(vehicle_clicks) AS vehicle_clicks,sum(contact_clicks) AS contact_clicks FROM legacy) l
  ), activity_buckets AS (
    SELECT date_trunc($2::text,hour,${timeZone}) AS start,${measured}
    FROM activity GROUP BY 1
  ), trend AS (
    SELECT c.start,c.coverage,${legacyMetrics(`${unfiltered} AND $2::text='day'`)}
    FROM covered c LEFT JOIN activity_buckets a USING (start)
    LEFT JOIN legacy l ON $2::text='day' AND l.day=(c.start AT TIME ZONE ${timeZone})::date
    WHERE c.kind='trend'
  ), minute_activity AS (
    SELECT r.kind,${measured}
    FROM covered r LEFT JOIN analytics_activity_minutes a
      ON a.minute>=r.start AND a.minute<r.finish AND ${selected('a')}
    WHERE r.kind IN ('today','yesterday') GROUP BY r.kind
  ), cohort AS MATERIALIZED (
    SELECT s.id,s.country,s.locale,s.device,s.entry,s.source,s.catalog_stage,s.direct_stage,s.last_at
    FROM analytics_sessions s,bounds b
    WHERE s.started_at>=b.first AND s.started_at<b.until AND ${selected('s')}
  ), funnels AS (
    SELECT count(*) AS sessions,
      count(*) FILTER (WHERE last_at>b.at-interval '30 minutes') AS active_sessions,
      jsonb_build_object('catalog',count(*) FILTER (WHERE catalog_stage>=1),
        'vehicleClick',count(*) FILTER (WHERE catalog_stage>=2), 'detail',count(*) FILTER (WHERE catalog_stage>=3),
        'contact',count(*) FILTER (WHERE catalog_stage>=4)) AS catalog,
      jsonb_build_object('detail',count(*) FILTER (WHERE direct_stage>=1), 'contact',count(*) FILTER (WHERE direct_stage>=2)) AS direct
    FROM cohort CROSS JOIN bounds b
  ), market_rows AS (
    SELECT d.kind,d.key,0 AS sessions,${measured}
    FROM activity a CROSS JOIN LATERAL (VALUES ('country',a.country),('locale',a.locale),('device',a.device),
      ('entry',a.entry),('source',a.source),('campaign',a.campaign),('channel',a.channel)) d(kind,key)
    WHERE d.kind<>'channel' OR (a.event_type='contact_click' AND d.key<>'')
    GROUP BY d.kind,d.key
    UNION ALL
    SELECT d.kind,d.key,count(*) AS sessions,${zeroMetrics}
    FROM cohort s CROSS JOIN LATERAL (VALUES ('country',s.country),('locale',s.locale),('device',s.device),
      ('entry',s.entry),('source',s.source)) d(kind,key)
    GROUP BY d.kind,d.key
  ), market_groups AS (
    SELECT kind,key,sum(sessions) AS sessions,${sumMetrics} FROM market_rows GROUP BY kind,key
  ), market_payload AS (
    SELECT g.kind,jsonb_agg(jsonb_build_object(g.kind,g.key) || CASE
      WHEN g.kind='channel' THEN jsonb_build_object('contactClicks',g."contactClicks")
      WHEN g.kind='campaign' THEN jsonb_build_object(${responseMetrics('g')})
      ELSE jsonb_build_object('sessions',g.sessions,${responseMetrics('g')}) END ORDER BY key COLLATE "C") AS items
    FROM market_groups g GROUP BY g.kind
  ), legacy_vehicles AS (
    SELECT v.vehicle_id,v.supplier,sum(v.detail_views) AS detail_views,sum(v.vehicle_clicks) AS vehicle_clicks,
      sum(v.contact_clicks) AS contact_clicks
    FROM analytics_vehicle_daily v,bounds b
    WHERE ${unfiltered} AND v.day BETWEEN b.first_day AND b.last_day
    GROUP BY v.vehicle_id,v.supplier
  ), v2_vehicles AS (
    SELECT v.vehicle_id,v.supplier,sum(v.detail_views) AS detail_views,sum(v.vehicle_clicks) AS vehicle_clicks,
      sum(v.contact_clicks) AS contact_clicks,sum(v.whatsapp_clicks) AS whatsapp_clicks,sum(v.telegram_clicks) AS telegram_clicks
    FROM analytics_vehicle_activity_hourly v,bounds b
    WHERE v.hour>=b.first AND v.hour<b.until AND ${selected('v')}
    GROUP BY v.vehicle_id,v.supplier
  ), vehicle_counts AS (
    SELECT vehicle_id,supplier,
      CASE WHEN ${unfiltered} THEN coalesce(l.detail_views,0) ELSE coalesce(v.detail_views,0) END AS detail_views,
      CASE WHEN ${unfiltered} THEN coalesce(l.vehicle_clicks,0) ELSE coalesce(v.vehicle_clicks,0) END AS vehicle_clicks,
      CASE WHEN ${unfiltered} THEN coalesce(l.contact_clicks,0) ELSE coalesce(v.contact_clicks,0) END AS contact_clicks,
      coalesce(v.whatsapp_clicks,0) AS whatsapp_clicks,coalesce(v.telegram_clicks,0) AS telegram_clicks
    FROM legacy_vehicles l FULL JOIN v2_vehicles v USING(vehicle_id,supplier)
  ), vehicle_sessions AS (
    SELECT v.vehicle_id,v.supplier,count(*) AS detail_sessions,count(*) FILTER (WHERE v.contact_after_detail) AS contact_sessions
    FROM cohort s JOIN analytics_session_vehicles v ON v.session_id=s.id WHERE v.detail
    GROUP BY v.vehicle_id,v.supplier
  ), vehicle_rows AS MATERIALIZED (
    SELECT vehicle_id,supplier,(CASE WHEN supplier THEN 'ext-' ELSE '' END)||vehicle_id::text AS "vehicleId",
      coalesce(v.detail_views,0) AS "detailViews",coalesce(v.vehicle_clicks,0) AS "vehicleClicks",
      coalesce(v.contact_clicks,0) AS "contactClicks", coalesce(s.detail_sessions,0) AS "detailSessions",
      coalesce(s.contact_sessions,0) AS "contactAfterDetailSessions",
      coalesce(v.whatsapp_clicks,0) AS "whatsappClicks",coalesce(v.telegram_clicks,0) AS "telegramClicks",
      s.contact_sessions::double precision/nullif(s.detail_sessions,0) AS "contactRate"
    FROM vehicle_counts v FULL JOIN vehicle_sessions s USING (vehicle_id,supplier)
  ), ranked AS (
    SELECT v.*,CASE $3::text
      WHEN 'contactRate' THEN "contactRate" WHEN 'vehicleClicks' THEN "vehicleClicks"
      WHEN 'contactClicks' THEN "contactClicks" ELSE "detailViews" END AS score
    FROM vehicle_rows v ORDER BY score DESC NULLS LAST,"vehicleId" COLLATE "C"
    LIMIT $5::int OFFSET ($4::int-1)*$5::int
  ), ranked_payload AS (
    SELECT r.score,r."vehicleId",
      to_jsonb(r)-'score'-'vehicle_id'-'supplier'||jsonb_build_object(
        'source',CASE WHEN r.supplier THEN 'supplier' ELSE 'staff' END,
        'stockCode',CASE WHEN r.supplier THEN 'HX'||l.inquiry_number::text
          ELSE 'HD-'||lpad(v.stock_number::text,greatest(6,length(v.stock_number::text)),'0') END,
        'title',CASE WHEN r.supplier THEN ${localizedTitle('c.localized',"->'title'->>'text'")}
          ELSE ${localizedTitle("(p.data->'content'->'title'->'translations')","->>'text'")} END
      ) AS item
    FROM ranked r
    LEFT JOIN vehicles v ON NOT r.supplier AND v.id=r.vehicle_id
    LEFT JOIN vehicle_publications p ON v.publication_state='published' AND v.deleted_at IS NULL AND p.id=v.published_revision_id
    LEFT JOIN external_listings l ON r.supplier AND l.id=r.vehicle_id
    LEFT JOIN external_catalog c ON c.listing_id=l.id AND l.upstream_state='active' AND l.formal_primary
  ), daily_ips AS (
    SELECT local_day AS day,CASE WHEN ${unfiltered} THEN i.unique_ips ELSE NULL END AS estimate
    FROM bounds b CROSS JOIN generate_series(0,b.last_day-b.first_day) AS offsets(n)
    CROSS JOIN LATERAL (SELECT b.first_day+n AS local_day) date_range
    LEFT JOIN analytics_daily_ips i ON i.day=local_day
  ), quality AS (
    SELECT coalesce(sum(received),0) AS received,coalesce(sum(accepted),0) AS accepted,
      coalesce(sum(duplicates),0) AS duplicates,coalesce(sum(dropped),0) AS dropped
    FROM analytics_ingest_quality q,bounds b WHERE q.hour>=b.first AND q.hour<b.until
  )
  SELECT jsonb_build_object(
    'timeZone',${timeZone},
    'range',jsonb_build_object('start',${timestamp('b.first')},'end',${timestamp('b.until')}),
    'granularity',$2::text,
    'collectionStartedAt',${timestamp('s.started_at')},'legacyCollectionStartedAt',${timestamp('s.legacy_started_at')},
    'coverage',(SELECT coverage FROM covered WHERE kind='report'),'totals',to_jsonb(t),
    'sessions',f.sessions,'activeSessions',f.active_sessions,
    'trend',coalesce((SELECT jsonb_agg(to_jsonb(tr)-'start'||jsonb_build_object('start',${timestamp('tr.start')}) ORDER BY tr.start)
      FROM trend tr),'[]'::jsonb),
    'comparison',(
      SELECT jsonb_build_object(
        'today',jsonb_build_object('start',${timestamp('today.start')},'end',${timestamp('today.finish')}),
        'yesterday',jsonb_build_object('start',${timestamp('yesterday.start')},'end',${timestamp('yesterday.finish')}),
        'todayCoverage',today.coverage,'yesterdayCoverage',yesterday.coverage,
        'current',to_jsonb(cur)-'kind','previous',to_jsonb(prev)-'kind')
      FROM covered today JOIN minute_activity cur ON cur.kind=today.kind
      CROSS JOIN covered yesterday JOIN minute_activity prev ON prev.kind=yesterday.kind
      WHERE today.kind='today' AND yesterday.kind='yesterday'
    ),
    'markets',jsonb_build_object(${marketRecord}),
    'dailyUniqueIpEstimates',coalesce((SELECT jsonb_agg(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),'estimate',estimate) ORDER BY day)
      FROM daily_ips),'[]'::jsonb),
    'ranking',jsonb_build_object('metric',$3::text,'page',$4::int,'pageSize',$5::int,
      'total',(SELECT count(*) FROM vehicle_rows),
      'items',coalesce((SELECT jsonb_agg(item ORDER BY score DESC NULLS LAST,"vehicleId" COLLATE "C") FROM ranked_payload),'[]'::jsonb)),
    'funnels',jsonb_build_object('catalog',f.catalog,'direct',f.direct),'quality',to_jsonb(q)
  ) AS report
  FROM bounds b CROSS JOIN state s CROSS JOIN totals t CROSS JOIN funnels f CROSS JOIN quality q`;

export async function getAnalyticsReport(db: Database, query: AnalyticsReportQuery,
  runtimeQuality: z.infer<typeof AnalyticsRuntimeQualitySchema>, now?: Date): Promise<AnalyticsReport> {
  return db.transaction(async client => {
    await client.query("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='2500ms'; SET LOCAL lock_timeout='250ms'");
    const { days, granularity, metric, page, pageSize, source, period, startDate, endDate, locale, country, device, entry } = query;
    const result = await client.query<{ report: Omit<AnalyticsReport,'runtimeQuality'> }>(reportSql,
      [days??(period?1:30),granularity,metric,page,pageSize,source??null,now??null,period??null,startDate??null,
        endDate??null,locale??null,country??null,device??null,entry??null]);
    return AnalyticsReportSchema.parse({...result.rows[0]?.report,runtimeQuality});
  });
}
