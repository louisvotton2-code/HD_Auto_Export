import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AnalyticsEvent } from '@hd/contracts/analytics';

export function analyticsDigest(secret:string, scope:string, value:string) {
  return createHmac('sha256',secret).update(scope).update('\0').update(value).digest();
}

type SessionRow={entry:AnalyticsEvent['pageType']|'unknown'};

const sessionSql = `
 WITH current_session AS (
   SELECT s.id FROM analytics_session_keys k JOIN analytics_sessions s ON s.id=k.session_id
   WHERE k.digest=$1 AND s.last_at>transaction_timestamp()-interval '30 minutes'
     AND s.started_at>transaction_timestamp()-interval '7 days'
 ), created AS (
   INSERT INTO analytics_sessions(started_at,last_at,source,entry,locale,device,country)
   SELECT $7::timestamptz,$8::timestamptz,$2,$3,$4,$5,$6
   WHERE NOT EXISTS(SELECT 1 FROM current_session)
   RETURNING id
 ), identified AS (
   INSERT INTO analytics_session_keys(digest,session_id,started_at)
   SELECT $1,id,transaction_timestamp() FROM created
   ON CONFLICT (digest) DO UPDATE SET session_id=EXCLUDED.session_id,started_at=EXCLUDED.started_at
 )
 SELECT id FROM current_session UNION ALL SELECT id FROM created`;

const summarizeSql = `
 WITH ordered AS MATERIALIZED (
   SELECT *,row_number() OVER(ORDER BY sequence,ordinal) AS position
   FROM analytics_session_events WHERE session_id=$1
 ), landing AS MATERIALIZED (SELECT * FROM ordered WHERE position=1),
 catalog AS (
   SELECT min(position) AS position FROM ordered WHERE event_type='page_view' AND page_type='catalog'
 ), clicks AS (
   SELECT vehicle_id,supplier,min(o.position) AS position FROM ordered o CROSS JOIN catalog c
   WHERE o.position>c.position AND o.event_type='vehicle_click' AND o.vehicle_id IS NOT NULL
   GROUP BY vehicle_id,supplier
 ), vehicle_path AS (
   SELECT o.vehicle_id,o.supplier,
     min(o.position) FILTER(WHERE o.event_type='page_view' AND o.page_type='vehicle') AS detail_at,
     min(o.position) FILTER(WHERE o.event_type='page_view' AND o.page_type='vehicle' AND o.position>c.position) AS funnel_detail_at,
     max(o.position) FILTER(WHERE o.event_type='contact_click') AS contact_at
   FROM ordered o LEFT JOIN clicks c USING(vehicle_id,supplier)
   WHERE o.vehicle_id IS NOT NULL GROUP BY o.vehicle_id,o.supplier
 ), tracked_vehicles AS (
   INSERT INTO analytics_session_vehicles (session_id,vehicle_id,supplier,detail,contact_after_detail)
   SELECT $1,vehicle_id,supplier,true,coalesce(contact_at>detail_at,false) FROM vehicle_path WHERE detail_at IS NOT NULL
   ON CONFLICT (session_id,vehicle_id,supplier) DO UPDATE SET contact_after_detail=EXCLUDED.contact_after_detail
 )
 UPDATE analytics_sessions s SET last_at=greatest(s.last_at,(SELECT max(occurred_at) FROM ordered)),
   started_at=least(s.started_at,(SELECT min(occurred_at) FROM ordered)), source=l.source,entry=l.page_type,locale=l.locale,
   device=l.device,country=l.country,
   catalog_stage=CASE
     WHEN EXISTS(SELECT 1 FROM vehicle_path WHERE contact_at>funnel_detail_at) THEN 4
     WHEN EXISTS(SELECT 1 FROM vehicle_path WHERE funnel_detail_at IS NOT NULL) THEN 3
     WHEN EXISTS(SELECT 1 FROM clicks) THEN 2
     WHEN (SELECT position FROM catalog) IS NOT NULL THEN 1 ELSE 0 END,
   direct_stage=CASE WHEN l.event_type='page_view' AND l.page_type='vehicle' AND l.source NOT IN ('unknown','direct')
     THEN CASE WHEN EXISTS(SELECT 1 FROM vehicle_path v WHERE v.vehicle_id=l.vehicle_id AND v.supplier=l.supplier AND v.contact_at>l.position)
       THEN 2 ELSE 1 END ELSE 0 END
 FROM landing l WHERE s.id=$1 RETURNING CASE WHEN l.sequence=0 THEN s.entry ELSE 'unknown' END AS entry`;

export async function updateAnalyticsSessions(tx:PoolClient,secret:string,events:readonly AnalyticsEvent[],country:string) {
  const contexts=new Map<string,SessionRow>();
  const groups=new Map<string,AnalyticsEvent[]>();
  for(const event of events) {
    if(event.sessionId===undefined) continue;
    const key=event.sessionId.toLowerCase();
    const group=groups.get(key);
    if(group)group.push(event);
    else groups.set(key,[event]);
  }
  // Multi-process writers take the same lock order for any overlapping batch.
  for(const key of [...groups.keys()].sort()) {
    const group=groups.get(key)!;
    const first=group[0]!;
    const digest=analyticsDigest(secret,'analytics-session',key);
    await tx.query('SELECT pg_advisory_xact_lock($1::bigint)',[digest.readBigInt64BE().toString()]);
    const occurrence=group.map(event=>Date.parse(event.occurredAt!));
    const result=await tx.query<{id:string}>(sessionSql,[digest,first.source??'unknown',first.pageType,first.locale,first.device??'unknown',country,
      new Date(Math.min(...occurrence)),new Date(Math.max(...occurrence))]);
    const id=result.rows[0]!.id;
    const rows=group.map(event=>{
      const vehicle='vehicleId' in event?event.vehicleId:undefined;
      const supplier=vehicle?.startsWith('ext-')??false;
      return {sequence:event.sequence,occurred_at:event.occurredAt,event_type:event.type,page_type:event.pageType,locale:event.locale,country,
        device:event.device??'unknown',source:event.source??'unknown',vehicle_id:supplier?vehicle?.slice(4):vehicle,supplier};
    });
    await tx.query(`INSERT INTO analytics_session_events
      (session_id,sequence,received_at,occurred_at,event_type,page_type,locale,country,device,source,vehicle_id,supplier)
      SELECT $1,sequence,transaction_timestamp(),occurred_at,event_type,page_type,locale,country,device,source,vehicle_id,supplier
      FROM jsonb_to_recordset($2::jsonb) AS e(sequence integer,occurred_at timestamptz,event_type text,page_type text,locale text,
        country text,device text,source text,vehicle_id uuid,supplier boolean)`,[id,JSON.stringify(rows)]);
    const {rows:[context]}=await tx.query<SessionRow>(summarizeSql,[id]);
    if(context)contexts.set(key,context);
  }
  return contexts;
}
