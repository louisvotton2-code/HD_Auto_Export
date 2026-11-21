import type { AnalyticsEvent } from '@hd/contracts/analytics';
import type { PoolClient } from 'pg';
import { analyticsDigest, updateAnalyticsSessions } from './session.js';

export type IngestQuality={received:number;accepted:number;duplicates:number;dropped:number};
export type AnalyticsContext={secret:string;country:string;ip?:string};
export const beijingDay = "(statement_timestamp() AT TIME ZONE 'Asia/Shanghai')::date";
const slot = "date_bin(interval '5 minutes', transaction_timestamp(), timestamptz '2000-01-01 00:00:00+00')";
const day = "(transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')::date";

const heartbeatSql = `
 WITH starts AS (
   INSERT INTO analytics_v2_collection (id,started_at) VALUES(1,transaction_timestamp())
   ON CONFLICT (id) DO NOTHING
 )
 INSERT INTO analytics_v2_heartbeats(slot) VALUES(${slot}) ON CONFLICT DO NOTHING`;

// Only counts, coarse dimensions and daily keyed digests reach the database.
const activitySql = `
 WITH events AS MATERIALIZED (
   SELECT * FROM jsonb_to_recordset($1::jsonb) AS a(occurred_at timestamptz,device text,entry text,locale text,
     source text,campaign text,channel text,event_type text,page_type text,vehicle_id uuid,supplier boolean)
 ), market AS (
   INSERT INTO analytics_activity_hourly AS t(hour,country,device,entry,locale,source,campaign,channel,event_type,page_type,total)
   SELECT date_trunc('hour',occurred_at,'UTC'),$2,device,entry,locale,source,campaign,channel,event_type,page_type,count(*)
   FROM events GROUP BY 1,device,entry,locale,source,campaign,channel,event_type,page_type
   ON CONFLICT(hour,country,device,entry,locale,source,campaign,channel,event_type,page_type)
   DO UPDATE SET total=t.total+EXCLUDED.total
 ), minutes AS (
   INSERT INTO analytics_activity_minutes AS t(minute,source,locale,country,device,entry,event_type,page_type,total)
   SELECT date_trunc('minute',occurred_at,'UTC'),source,locale,$2,device,entry,event_type,page_type,count(*)
   FROM events GROUP BY 1,source,locale,device,entry,event_type,page_type
   ON CONFLICT(minute,source,locale,country,device,entry,event_type,page_type) DO UPDATE SET total=t.total+EXCLUDED.total
 ), vehicles AS (
   INSERT INTO analytics_vehicle_activity_hourly AS t(hour,source,locale,country,device,entry,vehicle_id,supplier,detail_views,vehicle_clicks,contact_clicks,whatsapp_clicks,telegram_clicks)
   SELECT date_trunc('hour',occurred_at,'UTC'),source,locale,$2,device,entry,vehicle_id,supplier,
     count(*) FILTER (WHERE event_type='page_view' AND page_type='vehicle'),
     count(*) FILTER (WHERE event_type='vehicle_click'),
     count(*) FILTER (WHERE event_type='contact_click'),
     count(*) FILTER (WHERE event_type='contact_click' AND channel='whatsapp'),
     count(*) FILTER (WHERE event_type='contact_click' AND channel='telegram')
   FROM events WHERE vehicle_id IS NOT NULL GROUP BY 1,source,locale,device,entry,vehicle_id,supplier
   ON CONFLICT(hour,source,locale,country,device,entry,vehicle_id,supplier) DO UPDATE SET detail_views=t.detail_views+EXCLUDED.detail_views,
     vehicle_clicks=t.vehicle_clicks+EXCLUDED.vehicle_clicks,contact_clicks=t.contact_clicks+EXCLUDED.contact_clicks,
     whatsapp_clicks=t.whatsapp_clicks+EXCLUDED.whatsapp_clicks,telegram_clicks=t.telegram_clicks+EXCLUDED.telegram_clicks
 )
 INSERT INTO analytics_ingest_quality AS t(hour,received,accepted,duplicates,dropped)
 VALUES(date_trunc('hour',transaction_timestamp(),'UTC'),$3,$4,$5,$6)
 ON CONFLICT(hour) DO UPDATE SET received=t.received+EXCLUDED.received,accepted=t.accepted+EXCLUDED.accepted,
   duplicates=t.duplicates+EXCLUDED.duplicates,dropped=t.dropped+EXCLUDED.dropped`;

const recordIpSql = `
 WITH dedup AS (
   INSERT INTO analytics_ip_keys(day,digest) VALUES(${day},$1)
   ON CONFLICT DO NOTHING RETURNING day
 )
 INSERT INTO analytics_daily_ips AS t(day,unique_ips) SELECT day,1 FROM dedup
 ON CONFLICT(day) DO UPDATE SET unique_ips=t.unique_ips+EXCLUDED.unique_ips`;

export async function markAnalyticsHeartbeat(tx:PoolClient) {
  await tx.query(heartbeatSql);
}

export async function addAnalyticsActivity(tx:PoolClient,events:readonly AnalyticsEvent[],context:AnalyticsContext,quality:IngestQuality) {
  const sessions=await updateAnalyticsSessions(tx,context.secret,events,context.country);
  const rows=events.map(event=>{
    const session=event.sessionId?sessions.get(event.sessionId.toLowerCase()):undefined;
    const vehicle='vehicleId' in event?event.vehicleId:undefined;
    const supplier=vehicle?.startsWith('ext-')??false;
    return {occurred_at:event.occurredAt,device:event.device??'unknown',entry:event.entry??session?.entry??'unknown',locale:event.locale,
      source:event.source??'unknown',campaign:event.campaign??'none',
      channel:'channel' in event?event.channel??'':'',event_type:event.type,page_type:event.pageType,
      vehicle_id:supplier?vehicle?.slice(4):vehicle,supplier};
  });
  await tx.query(activitySql,[JSON.stringify(rows),context.country,quality.received,quality.accepted,quality.duplicates,quality.dropped]);
  if(rows.length && context.ip) {
    const current=await tx.query<{date:string}>(`SELECT to_char(${day},'YYYY-MM-DD') AS date`);
    const digest=analyticsDigest(context.secret,`analytics-ip:${current.rows[0]!.date}`,context.ip);
    await tx.query(recordIpSql,[digest]);
  }
  await markAnalyticsHeartbeat(tx);
}

const retention=[
  ['analytics_v2_heartbeats','slot',`(${day}-89)::timestamp AT TIME ZONE 'Asia/Shanghai'`],
  ['analytics_activity_hourly','hour',`(${day}-89)::timestamp AT TIME ZONE 'Asia/Shanghai'`],
  ['analytics_activity_minutes','minute',"transaction_timestamp()-interval '3 days'"],
  ['analytics_vehicle_activity_hourly','hour',`(${day}-89)::timestamp AT TIME ZONE 'Asia/Shanghai'`],
  ['analytics_ingest_quality','hour',`(${day}-89)::timestamp AT TIME ZONE 'Asia/Shanghai'`],
  ['analytics_ip_keys','day',`${day}-1`],
  ['analytics_daily_ips','day',`${day}-89`],
  ['analytics_contact_hourly','hour',`(${day}-89)::timestamp AT TIME ZONE 'Asia/Shanghai'`],
  ['analytics_document_snapshots','hour',`(${day}-89)::timestamp AT TIME ZONE 'Asia/Shanghai'`],
  ['analytics_session_keys','started_at',"transaction_timestamp()-interval '7 days'"],
  ['analytics_session_events','received_at',"transaction_timestamp()-interval '7 days'"],
  ['analytics_sessions','started_at',`(${day}-89)::timestamp AT TIME ZONE 'Asia/Shanghai'`],
] as const;
const pruneLimit=10_000;
const pruneSql=retention.map(([table,column,expiry],index)=>`d${index} AS (
  DELETE FROM ${table} WHERE ctid=ANY(ARRAY(
    SELECT ctid FROM ${table} WHERE ${column}<${expiry} ORDER BY ${column} LIMIT ${pruneLimit} FOR UPDATE SKIP LOCKED
  )) RETURNING 1
)`).join(',\n');
const pruneBacklog=retention.map((_,index)=>`(SELECT count(*) FROM d${index})>=${pruneLimit}`).join(' OR ');

export async function pruneAnalyticsActivity(tx:PoolClient) {
  const result=await tx.query<{backlog:boolean}>(`WITH ${pruneSql} SELECT ${pruneBacklog} AS backlog`);
  return result.rows[0]!.backlog;
}
