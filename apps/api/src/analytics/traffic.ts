import { AnalyticsTrafficSchema, type AnalyticsIpVisitQuality, type AnalyticsTraffic, type AnalyticsTrafficContactQuality,
  type AnalyticsTrafficQuery } from '@hd/contracts/analytics';
import type { Database } from '../db/index.js';

const timeZone = "'Asia/Shanghai'";
const timestamp = (field:string) => `to_char(${field} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const trafficCounts = (alias:string) => `jsonb_build_object(
  'documentRequests',${alias}.documents, 'whatsappClicks',${alias}.whatsapp,
  'telegramClicks',${alias}.telegram, 'totalContactClicks',${alias}.whatsapp+${alias}.telegram)`;
const title = (localized:string, accessor:string) => `coalesce(${["coalesce($9::text,'zh')","'zh'","'en'","'ru'"].map(locale =>
  `nullif(btrim(${localized}->${locale}${accessor}),'')`).join(',')})`;

// Only aggregate tables enter the report. Count zero is present only for fully
// sealed ranges; a positive count with partial coverage is an observed minimum.
const visitRangesSql = `, visit_state AS (
    SELECT least(t.first_hour,s.first_hour) AS first_hour,greatest(t.latest_hour,s.latest_hour) AS latest_hour
    FROM bounds b
    CROSS JOIN LATERAL (
      SELECT min(hour) AS first_hour,max(hour) AS latest_hour FROM analytics_ip_visit_hourly
      WHERE hour>=b.retained_since AND hour<=b.now
    ) t
    CROSS JOIN LATERAL (
      SELECT min(hour) AS first_hour,max(hour) AS latest_hour FROM analytics_ip_visit_coverage
      WHERE hour>=b.retained_since AND hour<b.now
    ) s
  ), visit_ranges AS (
    SELECT r.kind,r.start,observed.visits,closed.expected,seals.imported,vs.latest_hour,
      CASE WHEN vs.first_hour IS NULL OR r.finish<=b.retained_since OR r.finish<=vs.first_hour THEN 'not_collected'
        WHEN closed.expected=0 THEN 'partial'
        WHEN seals.imported=0 AND observed.visits IS NULL THEN 'gap'
        WHEN seals.completed=closed.expected AND r.finish=closed.at THEN 'complete'
        ELSE 'partial' END AS coverage
    FROM ranges r CROSS JOIN bounds b CROSS JOIN visit_state vs
    CROSS JOIN LATERAL (
      SELECT date_trunc('hour',r.finish,${timeZone}) AS at,
        greatest(0,extract(epoch FROM (date_trunc('hour',r.finish,${timeZone})-r.start))/3600)::integer AS expected
    ) closed
    CROSS JOIN LATERAL (
      SELECT count(*) AS imported,count(*) FILTER (WHERE status='complete') AS completed
      FROM analytics_ip_visit_coverage WHERE hour>=greatest(r.start,b.retained_since) AND hour<closed.at
    ) seals
    CROSS JOIN LATERAL (
      SELECT sum(visits) AS visits FROM analytics_ip_visit_hourly
      WHERE hour>=greatest(r.start,b.retained_since) AND hour<r.finish
    ) observed
  )`;
const visitValue = (alias:string) => `jsonb_build_object('uniqueIpVisits',CASE
  WHEN ${alias}.visits>0 OR ${alias}.visit_coverage='complete' THEN coalesce(${alias}.visits,0) END)`;

// Contact aggregates intentionally have no language or page type. Filters apply
// only to gateway documents and to the display language of ranking titles.
const trafficSql = (includeVisits:boolean) => `
  WITH clock AS (
    SELECT coalesce($6::timestamptz,statement_timestamp()) AS now
  ), calendar AS (
    SELECT now,date_trunc('day',now,${timeZone}) AS today FROM clock
  ), requested_days AS (
    SELECT now,today,
      CASE WHEN $7::date IS NOT NULL THEN $7::date::timestamp AT TIME ZONE ${timeZone}
        WHEN $2::text='yesterday' THEN today-interval '24 hours'
        ELSE today-make_interval(hours=>24*($1::int-1)) END AS first,
      CASE WHEN $8::date IS NOT NULL THEN ($8::date+1)::timestamp AT TIME ZONE ${timeZone}
        WHEN $2::text='yesterday' THEN today ELSE today+interval '24 hours' END AS calendar_end,
      CASE WHEN $3::text='hour' THEN interval '1 hour' ELSE interval '24 hours' END AS step
    FROM calendar
  ), bounds AS (
    SELECT *,greatest(first,least(now,calendar_end)) AS until,today-89*interval '24 hours' AS retained_since,
      greatest(first,date_trunc('hour',least(now,calendar_end),${timeZone})) AS comparable_end,
      first-(calendar_end-first) AS previous_start
    FROM requested_days
  ), ranges AS (
    SELECT 'report' AS kind,first AS start,until AS finish FROM bounds
    UNION ALL SELECT 'current',first,comparable_end FROM bounds
    UNION ALL SELECT 'previous',previous_start,previous_start+(comparable_end-first) FROM bounds
    UNION ALL SELECT 'trend',bucket,least(bucket+step,until)
      FROM bounds CROSS JOIN LATERAL generate_series(first,until-interval '1 microsecond',step) AS series(bucket)
  )${includeVisits?visitRangesSql:''}, latest_document AS (
    SELECT min(s.hour) AS first_hour,max(s.hour) AS latest_hour FROM analytics_document_snapshots s,bounds b
    WHERE s.hour>=b.retained_since AND s.hour<=b.now
  ), contact_state AS (
    SELECT (SELECT started_at FROM analytics_contact_collection WHERE id=1) AS started_at,
      ($12::jsonb->>'since')::timestamptz AS runtime_since, ($12::jsonb->>'configured')::boolean AS configured,
      ($12::jsonb->>'unavailable')::bigint+($12::jsonb->>'rateLimited')::bigint AS known_losses
  ), documents AS MATERIALIZED (
    SELECT d.hour,d.locale,d.page_type,d.requests
    FROM analytics_document_hourly d JOIN analytics_document_snapshots s USING(hour) CROSS JOIN bounds b
    WHERE d.hour>=greatest(b.retained_since,b.previous_start) AND d.hour<b.until
      AND ($9::text IS NULL OR d.locale=$9) AND ($10::text IS NULL OR d.page_type=$10)
  ), document_hours AS (
    SELECT hour,sum(requests) AS requests FROM documents GROUP BY hour
  ), contacts AS MATERIALIZED (
    SELECT h.hour,h.vehicle_id,h.supplier,h.channel,h.clicks FROM analytics_contact_hourly h,bounds b
    WHERE h.hour>=greatest(b.retained_since,b.previous_start) AND h.hour<b.until
  ), contact_hours AS (
    SELECT hour,sum(clicks) FILTER (WHERE channel='whatsapp') AS whatsapp,
      sum(clicks) FILTER (WHERE channel='telegram') AS telegram FROM contacts GROUP BY hour
  ), trend_counts AS (
    SELECT date_trunc($3::text,hour,${timeZone}) AS start,sum(d.requests) AS documents,
      sum(c.whatsapp) AS whatsapp,sum(c.telegram) AS telegram
    FROM document_hours d FULL JOIN contact_hours c USING(hour) CROSS JOIN bounds b
    WHERE hour>=b.first GROUP BY 1
  ), observed_ranges AS (
    SELECT r.*,counts.expected,counts.imported,CASE
        WHEN latest.first_hour IS NULL OR r.finish<=b.retained_since OR r.finish<=latest.first_hour THEN 'not_collected'
        WHEN counts.expected=0 THEN 'partial'
        WHEN counts.observations=0 THEN 'gap'
        WHEN counts.completed=counts.expected AND r.finish=closed.at THEN 'complete'
        ELSE 'partial' END AS coverage,
      CASE WHEN cs.started_at IS NULL OR r.finish<=b.retained_since OR r.finish<=date_trunc('hour',cs.started_at,'UTC') THEN 'not_collected'
        WHEN r.finish=r.start THEN 'partial'
        WHEN r.start>=cs.runtime_since AND NOT cs.configured THEN 'gap'
        WHEN r.start>=greatest(cs.runtime_since,cs.started_at,b.retained_since) AND cs.configured AND cs.known_losses=0 THEN 'complete'
        ELSE 'partial' END AS contact_coverage,
      coalesce(t.documents,doc.requests,0) AS documents,coalesce(t.whatsapp,co.whatsapp,0) AS whatsapp,
      coalesce(t.telegram,co.telegram,0) AS telegram${includeVisits?`,vr.visits,vr.coverage AS visit_coverage,
        vr.expected AS visit_expected,vr.imported AS visit_imported,vr.latest_hour AS visit_latest`:''}
    FROM ranges r CROSS JOIN bounds b CROSS JOIN latest_document latest CROSS JOIN contact_state cs
    CROSS JOIN LATERAL (SELECT date_trunc('hour',r.finish,${timeZone}) AS at) closed
    CROSS JOIN LATERAL (
      SELECT greatest(0,extract(epoch FROM (closed.at-r.start))/3600)::integer AS expected,
        count(*) FILTER (WHERE hour<closed.at) AS imported,
        count(*) FILTER (WHERE hour<closed.at AND status='complete') AS completed,count(*) AS observations
      FROM analytics_document_snapshots
      WHERE hour>=greatest(r.start,b.retained_since) AND hour<r.finish
    ) counts
    LEFT JOIN trend_counts t ON r.kind='trend' AND t.start=r.start
    ${includeVisits?'JOIN visit_ranges vr ON vr.kind=r.kind AND vr.start=r.start':''}
    CROSS JOIN LATERAL (SELECT sum(h.requests) AS requests FROM document_hours h
      WHERE r.kind<>'trend' AND h.hour>=r.start AND h.hour<r.finish) doc
    CROSS JOIN LATERAL (SELECT sum(h.whatsapp) AS whatsapp,sum(h.telegram) AS telegram FROM contact_hours h
      WHERE r.kind<>'trend' AND h.hour>=r.start AND h.hour<r.finish) co
  ), document_parts AS (
    SELECT locale,page_type,sum(requests) AS requests FROM documents d,bounds b WHERE d.hour>=b.first GROUP BY locale,page_type
  ), contact_vehicles AS MATERIALIZED (
    SELECT vehicle_id,supplier,(CASE WHEN supplier THEN 'ext-' ELSE '' END)||vehicle_id::text AS "vehicleId",
      coalesce(sum(clicks) FILTER (WHERE channel='whatsapp'),0) AS "whatsappClicks",
      coalesce(sum(clicks) FILTER (WHERE channel='telegram'),0) AS "telegramClicks",sum(clicks) AS "totalContactClicks"
    FROM contacts h,bounds b WHERE h.hour>=b.first GROUP BY vehicle_id,supplier
  ), ranked AS (
    SELECT v.*,CASE $11::text WHEN 'whatsapp' THEN "whatsappClicks" WHEN 'telegram' THEN "telegramClicks"
      ELSE "totalContactClicks" END AS score
    FROM contact_vehicles v ORDER BY score DESC,"vehicleId" COLLATE "C"
    LIMIT $5::int OFFSET ($4::int-1)*$5::int
  ), ranked_payload AS (
    SELECT r.score,r."vehicleId",to_jsonb(r)-'score'-'vehicle_id'-'supplier'||jsonb_build_object(
      'source',CASE WHEN r.supplier THEN 'supplier' ELSE 'staff' END,
      'stockCode',CASE WHEN r.supplier THEN 'HX'||l.inquiry_number::text
        ELSE 'HD-'||lpad(v.stock_number::text,greatest(6,length(v.stock_number::text)),'0') END,
      'title',CASE WHEN r.supplier THEN ${title('c.localized',"->'title'->>'text'")}
        ELSE ${title("(p.data->'content'->'title'->'translations')","->>'text'")} END
    ) AS item
    FROM ranked r
    LEFT JOIN vehicles v ON NOT r.supplier AND v.id=r.vehicle_id
    LEFT JOIN vehicle_publications p ON v.publication_state='published' AND v.deleted_at IS NULL AND p.id=v.published_revision_id
    LEFT JOIN external_listings l ON r.supplier AND l.id=r.vehicle_id
    LEFT JOIN external_listing_overrides o ON o.listing_id=l.id
    LEFT JOIN external_catalog c ON c.listing_id=l.id AND l.upstream_state='active' AND l.formal_primary
       AND (o.data->'hidden') IS DISTINCT FROM 'true'::jsonb
  )
  SELECT jsonb_build_object(
    'timeZone',${timeZone},'range',jsonb_build_object('start',${timestamp('b.first')},'end',${timestamp('b.until')}),
    'granularity',$3::text,'totals',${trafficCounts('r')}${includeVisits?`||${visitValue('r')}`:''},
    'trend',coalesce((SELECT jsonb_agg(${trafficCounts('t')}||jsonb_build_object('start',${timestamp('t.start')},
      'documentCoverage',t.coverage,'contactCoverage',t.contact_coverage${includeVisits?`,'visitCoverage',t.visit_coverage`:''})
      ${includeVisits?`||${visitValue('t')}`:''} ORDER BY t.start) FROM observed_ranges t WHERE t.kind='trend'),'[]'::jsonb),
    'comparison',jsonb_build_object(
      'currentRange',jsonb_build_object('start',${timestamp('cu.start')},'end',${timestamp('cu.finish')}),
      'previousRange',jsonb_build_object('start',${timestamp('pr.start')},'end',${timestamp('pr.finish')}),
      'current',${trafficCounts('cu')}${includeVisits?`||${visitValue('cu')}`:''},
      'previous',${trafficCounts('pr')}${includeVisits?`||${visitValue('pr')}`:''},
      'documentCoverage',cu.coverage,'previousDocumentCoverage',pr.coverage,
      'contactCoverage',cu.contact_coverage,'previousContactCoverage',pr.contact_coverage
      ${includeVisits?`,'visitCoverage',cu.visit_coverage,'previousVisitCoverage',pr.visit_coverage`:''}),
    'documents',coalesce((SELECT jsonb_agg(jsonb_build_object('locale',locale,'pageType',page_type,'requests',requests)
      ORDER BY locale,page_type) FROM document_parts),'[]'::jsonb),
    'ranking',jsonb_build_object('rankBy',$11::text,'total',(SELECT count(*) FROM contact_vehicles),'page',$4::int,'pageSize',$5::int,
      'items',coalesce((SELECT jsonb_agg(item ORDER BY score DESC,"vehicleId" COLLATE "C") FROM ranked_payload),'[]'::jsonb)),
    'quality',jsonb_build_object(
      'documents',jsonb_build_object('coverage',r.coverage,'expectedHours',r.expected,'importedHours',r.imported,
        'latestHour',${timestamp('latest.latest_hour')}),
      'contacts',$12::jsonb||jsonb_build_object('coverage',r.contact_coverage,'collectionStartedAt',(
        SELECT ${timestamp('c.started_at')} FROM analytics_contact_collection c WHERE c.id=1))
      ${includeVisits?`,'visits',$13::jsonb||jsonb_build_object('coverage',r.visit_coverage,'expectedHours',r.visit_expected,
        'importedHours',r.visit_imported,'latestHour',${timestamp('r.visit_latest')})`:''})
  ) AS traffic
  FROM bounds b CROSS JOIN latest_document latest CROSS JOIN observed_ranges r
  CROSS JOIN observed_ranges cu CROSS JOIN observed_ranges pr
  WHERE r.kind='report' AND cu.kind='current' AND pr.kind='previous'`;

const legacyTrafficSql=trafficSql(false);
const trafficWithVisitsSql=trafficSql(true);
const disabledVisitQuality:AnalyticsIpVisitQuality={configured:false,accepted:0,duplicates:0,rejected:0,rateLimited:0,unavailable:0,since:new Date().toISOString()};

export async function getAnalyticsTraffic(db:Database,query:AnalyticsTrafficQuery,contactQuality:AnalyticsTrafficContactQuality,
  now?:Date,visitQuality:AnalyticsIpVisitQuality=disabledVisitQuality):Promise<AnalyticsTraffic> {
  return db.transaction(async tx=>{
    await tx.query("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='2500ms'; SET LOCAL lock_timeout='250ms'");
    const {days,period,granularity,page,pageSize,startDate,endDate,locale,pageType,rankBy}=query;
    const includeVisits=query.include==='unique-ip-visits';
    const values=[days??(period?1:30),period??null,granularity,page,pageSize,
      now??null,startDate??null,endDate??null,locale??null,pageType??null,rankBy,JSON.stringify(contactQuality)];
    if(includeVisits)values.push(JSON.stringify(visitQuality));
    const result=await tx.query<{traffic:AnalyticsTraffic}>(includeVisits?trafficWithVisitsSql:legacyTrafficSql,values);
    return AnalyticsTrafficSchema.parse(result.rows[0]?.traffic);
  });
}
